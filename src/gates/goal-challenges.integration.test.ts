import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The challenge layer through the real command: a repository, a base with a defect, a patch
 * that fixes it, and a goal contract whose check either can or cannot tell the fix from a
 * mutation of it. The strong contract demonstrates detection; the weak one is shown a gap by
 * the repository's own suite; and the exported bundle's own verifier re-derives both verdicts
 * from the records without this process.
 */
let scratch = "";
let workspace = "";
let patch = "";

const clampBase = "export const clamp = (n) => {\n  return n;\n};\n";
const clampFixed = "export const clamp = (n) => {\n  if (n < 0) return 0;\n  return n;\n};\n";

function contract(check: string) {
  return {
    version: 1,
    goal: "clamp negative inputs to zero",
    requirements: [
      { id: "negative-input", description: "negative inputs return zero", checks: ["negative"] },
    ],
    checks: [
      {
        id: "negative",
        command: "pinned CLI output check",
        author: "user",
        exposure: "withheld",
        artifacts: [],
        behavior: {
          kind: "cli",
          cwd: ".",
          timeoutMs: 5000,
          maxOutputBytes: 4000,
          toolchain: "node",
          network: "inherit",
          argv: ["node", "--input-type=module", "-e", check],
          stdin: "",
          exitCode: 0,
          stdout: [{ kind: "equals", value: "ok\n" }],
          stderr: [],
        },
      },
    ],
    immutablePaths: ["clamp.test.mjs"],
  };
}

/** Asserts the requirement: a negative input returns zero. */
const strongCheck =
  "import {clamp} from './clamp.mjs'; console.log(clamp(-1) === 0 ? 'ok' : 'wrong')";
/** Asserts nothing the requirement is about: a positive input passes through. */
const weakCheck = "import {clamp} from './clamp.mjs'; console.log(clamp(5) === 5 ? 'ok' : 'wrong')";

async function git(args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: workspace,
  });
  return ran.stdout.trim();
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-challenge-e2e-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace);
  await git(["init", "-q"]);
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "c", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(workspace, "clamp.mjs"), clampBase);
  // The repository's own suite: it holds the negative case, so it witnesses a mutant of the
  // fix that the weak contract check cannot see.
  await writeFile(
    join(workspace, "clamp.test.mjs"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { clamp } from "./clamp.mjs";',
      'test("positive passes through", () => assert.equal(clamp(5), 5));',
      'test("negative clamps to zero", () => assert.equal(clamp(-2), 0));',
      "",
    ].join("\n"),
  );
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base with a failing negative case"]);
  await writeFile(join(workspace, "clamp.mjs"), clampFixed);
  patch = join(scratch, "fix.diff");
  await writeFile(patch, (await run("git", ["diff"], { cwd: workspace })).stdout);
  await git(["checkout", "--", "clamp.mjs"]);
  await writeFile(join(scratch, "strong.json"), JSON.stringify(contract(strongCheck)));
  await writeFile(join(scratch, "weak.json"), JSON.stringify(contract(weakCheck)));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function ci(args: readonly string[]) {
  const environment = { PATH: process.env.PATH ?? "", HOME: join(scratch, "home"), NO_COLOR: "1" };
  try {
    const ran = await run(
      process.execPath,
      [
        resolve("src/swarm-verify.ts"),
        "ci",
        "--patch",
        patch,
        "--workspace",
        workspace,
        "--json",
        ...args,
      ],
      { env: environment, timeout: 240_000, maxBuffer: 16_000_000 },
    );
    return { code: 0, stdout: ran.stdout, stderr: ran.stderr };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

function report(stdout: string) {
  const line =
    stdout
      .trim()
      .split("\n")
      .findLast((one) => one.startsWith("{")) ?? "{}";
  return JSON.parse(line) as {
    verified: boolean;
    task: string;
    bundleDirectory: string;
    challenges?: {
      policy: string;
      satisfied: boolean;
      requirements: {
        id: string;
        outcome: string;
        baseControl: string;
        caught: string[];
        gaps: string[];
      }[];
      alternatives: { id: string; kind: string; witness: string }[];
    };
  };
}

async function ownVerifier(bundle: string) {
  const ran = await run(process.execPath, [join(bundle, "verify.mjs"), bundle], {
    maxBuffer: 16_000_000,
  }).catch((cause: { stdout?: string; code?: number }) => ({
    stdout: cause.stdout ?? "",
    code: cause.code ?? 1,
  }));
  return typeof ran === "object" && "stdout" in ran ? ran.stdout : "";
}

describe("challenging a goal contract's checks through swarm-verify ci", () => {
  it("demonstrates detection for a check that asserts the requirement, and the bundle re-derives it", async () => {
    const ran = await ci([
      "--goal-contract",
      join(scratch, "strong.json"),
      "--challenges",
      "required",
    ]);
    const read = report(ran.stdout);
    expect(read.task).toBe("accepted");
    expect(read.challenges?.policy).toBe("required");
    const requirement = read.challenges?.requirements[0];
    expect(requirement?.baseControl).toBe("discriminates");
    expect(requirement?.caught.length).toBeGreaterThan(0);
    expect(requirement?.gaps).toEqual([]);
    expect(requirement?.outcome).toBe("detected");
    expect(read.challenges?.satisfied).toBe(true);
    expect(read.verified).toBe(true);
    expect(ran.code).toBe(0);

    const verified = await ownVerifier(read.bundleDirectory);
    expect(verified).toMatch(/PASS {2}challenge verdict \d+ re-derived/);
    expect(verified).not.toMatch(/FAIL {2}(challenge verdict|goal obligations|independent goal)/);
  }, 240_000);

  it("shows a gap for a check the repository suite can outdo, and refuses under required", async () => {
    const ran = await ci([
      "--goal-contract",
      join(scratch, "weak.json"),
      "--challenges",
      "required",
    ]);
    const read = report(ran.stdout);
    // The weak check accepts the candidate, so the task reads accepted on its own terms.
    expect(read.task).toBe("accepted");
    const requirement = read.challenges?.requirements[0];
    // The base control catches it first: a check that cannot tell the fix from the base is vacuous.
    expect(requirement?.baseControl).toBe("vacuous");
    expect(requirement?.outcome).toBe("gap");
    expect(read.challenges?.satisfied).toBe(false);
    expect(read.verified).toBe(false);
    expect(ran.code).toBe(1);
    expect(await ownVerifier(read.bundleDirectory)).toMatch(
      /PASS {2}challenge verdict \d+ re-derived/,
    );
  }, 240_000);

  it("records the same findings under report and still certifies", async () => {
    const ran = await ci(["--goal-contract", join(scratch, "weak.json"), "--challenges", "report"]);
    const read = report(ran.stdout);
    expect(read.challenges?.policy).toBe("report");
    expect(read.challenges?.requirements[0]?.outcome).toBe("gap");
    expect(read.verified).toBe(true);
    expect(ran.code).toBe(0);
  }, 240_000);

  it("runs no challenge under off, which is the behaviour before this layer existed", async () => {
    const ran = await ci(["--goal-contract", join(scratch, "strong.json")]);
    const read = report(ran.stdout);
    expect(read.challenges).toBeUndefined();
    expect(read.verified).toBe(true);
    const bundle = await readFile(join(read.bundleDirectory, "ledger.jsonl"), "utf8");
    expect(bundle).not.toContain("challenge-plan-v1");
  }, 240_000);
});
