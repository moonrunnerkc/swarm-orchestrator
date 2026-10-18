import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import {
  acceptanceCheckTool,
  preflightTaskGoal,
  readAcceptance,
  type TaskGoalContext,
  verifyCandidateUnder,
} from "./cli-task-goal.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { createToolChokepoint } from "./tools/chokepoint.ts";
import type { ChokepointRecord } from "./tools/chokepoint-record.ts";
import { createDerivationHeuristic } from "./tools/derivation.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./tools/policy-guard.ts";

const run = promisify(execFile);

/**
 * The independent verification of a goal-contract run judges a fresh checkout of the base plus
 * the candidate patch. That checkout has no swarm.toml (the workspace's is untracked), so the
 * gate commands the run was configured with have to travel in the context, or the verifier
 * assembles its own gates from the manifest. A live run whose sealed `tests` gate was the
 * project's node suite was refused on the manifest's `test` script, which runs a browser suite
 * the checkout's environment cannot run.
 */
let scratch = "";
let workspace = "";
let evidence: EvidenceRecorder;

async function git(...args: string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: workspace,
  });
  return ran.stdout.trim();
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(workspace, path, ".."), { recursive: true });
  await writeFile(join(workspace, path), contents, "utf8");
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-task-goal-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace, { recursive: true });
  await write(
    "package.json",
    JSON.stringify(
      {
        name: "w",
        version: "1.0.0",
        type: "module",
        // The manifest's own test script fails, and its output differs from run to run, as a
        // browser suite without a browser does; the node suite the task names passes.
        scripts: { test: "node fail.mjs", "test-node": "node pass.mjs" },
      },
      null,
      2,
    ),
  );
  await write(
    "fail.mjs",
    "console.log('browser missing', Date.now(), Math.random());\nprocess.exit(1);\n",
  );
  await write("pass.mjs", "console.log('node suite ok');\n");
  await write("greet.mjs", "export const greet = () => 'goodbye';\n");
  await write(
    "acceptance/check.mjs",
    "import { greet } from '../greet.mjs';\nif (greet() !== 'hello') { console.error('greet is ' + greet()); process.exit(1); }\n",
  );
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "base");
  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "task-goal",
    clock: createSystemClock(),
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const contract = freezeGoalContract({
  version: 1,
  goal: "make greet return hello",
  requirements: [{ id: "greets", description: "greet returns hello", checks: ["check"] }],
  checks: [
    {
      id: "check",
      command: "node acceptance/check.mjs",
      author: "user",
      exposure: "shared",
      artifacts: [],
    },
  ],
  immutablePaths: ["acceptance"],
}).contract;

async function context(overrides: Partial<TaskGoalContext> = {}): Promise<TaskGoalContext> {
  return {
    contract,
    workspace,
    baseCommit: await git("rev-parse", "HEAD"),
    evidence,
    clock: createSystemClock(),
    signal: new AbortController().signal,
    isolation: null,
    install: false,
    ...overrides,
  };
}

describe("the gates the independent verification of a goal run assembles", () => {
  it("runs the gate commands the run was configured with, not the checkout manifest's own", async () => {
    await write("greet.mjs", "export const greet = () => 'hello';\n");

    const verified = await verifyCandidateUnder(
      await context({ commandOverrides: { tests: "npm run test-node" } }),
      contract,
      "off",
    );
    const tests = verified.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("passed");
    expect(tests?.observation?.stdout).toContain("node suite ok");
    expect(verified.unmeasured).toBe(false);
    expect(verified.goalAcceptance?.checkResults?.map((check) => check.status)).toEqual([
      "accepted",
    ]);
  }, 60_000);

  it("is refused as unmeasured by the manifest's own script when no override travels, which is the defect", async () => {
    await write("greet.mjs", "export const greet = () => 'hello';\n");

    const verified = await verifyCandidateUnder(await context(), contract, "off");
    const tests = verified.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.observation?.stdout).toContain("browser missing");
    expect(verified.unmeasured).toBe(true);
  }, 60_000);
});

describe("a bugfix's base control", () => {
  /**
   * A bugfix contract needs its reproducer to fail on the base before any model call can
   * spend the budget: a check that already passes there would pass a change that did nothing.
   * The control is established in the preflight, through the same verification path.
   */
  const bugfix = (expected: string) =>
    freezeGoalContract({
      version: 1,
      goal: "make greet return hello",
      preset: { kind: "bugfix", reproducer: "greets" },
      requirements: [{ id: "greets", description: "greet returns hello", checks: ["greets"] }],
      checks: [
        {
          id: "greets",
          command: "pinned output",
          author: "user",
          exposure: "withheld",
          artifacts: [],
          behavior: {
            kind: "cli",
            cwd: ".",
            timeoutMs: 3000,
            maxOutputBytes: 4000,
            toolchain: "Node",
            network: "inherit",
            argv: [
              "node",
              "--input-type=module",
              "-e",
              "import {greet} from './greet.mjs';console.log(greet())",
            ],
            exitCode: 0,
            stdout: [{ kind: "equals", value: expected }],
            stderr: [],
          },
        },
      ],
      immutablePaths: [],
    }).contract;

  it("is established where the reproducer fails on the base, and refused where it already passes", async () => {
    const overrides = { commandOverrides: { tests: "npm run test-node" } };
    await expect(
      preflightTaskGoal(await context({ ...overrides, contract: bugfix("hello\n") })),
    ).resolves.toBeUndefined();
    // Its own chain: the control is read off the goal-check records for the base tree, and a
    // second contract judged on the first's chain would read the first's reproduction.
    const vacuous = await openEvidenceSession({
      root: join(scratch, "sessions"),
      sessionId: "task-goal-vacuous",
      clock: createSystemClock(),
    });
    await expect(
      preflightTaskGoal(
        await context({ ...overrides, evidence: vacuous, contract: bugfix("goodbye\n") }),
      ),
    ).rejects.toThrow("base control was not established");
  }, 60_000);
});

