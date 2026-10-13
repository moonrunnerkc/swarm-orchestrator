import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { runAgentTask } from "./agent-run.ts";
import { writeBundle } from "./cli-bundle.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { presetTaskContract } from "./cli-task-contract.ts";
import {
  describeGoalPreflight,
  finalizeTaskGoal,
  preflightTaskGoal,
  taskGoalGate,
} from "./cli-task-goal.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { digestOfBytes } from "./evidence/canonical-json.ts";
import { declareGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { diffAgainstBase } from "./gates/scratch-index.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";

const execute = promisify(execFile);

/** A CLI check: `node cli.mjs <input>` must print `expected`. */
function cliCheck(id: string, input: string, expected: string) {
  return {
    id,
    command: `node cli.mjs ${JSON.stringify(input)}`,
    author: "user" as const,
    exposure: "shared" as const,
    artifacts: [],
    behavior: {
      kind: "cli" as const,
      cwd: ".",
      timeoutMs: 5000,
      maxOutputBytes: 4000,
      toolchain: "node" as const,
      network: "inherit" as const,
      argv: ["node", "cli.mjs", input],
      exitCode: 0,
      stdout: [{ kind: "equals" as const, value: `${expected}\n` }],
      stderr: [],
    },
  };
}

/**
 * The slug repository: a function the task has to teach two things, a CLI the checks drive, a
 * suite that passes before and after (it tests behaviour the task does not change), and a sealed
 * contract with no preset, which is what a feature request looks like.
 */
async function slugFixture(contract: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "swarm-feature-worker-"));
  const workspace = join(root, "repo");
  const run = (argv: string[]) =>
    execute(argv[0] ?? "", argv.slice(1), {
      cwd: workspace,
      env: { PATH: process.env.PATH, HOME: root },
    });
  const clock = createSystemClock();
  await execute("mkdir", ["-p", workspace]);
  await writeFile(
    join(workspace, "package.json"),
    '{"name":"slug","version":"1.0.0","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(workspace, "slug.mjs"), "export function slugify(s) {\n  return s;\n}\n");
  await writeFile(
    join(workspace, "package-lock.json"),
    '{"name":"slug","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"slug","version":"1.0.0"}}}\n',
  );
  await writeFile(
    join(workspace, "cli.mjs"),
    'import { slugify } from "./slug.mjs";\nconsole.log(slugify(process.argv[2] ?? ""));\n',
  );
  await writeFile(
    join(workspace, "slug.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { slugify } from "./slug.mjs";\ntest("a plain word is itself", () => assert.equal(slugify("word"), "word"));\n',
  );
  for (const argv of [
    ["git", "init", "-q"],
    ["git", "add", "--all"],
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"],
  ])
    await run(argv);
  const baseCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "feature",
    clock,
  });
  const goal = await declareGoalContract(evidence, contract);
  const context = {
    contract: goal,
    workspace,
    baseCommit,
    evidence,
    clock,
    signal: new AbortController().signal,
    isolation: null,
    install: false,
  };
  return { root, workspace, baseCommit, evidence, goal, context, clock };
}

const featureContract = {
  version: 1,
  goal: "slugify collapses whitespace to one dash and strips punctuation",
  requirements: [
    { id: "collapse", description: "runs of whitespace become one dash", checks: ["collapse"] },
    { id: "strip", description: "punctuation is removed", checks: ["strip"] },
  ],
  checks: [cliCheck("collapse", "a  b", "a-b"), cliCheck("strip", "a!b", "ab")],
  immutablePaths: ["slug.test.mjs"],
};

const collapseOnly = "export function slugify(s) {\n  return s.trim().replace(/\\s+/g, '-');\n}\n";
const complete =
  "export function slugify(s) {\n  return s.trim().replace(/[^\\w\\s-]/g, '').replace(/\\s+/g, '-');\n}\n";

function turnsWriting(path: string, content: string): FixtureTurn[] {
  return [
    respondWithToolCalls("declare", [
      { callId: `declare-${path}`, toolName: "declare_file_set", input: { files: [path] } },
    ]),
    respondWithToolCalls("write", [
      { callId: `write-${path}`, toolName: "write", input: { path, content } },
    ]),
    respondWithText("done"),
  ];
}

/** The same path `swarm "<task>" --goal-contract` composes: contract, acceptance gate, repair. */
function featureRun(
  fixture: Awaited<ReturnType<typeof slugFixture>>,
  turns: readonly FixtureTurn[],
  extra: Partial<Parameters<typeof runAgentTask>[0]> = {},
) {
  const { goal, workspace, baseCommit, evidence, clock, root, context } = fixture;
  return runAgentTask({
    task: goal.goal,
    contract: presetTaskContract({
      goal,
      task: goal.goal,
      maxSteps: 8,
      maxWallMs: 120000,
      network: "unrestricted",
    }),
    workspace,
    baseRef: baseCommit,
    maxSteps: 8,
    attempts: 0,
    model: createRecordingModelClient(
      createFixtureModelClient({ modelId: "fixture:feature", turns }),
      evidence,
    ),
    evidence,
    fileSet: createFileSetRegistry(evidence),
    clock,
    random: createFixedRandom(),
    emit: () => {},
    confirm: async () => "no",
    abortSignal: new AbortController().signal,
    homeDir: root,
    gateOptions: { acceptanceGate: taskGoalGate(context) },
    ...extra,
  });
}

