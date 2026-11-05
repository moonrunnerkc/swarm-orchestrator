import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requirementSchema } from "swarm-verify";
import { describe, expect, it } from "vitest";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createChokepoint } from "../tools/chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { parseAuthor } from "./author-prompt.ts";
import {
  authorChecks,
  foreignError,
  ownUndefinedName,
  plainOutput,
  raisedNotAsserted,
  unrelatedImport,
} from "./check-author.ts";
import { testConventions } from "./test-conventions.ts";
import { authorTest, halfTest, scripted } from "./test-doubles.ts";

/** A node:test repository with half(n) broken, as the run's worktree is before the first edit. */
async function base() {
  const root = await mkdtemp(join(tmpdir(), "author-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, "test"), { recursive: true });
  await writeFile(join(repo, "swarm.toml"), '[checks]\ntest = "node --test"\n');
  await writeFile(join(repo, "half.mjs"), "export const half = (n) => n;\n");
  await writeFile(join(repo, "test", "half.test.mjs"), halfTest());
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "base");
  const home = join(root, "home");
  await mkdir(join(home, "sessions"), { recursive: true });
  const evidence = await openEvidenceSession({
    root: join(home, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
  const guard = createPolicyGuard({
    workspaceRoot: repo,
    homeDir: root,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [home],
    childHomeDir: join(root, "child"),
  });
  const chokepoint = createChokepoint({
    guard,
    evidence,
    approval: "auto",
    confirm: null,
    timeoutMs: 60_000,
  });
  return { repo, evidence, chokepoint };
}

const task = "Make half(n) return n / 2.";
const requirement = requirementSchema.parse({
  id: "R1",
  text: task,
  source: "user",
  kind: "other",
});
const passing = `import { test } from "node:test";\ntest("always", () => {});\n`;

describe("the check author", () => {
  it("rejects a test that passes at the base and takes the second attempt that fails there", async () => {
    const { repo, evidence, chokepoint } = await base();
    const model = scripted([], {
      author: [authorTest("fix", passing), authorTest("fix", halfTest("half(4) is 2"))],
    });
    const authored = await authorChecks({
      model,
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.attempts).toEqual([
      ["it passes at the base, so it cannot tell the change apart"],
      [],
    ]);
    expect(authored).toMatchObject({ kind: "fix", failure: null });
    expect(authored.test?.path).toBe("test/half.swarm-r1.test.mjs");
    expect(model.authorSeen[1]?.at(-1)?.content).toContain("The harness rejected that");
    // Laid in for its run and taken out again: the coding model never finds it in the tree.
    expect(await readdir(join(repo, "test"))).toEqual(["half.test.mjs"]);
  });

  it("names why no check survives two rejected attempts", async () => {
    const { repo, evidence, chokepoint } = await base();
    const authored = await authorChecks({
      model: scripted([], { author: ["I would test it."] }),
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.test).toBeNull();
    // The same reason twice: no third attempt.
    expect(authored.failure).toMatch(/2 attempts were rejected: the reply has no `kind/);
  });

  it("tries a third time only where the second was refused for a new reason", async () => {
    const { repo, evidence, chokepoint } = await base();
    const model = scripted([], {
      author: [
        "I would test it.",
        authorTest("fix", passing),
        authorTest("fix", halfTest("half(4) is 2")),
      ],
    });
    const authored = await authorChecks({
      model,
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.attempts).toHaveLength(3);
    expect(authored).toMatchObject({ kind: "fix", failure: null });
  });

  it("keeps only the refactor claims that fail at the base", async () => {
    const { repo, evidence, chokepoint } = await base();
    const claims = [
      { path: "lib/half.mjs", contains: "export const half" },
      { path: "half.mjs", contains: "export const half" },
    ];
    const authored = await authorChecks({
      model: scripted([], {
        author: [`kind: refactor\n\n\`\`\`claims\n${JSON.stringify(claims)}\n\`\`\`\n`],
      }),
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.structure).toEqual([
      { path: "lib/half.mjs", contains: "export const half", authority: "independently-generated" },
    ]);
  });
});

describe("an authored check failing at the base for a reason no change removes", () => {
  it("names an import of a module the base lacks and the task never asks for", () => {
    const vitest = "Error: Failed to load url ../src/index.js (resolved id: ../src/index.js)";
    expect(unrelatedImport(vitest, "Add --reviewers to parseArgs in cli")).toBe("../src/index.js");
  });

  it("allows a module the task asks for, and a name a module lacks", () => {
    const moved = "ModuleNotFoundError: No module named 'ironroot.verification.builtin_claims'";
    expect(unrelatedImport(moved, "move them into builtin_claims.py")).toBeNull();
    const export_ = "ImportError: cannot import name 'double' from 'half'";
    expect(unrelatedImport(export_, "add double")).toBeNull();
  });
});

describe("an author's reply", () => {
  it("reads the kind, the test and the claims", () => {
    const reply = 'kind: refactor\n\n```claims\n[{"path": "a.py", "contains": "def f("}]\n```';
    expect(parseAuthor(reply)).toMatchObject({
      kind: "refactor",
      claims: [{ path: "a.py", contains: "def f(" }],
      problem: null,
    });
    expect(parseAuthor("kind: feature\n```typescript\nit('x')\n```")).toMatchObject({
      kind: "feature",
      test: "it('x')\n",
    });
  });

  it("says what is wrong with one it cannot use", () => {
    expect(parseAuthor("a test")).toEqual({
      kind: null,
      problem: "the reply has no `kind: <fix|feature|...>` line",
    });
    expect(parseAuthor("kind: refactor\n```claims\n[oops\n```").problem).toMatch(/not JSON/);
  });
});

// tracemantle f69ad0c58 (replayed 2026-11-05): the author's check built ParsedSkill without its
// frontmatter, so is_template raised AttributeError at the base, and would on every correct fix.
describe("a fix's check that raises before it asserts", () => {
  const pytest = [
    "    def is_template(skill: ParsedSkill) -> bool:",
    '>       if skill.frontmatter.get("template") is True:',
    "E       AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
    "FAILED tests/test_swarm_r1_cli.py::test_x - AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
  ].join("\n");

  it("is named, where the wording names no crash for the fix to remove", () => {
    expect(raisedNotAsserted(pytest, "is_template reads a real skill as a template")).toBe(
      "AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
    );
  });

  it("is not, where an assertion fails or the task is about the crash", () => {
    expect(raisedNotAsserted(`${pytest}\nE       assert False`, "x")).toBeNull();
    expect(raisedNotAsserted("AssertionError [ERR_ASSERTION]: 4 !== 2", "x")).toBeNull();
    expect(
      raisedNotAsserted(pytest, "is_template raises AttributeError on a skill with no frontmatter"),
    ).toBeNull();
  });
});

describe("a refactor claim about a file the base lacks", () => {
  it("is rejected where it lies under a top-level directory the repository does not have", async () => {
    const { repo, evidence, chokepoint } = await base();
    await mkdir(join(repo, "src", "tracemantle"), { recursive: true });
    const claims = [{ path: "tracemantle/history/history_io.py", symbol: "load_ledger" }];
    const authored = await authorChecks({
      model: scripted([], {
        author: [`kind: refactor\n\n\`\`\`claims\n${JSON.stringify(claims)}\n\`\`\`\n`],
      }),
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.structure).toEqual([]);
    expect(authored.attempts[0]).toEqual([
      "tracemantle/history/history_io.py is under tracemantle/, which the repository does not have; its tracemantle package is at src/tracemantle/",
    ]);
  });
});

// pubprep (2026-11-05, sealed-set run): the check called beforeEach without importing it, so it
// failed at the base and on every tree after, and no change could satisfy R1.
describe("a check that uses a name it never defines or imports", () => {
  // Vitest's own colours, as the 17.0.0-rc.5 run recorded them: the rc.5 validation read the raw
  // text, missed the name between the escapes, and accepted the check again.
  it("is read through vitest's colours, as the run recorded them", () => {
    const recorded =
      "-main.swarm-r1.test.ts ]\u001b[22m\n\u001b[31m\u001b[1mReferenceError\u001b[22m: beforeEach is not defined\u001b[39m\n";
    expect(ownUndefinedName(recorded, "x")).toBeNull();
    expect(ownUndefinedName(plainOutput(recorded), "x")).toBe("beforeEach");
  });

  it("is caught in a runner's output at the base", async () => {
    const { repo, evidence, chokepoint } = await base();
    const coloured =
      'import { test } from "node:test";\nbeforeEach(() => {});\ntest("x", () => {});\n';
    const authored = await authorChecks({
      model: scripted([], { author: [authorTest("feature", coloured)] }),
      chokepoint,
      evidence,
      workspace: repo,
      requirement,
      conventions: await testConventions(repo, task),
      turnTokens: 1000,
    });
    expect(authored.attempts[0]?.[0]).toMatch(
      /^it uses beforeEach, which it neither defines nor imports/,
    );
  });

  it("is named, unless the task names it", () => {
    const vitest =
      "FAIL  test/cli-main.swarm-r1.test.ts\nReferenceError: beforeEach is not defined";
    expect(ownUndefinedName(vitest, "Add --reviewers to parseArgs")).toBe("beforeEach");
    expect(ownUndefinedName("NameError: name 'pytest' is not defined", "fix it")).toBe("pytest");
    expect(
      ownUndefinedName("ReferenceError: reviewers is not defined", "parseArgs returns `reviewers`"),
    ).toBeNull();
  });
});

// pubprep (2026-11-05 trial): toThrow given a predicate, which vitest does not take, raised a
// TypeError in the assertion itself, at the base and on the reference patch alike.
describe("a feature's check failing at the base on an error about nothing the task names", () => {
  const task = "parseArgs returns the choice as `reviewers`; a missing value is an error";
  it("is named", () => {
    const vitest =
      "FAIL  test/a.test.ts > x\nTypeError: Cannot read properties of undefined (reading 'constructor')";
    expect(foreignError(vitest, task)).toBe(
      "TypeError: Cannot read properties of undefined (reading 'constructor')",
    );
  });
  it("is not, where the error is an assertion's or about a name the task uses", () => {
    expect(
      foreignError("AssertionError: expected undefined to deeply equal [ 'a' ]", task),
    ).toBeNull();
    expect(
      foreignError("TypeError: Cannot read properties of undefined (reading 'reviewers')", task),
    ).toBeNull();
    expect(foreignError("TypeError: parseArgs is not a function", task)).toBeNull();
  });
});