describe("what the acceptance gate makes of a verification", () => {
  const contract = freezeGoalContract({
    version: 1,
    goal: "g",
    requirements: [
      { id: "suite", description: "suite passes", checks: ["suite"] },
      { id: "ten", description: "10 is small", checks: [], planned: { diagnostics: ["boundary"] } },
    ],
    checks: [
      { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
      { id: "boundary", command: "planned", author: "model", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: [],
  }).contract;
  const verification = (suite: string, boundary: string) => ({
    verified: false,
    unmeasured: false,
    refusal: null,
    regression: "pass",
    goalAcceptance: {
      obligations: [
        { id: "suite", status: suite },
        { id: "ten", status: "unjudged" },
      ],
      checkResults: [
        { id: "suite", status: suite },
        { id: "boundary", status: boundary },
      ],
    },
  });

  it("passes when every deciding check passes and no generated check disagrees, though a planned requirement stays unjudged", () => {
    expect(readAcceptance(contract, verification("accepted", "accepted"))).toMatchObject({
      passes: true,
      unavailable: false,
    });
  });

  it("asks for a repair when a generated check disagrees, without reading it as a setup problem", () => {
    expect(readAcceptance(contract, verification("accepted", "rejected"))).toMatchObject({
      passes: false,
      unavailable: false,
    });
  });

  it("fails on a deciding check, and reads a deciding check that could not run as unavailable", () => {
    expect(readAcceptance(contract, verification("rejected", "accepted")).passes).toBe(false);
    expect(readAcceptance(contract, verification("unjudged", "accepted"))).toMatchObject({
      passes: false,
      unavailable: true,
    });
  });

  it("does not ask for a repair over a generated check that could not run", () => {
    expect(readAcceptance(contract, verification("accepted", "unjudged")).passes).toBe(true);
  });
});

describe("run_check's own diagnostic program", () => {
  async function invoke(input: Record<string, unknown>) {
    const settled: ChokepointRecord[] = [];
    const guard = createPolicyGuard({
      workspaceRoot: workspace,
      homeDir: join(scratch, "home"),
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [],
    });
    const chokepoint = createToolChokepoint({
      definitions: [acceptanceCheckTool(await context())],
      guard,
      derivation: createDerivationHeuristic(),
      confirm: () => Promise.resolve("yes"),
      recorder: {
        recordCall(entry) {
          settled.push(entry);
          return Promise.resolve(`sha256:${"ab".repeat(32)}`);
        },
        recordConfirmation: () => Promise.resolve(),
        recordAllowance: () => Promise.resolve(),
      },
    });
    const call = await chokepoint.invoke({
      callId: "c",
      toolName: "run_check",
      input,
      provenance: "model",
    });
    return { output: call.output, outcome: settled.find((one) => one.decision !== "requested") };
  }

  it("answers to the path policy the shell applies to the same program inline", async () => {
    await write(".env", "API_KEY=not-a-real-key\n");
    // Passed to `node -e`, this program is denied; through run_check it ran unchecked.
    const literal = await invoke({
      program:
        "import { readFileSync } from 'node:fs';\nimport { greet } from './greet.mjs';\nexport default () => readFileSync('.env', 'utf8') + greet();\n",
      inputs: [1],
    });
    expect(literal.outcome?.decision).toBe("denied");
    expect(literal.outcome?.detail).toContain("credential denylist");
    expect(literal.output).not.toContain("not-a-real-key");

    // An input is a path the program may open, as a word after `node -e '...'` is.
    const input = await invoke({
      program:
        "import { readFileSync } from 'node:fs';\nexport default (path) => readFileSync(path, 'utf8');\n",
      inputs: ["~/.ssh/id_rsa"],
    });
    expect(input.outcome?.decision).toBe("denied");
  });

  it("still runs an ordinary probe, regular expressions and absolute names in its data included", async () => {
    const probe = await invoke({
      program:
        "import { greet } from './greet.mjs';\nexport default (name) => [/^.*\\./.exec(name)?.[0] ?? null, greet()];\n",
      inputs: ["/path/to/photo.png", "a.b"],
    });
    expect(probe.outcome?.decision, probe.output).toBe("allowed");
    expect(probe.output).toContain('"/path/to/photo."');
    expect(probe.output).toContain("goodbye");
  });
});