it("establishes a feature contract's checks on the base before any model call, and names what already passes", async () => {
  const fixture = await slugFixture({
    ...featureContract,
    requirements: [
      ...featureContract.requirements,
      { id: "plain", description: "a plain word is itself", checks: ["plain"] },
    ],
    checks: [...featureContract.checks, cliCheck("plain", "word", "word")],
  });
  try {
    await preflightTaskGoal(fixture.context);
    const record = fixture.evidence
      .records()
      .findLast((entry) => entry.type === "verification-command");
    expect(fixture.evidence.payloads().get(record?.payloadDigest ?? "")).toMatchObject({
      rule: "goal-preflight-v1",
      cannotRun: [],
      passesOnBase: ["plain"],
    });
    expect(describeGoalPreflight(fixture.evidence)).toEqual([
      "preflight: plain already pass on the base; a pass there is not evidence the change did anything",
    ]);
    expect(fixture.evidence.records().some((entry) => entry.type === "model-call")).toBe(false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 120_000);

it("stops before model spending when a sealed check cannot run here", async () => {
  const fixture = await slugFixture({
    ...featureContract,
    checks: [
      {
        ...cliCheck("collapse", "a  b", "a-b"),
        behavior: {
          ...cliCheck("collapse", "a  b", "a-b").behavior,
          argv: ["no-such-interpreter-xyz", "cli.mjs"],
        },
      },
      cliCheck("strip", "a!b", "ab"),
    ],
  });
  try {
    await expect(preflightTaskGoal(fixture.context)).rejects.toThrow(
      /acceptance check\(s\) cannot run here: collapse|cannot be established on the base|unmeasured/,
    );
    expect(fixture.evidence.records().some((entry) => entry.type === "model-call")).toBe(false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 120_000);

it("carries a feature contract through acceptance, bounded repair and final verification of the exact tree", async () => {
  const fixture = await slugFixture(featureContract);
  try {
    // The first implementation meets one requirement; the acceptance gate refuses it with the
    // unmet check named, and the one repair attempt the run allows writes the complete one.
    const result = await featureRun(
      fixture,
      [
        ...turnsWriting("slug.mjs", collapseOnly),
        respondWithToolCalls("repair", [
          { callId: "repair", toolName: "write", input: { path: "slug.mjs", content: complete } },
        ]),
        respondWithText("repaired"),
      ],
      { attempts: 1 },
    );
    expect(result.green).toBe(true);
    expect(result.gates.outcome.attempts).toHaveLength(1);
    const refused = fixture.evidence
      .records()
      .filter((entry) => entry.type === "gate-run")
      .map((entry) => fixture.evidence.payloads().get(entry.payloadDigest) as { stdout?: string })
      .find(
        (payload) => payload.stdout?.includes('"strip"') && payload.stdout.includes("rejected"),
      );
    expect(refused).toBeDefined();

    const verdict = await finalizeTaskGoal(fixture.context);
    expect(verdict.acceptable).toBe(true);
    expect(verdict.task).toBe("accepted");

    // Final-tree identity: the verification the verdict rests on names the digest of the diff
    // the workspace holds now, and the assessment is the last record on the chain.
    const verification = fixture.evidence
      .records()
      .filter((entry) => entry.type === "independent-verification")
      .at(-1);
    const payload = fixture.evidence.payloads().get(verification?.payloadDigest ?? "") as {
      sourcePatchDigest: string;
      sourceBase: string;
      certificationPolicy: string;
    };
    expect(payload.certificationPolicy).toBe("goal-obligations-v1");
    expect(payload.sourceBase).toBe(fixture.baseCommit);
    expect(payload.sourcePatchDigest).toBe(
      digestOfBytes(
        await diffAgainstBase({ workspaceRoot: fixture.workspace, baseRef: fixture.baseCommit }),
      ),
    );
    expect(fixture.evidence.records().at(-1)?.type).toBe("run-assessment");
    // A contract without a preset is the user's declaration, and the contract record says so.
    const declaration = fixture.evidence.records().find((entry) => entry.type === "goal-contract");
    expect(declaration?.provenance).toEqual(["user"]);
    expect((fixture.goal as GoalContract).preset).toBeUndefined();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 240_000);

it("refuses an implementation that omits a requirement although the project's own suite passes", async () => {
  const fixture = await slugFixture(featureContract);
  try {
    const result = await featureRun(fixture, turnsWriting("slug.mjs", collapseOnly));
    expect(result.green).toBe(false);
    const tests = result.gates.outcome.finalCycle.runs.find((run) => run.gateId === "tests");
    expect(tests?.status).toBe("passed");
    const acceptance = result.gates.outcome.finalCycle.runs.find(
      (run) => run.gateId === "task-acceptance",
    );
    expect(acceptance?.status).toBe("failed");
    const verdict = await finalizeTaskGoal(fixture.context);
    expect(verdict.acceptable).toBe(false);
    expect(verdict.task).toBe("rejected");
    expect(verdict.reasons.task).toBe("pinned goal checks: rejected");
    // Which requirement was omitted is on the verification record the outcome display reads.
    const verification = fixture.evidence
      .records()
      .filter((entry) => entry.type === "independent-verification")
      .at(-1);
    const payload = fixture.evidence.payloads().get(verification?.payloadDigest ?? "") as {
      goalAcceptance: { obligations: { id: string; status: string }[] };
    };
    expect(payload.goalAcceptance.obligations.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "collapse", status: "accepted" },
      { id: "strip", status: "rejected" },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 240_000);

/**
 * The September development pilot: the final verification's fresh checkout could not install
 * its dependencies, the verifier refused with that reason, and the run ended with an exception
 * and no verdict. A refusal is a recorded non-success.
 */
it("records a refused final verification as a non-success instead of ending the run", async () => {
  const fixture = await slugFixture(featureContract);
  try {
    // A dependency with no lockfile: `npm ci` refuses before it needs a registry.
    await writeFile(
      join(fixture.workspace, "package.json"),
      '{"name":"slug","version":"1.0.0","private":true,"type":"module","scripts":{"test":"node --test"},"dependencies":{"left-pad":"1.3.0"}}\n',
    );
    await execute("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "dep"], {
      cwd: fixture.workspace,
    });
    const baseCommit = (
      await execute("git", ["rev-parse", "HEAD"], { cwd: fixture.workspace })
    ).stdout.trim();
    const context = { ...fixture.context, baseCommit, install: true };
    const result = await featureRun(
      { ...fixture, baseCommit, context },
      turnsWriting("slug.mjs", complete),
    );
    expect(result.green).toBe(false);
    const verdict = await finalizeTaskGoal(context);
    expect(verdict.acceptable).toBe(false);
    expect(verdict.task).toBe("unjudged");
    expect(verdict.reasons.task).toMatch(/final verification refused: .*dependency setup failed/);
    expect(fixture.evidence.records().at(-1)?.type).toBe("run-assessment");
    // The bundle's own dependency-free verifier re-derives the refused verdict and agrees.
    const bundle = await writeBundle(
      fixture.evidence,
      join(fixture.root, "bundle"),
      fixture.clock,
      () => {},
    );
    const verified = await execute(process.execPath, [
      join(bundle.directory, "verify.mjs"),
      bundle.directory,
    ]).then(
      (ran) => ({ code: 0, stdout: ran.stdout }),
      (failed: { code: number; stdout: string }) => ({ code: failed.code, stdout: failed.stdout }),
    );
    expect(verified.stdout).toMatch(/PASS {2}run assessment \d+ re-derived/);
    expect(verified.stdout).not.toMatch(/FAIL/);
    expect(verified.code).toBe(0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 240_000);

/**
 * An upgrade whose manifest misses its authorized version is a policy decision against the
 * change. It reaches the acceptance gate as a failure the repair can read and the final
 * assessment as a refusal, where it used to be thrown through both as an error.
 */
it("fails the acceptance gate on an upgrade policy refusal and records the refused verdict", async () => {
  const fixture = await slugFixture({
    version: 1,
    goal: "upgrade left-pad to exactly 1.3.0",
    preset: {
      kind: "upgrade",
      manager: "npm",
      manifest: "package.json",
      lockfile: "package-lock.json",
      dependencies: [{ name: "left-pad", section: "dependencies", version: "1.3.0" }],
      sourcePaths: [],
    },
    requirements: [{ id: "installed", description: "1.3.0 is declared", checks: ["version"] }],
    checks: [cliCheck("version", "word", "word")],
    immutablePaths: [],
  });
  try {
    const wrongVersion =
      '{"name":"slug","version":"1.0.0","private":true,"type":"module","scripts":{"test":"node --test"},"dependencies":{"left-pad":"1.2.0"}}\n';
    const result = await featureRun(fixture, turnsWriting("package.json", wrongVersion), {
      installDependencies: true,
    });
    expect(result.green).toBe(false);
    const acceptance = result.gates.outcome.finalCycle.runs.find(
      (run) => run.gateId === "task-acceptance",
    );
    expect(acceptance?.status).toBe("failed");
    const observed = fixture.evidence.payloads().get(acceptance?.record ?? "") as {
      stderr?: string;
    };
    expect(observed.stderr).toMatch(/^refused: .*(1\.3\.0|declared base section|must)/);
    const verdict = await finalizeTaskGoal({ ...fixture.context, install: true });
    expect(verdict.acceptable).toBe(false);
    expect(verdict.task).toBe("unjudged");
    expect(verdict.reasons.task).toContain("final verification refused");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 240_000);
