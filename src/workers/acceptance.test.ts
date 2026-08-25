import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import type { ModelClient, ModelRequest } from "../core/model-client.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder } from "../evidence/bundle.ts";
import { exportCombinedBundle } from "../evidence/combined-bundle.ts";
import { buildEvidenceDag } from "../evidence/dag.ts";
import { createRecordingModelClient } from "../evidence/model-call-recording.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { runInParallel } from "./parallel-run.ts";
import { readTaskGraph, type TaskGraph } from "./task-graph.ts";

/**
 * The phase acceptance run, against a real git repository with real worktrees, real test
 * execution, and a real merge queue. The unit tests prove each piece; this proves that two
 * workers can run at once without either of them, or the queue, corrupting the repository.
 */

const run = promisify(execFile);
const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

let scratch = "";
let repository = "";
let coordinator: EvidenceRecorder;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

const alpha = "export function alpha() {\n  return 'alpha';\n}\n";
const beta = "export function beta() {\n  return 'beta';\n}\n";
const baseTest = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { alpha } from './alpha.js';",
  "import { beta } from './beta.js';",
  "",
  "test('alpha', () => { assert.equal(alpha(), 'alpha'); });",
  "test('beta', () => { assert.equal(beta(), 'beta'); });",
  "",
].join("\n");

function shoutTest(name: string, module: string): string {
  return [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    `import { shout${name} } from './${module}.js';`,
    "",
    `test('shout${name}', () => { assert.equal(shout${name}(), '${module.toUpperCase()}'); });`,
    "",
  ].join("\n");
}

function withShout(source: string, name: string, module: string): string {
  return `${source}export function shout${name}() {\n  return '${module.toUpperCase()}';\n}\n`;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-parallel-"));
  repository = join(scratch, "repo");
  await mkdir(repository, { recursive: true });
  await write(
    repository,
    "package.json",
    `${JSON.stringify({ name: "scratch", type: "module" }, null, 2)}\n`,
  );
  await write(repository, "src/alpha.js", alpha);
  await write(repository, "src/beta.js", beta);
  await write(repository, "src/base.test.js", baseTest);
  await git(repository, "init", "--quiet");
  await git(repository, "config", "user.email", "parallel@example.com");
  await git(repository, "config", "user.name", "parallel");
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "seed");

  coordinator = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "coordinator",
    clock,
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const gateOverrides = {
  tests: "node --test --test-reporter=tap",
  lint: "node --check src/alpha.js",
  typecheck: "node --check src/beta.js",
  format: "node --check src/base.test.js",
};

/** One worker's whole script: declare the files, write them, and stop. */
function scriptFor(edits: Readonly<Record<string, string>>): readonly FixtureTurn[] {
  return [
    respondWithToolCalls("declaring", [
      { callId: "d", toolName: "declare_file_set", input: { files: Object.keys(edits) } },
    ]),
    ...Object.entries(edits).map(([path, content], index) =>
      respondWithToolCalls(`writing ${path}`, [
        { callId: `w${index}`, toolName: "write", input: { path, content } },
      ]),
    ),
    respondWithText("done"),
  ];
}

/** Picks its script from the task it was handed, the way a real model reads its brief. */
function modelFor(
  scripts: Readonly<Record<string, readonly FixtureTurn[]>>,
  evidence: EvidenceRecorder,
): ModelClient {
  let inner: ModelClient | null = null;
  const client: ModelClient = {
    modelId: "fixture:worker",
    generate(request: ModelRequest) {
      if (inner === null) {
        const first = request.messages[0];
        const prompt = first?.role === "user" ? first.text : "";
        inner = createFixtureModelClient({
          modelId: "fixture:worker",
          turns: scripts[prompt] ?? [respondWithText("I do not know what to do.")],
        });
      }
      return inner.generate(request);
    },
  };
  return createRecordingModelClient(client, evidence);
}

interface ParallelOverrides {
  readonly redundancy?: number;
  readonly graph?: TaskGraph;
  /** Scripts keyed by worker id, for a run whose attempts at one task must differ. */
  readonly byWorker?: Readonly<Record<string, readonly FixtureTurn[]>>;
}

async function parallel(
  scripts: Readonly<Record<string, readonly FixtureTurn[]>>,
  overrides: ParallelOverrides = {},
) {
  return runInParallel({
    repositoryRoot: repository,
    baseRef: "HEAD",
    tasks: Object.keys(scripts),
    runId: "run1",
    scratchRoot: join(scratch, "worktrees"),
    coordinator,
    createWorkerSession: (workerId) =>
      openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
    createModel: (workerId, evidence) => {
      const only = overrides.byWorker?.[workerId];
      return only === undefined
        ? modelFor(scripts, evidence)
        : createRecordingModelClient(
            createFixtureModelClient({ modelId: "fixture:worker", turns: only }),
            evidence,
          );
    },
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 8,
    attempts: 0,
    gateOptions: { commandOverrides: gateOverrides },
    redundancy: overrides.redundancy ?? 1,
    ...(overrides.graph === undefined ? {} : { graph: overrides.graph, graphSource: "file" }),
    concurrency: 0,
    modelSpec: "fixture:worker",
    abortSignal: new AbortController().signal,
  });
}

const separateModules = {
  "add a shout to alpha": scriptFor({
    "src/alpha.js": withShout(alpha, "Alpha", "alpha"),
    "src/alpha-shout.test.js": shoutTest("Alpha", "alpha"),
  }),
  "add a shout to beta": scriptFor({
    "src/beta.js": withShout(beta, "Beta", "beta"),
    "src/beta-shout.test.js": shoutTest("Beta", "beta"),
  }),
};

const sameModule = {
  "add a shout to alpha": scriptFor({
    "src/alpha.js": withShout(alpha, "Alpha", "alpha"),
    "src/alpha-shout.test.js": shoutTest("Alpha", "alpha"),
  }),
  "add a whisper to alpha": scriptFor({
    "src/alpha.js": `${alpha}export function whisperAlpha() {\n  return 'alpha...';\n}\n`,
    "src/alpha-whisper.test.js": [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { whisperAlpha } from './alpha.js';",
      "",
      "test('whisperAlpha', () => { assert.equal(whisperAlpha(), 'alpha...'); });",
      "",
    ].join("\n"),
  }),
};

describe("two tasks that touch different modules", () => {
  it("runs both workers and lands both green", async () => {
    const result = await parallel(separateModules);

    expect(result.workers.map((worker) => worker.green)).toEqual([true, true]);
    expect(result.queue?.landings.map((landing) => landing.landed)).toEqual([true, true]);
  }, 120_000);

  it("leaves the integration branch carrying both changes", async () => {
    const result = await parallel(separateModules);

    expect(result.headCommit).not.toBe(result.baseCommit);
    const tree = await git(repository, "ls-tree", "-r", "--name-only", result.integrationBranch);
    expect(tree).toContain("src/alpha-shout.test.js");
    expect(tree).toContain("src/beta-shout.test.js");
  }, 120_000);

  it("runs each worker in a worktree of its own and clears them away afterwards", async () => {
    const result = await parallel(separateModules);

    expect(new Set(result.workers.map((worker) => worker.branch)).size).toBe(2);
    expect((await git(repository, "worktree", "list")).split("\n").filter(Boolean)).toHaveLength(1);
  }, 120_000);
});

describe("two tasks that collide", () => {
  it("lands one and returns the other to its worker with something to act on", async () => {
    const result = await parallel(sameModule);

    const landings = result.queue?.landings ?? [];
    expect(landings.filter((landing) => landing.landed)).toHaveLength(1);

    const rejected = landings.find((landing) => !landing.landed);
    expect(rejected?.reason).toBe("merge-conflict");
    expect(rejected?.feedback).toMatch(/src\/alpha\.js/);
    expect(rejected?.feedback).toMatch(/integration branch/);
  }, 120_000);

  it("never leaves the repository the user is sitting in touched", async () => {
    const headBefore = (await git(repository, "rev-parse", "HEAD")).trim();
    const branchBefore = (await git(repository, "rev-parse", "--abbrev-ref", "HEAD")).trim();

    await parallel(sameModule);

    expect((await git(repository, "rev-parse", "HEAD")).trim()).toBe(headBefore);
    expect((await git(repository, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(branchBefore);
    expect((await git(repository, "status", "--porcelain")).trim()).toBe("");
    expect(await readFile(join(repository, "src/alpha.js"), "utf8")).toBe(alpha);
  }, 120_000);

  it("stops the integration branch at the merge that was accepted", async () => {
    const result = await parallel(sameModule);

    const landed = result.queue?.landings.find((landing) => landing.landed);
    expect(result.headCommit).toBe(landed?.commit);
  }, 120_000);

  it("puts the reason in the rejected worker's own chain", async () => {
    const result = await parallel(sameModule);

    const rejected = result.workers.find(
      (worker) => worker.workerId === result.queue?.landings.find((one) => !one.landed)?.workerId,
    );
    const attempts = rejected?.evidence.records().filter((entry) => entry.type === "merge-attempt");
    expect(attempts).toHaveLength(1);
  }, 120_000);
});

describe("a worker that cannot even start", () => {
  it("says so on its own chain, so its bundle is not simply empty", async () => {
    let workerEvidence: EvidenceRecorder | null = null;
    const result = await runInParallel({
      repositoryRoot: repository,
      baseRef: "HEAD",
      tasks: ["add a shout to alpha"],
      runId: "run1",
      scratchRoot: join(scratch, "worktrees"),
      coordinator,
      createWorkerSession: async (workerId) => {
        workerEvidence = await openEvidenceSession({
          root: join(scratch, "sessions"),
          sessionId: workerId,
          clock,
        });
        return workerEvidence;
      },
      createModel: () => {
        throw new Error('provider "anthropic" is not configured');
      },
      clock,
      random: createFixedRandom(),
      emit: () => {},
      maxSteps: 8,
      attempts: 0,
      gateOptions: { commandOverrides: gateOverrides },
      redundancy: 1,
      concurrency: 0,
      modelSpec: "fixture:worker",
      abortSignal: new AbortController().signal,
    });

    expect(result.workers[0]?.green).toBe(false);
    expect(result.workers[0]?.detail).toMatch(/not configured/);

    const records = (workerEvidence as EvidenceRecorder | null)?.records() ?? [];
    expect(records.length).toBeGreaterThan(0);
    const payloads = (workerEvidence as EvidenceRecorder | null)?.payloads();
    expect(JSON.stringify([...(payloads?.values() ?? [])])).toMatch(/not configured/);
  }, 120_000);
});

describe("the bundle a parallel run produces", () => {
  it("carries every worker's chain beside the queue's, and verifies whole", async () => {
    const result = await parallel(separateModules);
    const destination = join(scratch, "bundle");

    await exportCombinedBundle({
      coordinator: bundleSourceFromRecorder(coordinator),
      workers: result.workers.map((worker) => ({
        workerId: worker.workerId,
        source: bundleSourceFromRecorder(worker.evidence),
      })),
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });

    const { stdout } = await run(process.execPath, [join(destination, "verify.mjs"), destination], {
      cwd: destination,
    });
    expect(stdout).toContain("bundle verified");
    expect(stdout).toMatch(/worker worker-1/);
    expect(stdout).toMatch(/worker worker-2/);
  }, 120_000);
});

describe("trying each task several ways", () => {
  /** One test with `count` assertions, so two attempts differ by a number the ratchet reads. */
  function shoutTestWith(count: number): string {
    const checks = Array.from(
      { length: count },
      () => "  assert.equal(shoutAlpha(), 'ALPHA');",
    ).join("\n");
    return [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { shoutAlpha } from './alpha.js';",
      "",
      "test('shoutAlpha', () => {",
      checks,
      "});",
      "",
    ].join("\n");
  }

  function attemptWriting(count: number): readonly FixtureTurn[] {
    return scriptFor({
      "src/alpha.js": withShout(alpha, "Alpha", "alpha"),
      "src/alpha-shout.test.js": shoutTestWith(count),
    });
  }

  const oneTask = { "add a shout to alpha": attemptWriting(1) };

  it("writes exactly the record types it always did when each task is tried once", async () => {
    await parallel(oneTask);

    // Pinned deliberately. A run that tries each task once must reach the ledger exactly as
    // it did before any of the selection work existed, so a new record type showing up here
    // is a regression rather than a detail.
    const types = [...new Set(coordinator.records().map((record) => record.type))].sort();
    expect(types).toEqual([
      "file-set-declared",
      "gate-run",
      "merge-attempt",
      "worker-finished",
      "worker-started",
    ]);
  });

  it("names no selection when each task is tried once, because nothing was chosen", async () => {
    const result = await parallel(oneTask);

    expect(result.selections).toEqual([]);
    expect(result.workers.map((worker) => worker.workerId)).toEqual(["worker-1"]);
  });

  it("runs a task as many ways as it was asked, each on its own branch", async () => {
    const result = await parallel(oneTask, {
      redundancy: 3,
      byWorker: {
        "worker-1": attemptWriting(1),
        "worker-2": attemptWriting(2),
        "worker-3": attemptWriting(3),
      },
    });

    expect(result.workers).toHaveLength(3);
    expect(new Set(result.workers.map((worker) => worker.branch)).size).toBe(3);
    expect(result.workers.every((worker) => worker.taskId === "task-1")).toBe(true);
  });

  it("lands the attempt with more assertions, and records why", async () => {
    const result = await parallel(oneTask, {
      redundancy: 3,
      byWorker: {
        "worker-1": attemptWriting(1),
        "worker-2": attemptWriting(5),
        "worker-3": attemptWriting(2),
      },
    });

    const selection = result.selections[0];
    expect(selection?.winner).toBe("worker-2");
    expect(selection?.decidedBy).toBe("assertions");
    expect(result.queue?.landings.map((landing) => landing.workerId)).toEqual(["worker-2"]);
    expect(result.queue?.landings.every((landing) => landing.landed)).toBe(true);
  });

  it("puts the whole ranking on the coordinator's chain, losers included", async () => {
    await parallel(oneTask, {
      redundancy: 2,
      byWorker: { "worker-1": attemptWriting(1), "worker-2": attemptWriting(4) },
    });

    const written = coordinator.records().find((record) => record.type === "attempt-selection");
    const payload = coordinator.payloads().get(written?.payloadDigest ?? "") as {
      ranked: number;
      eligible: number;
      winner: string;
      attempts: { workerId: string }[];
    };

    expect(payload.ranked).toBe(2);
    expect(payload.eligible).toBe(2);
    expect(payload.winner).toBe("worker-2");
    expect(payload.attempts.map((one) => one.workerId).sort()).toEqual(["worker-1", "worker-2"]);
  });

  it("claims the attempt it chose is the one that landed, and the harness checks it", async () => {
    await parallel(oneTask, {
      redundancy: 2,
      byWorker: { "worker-1": attemptWriting(1), "worker-2": attemptWriting(4) },
    });

    const claims = coordinator
      .records()
      .filter((record) => record.type === "claim")
      .map((record) => coordinator.payloads().get(record.payloadDigest));

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      predicate: 'landed == true && workerId == "worker-2"',
      recordKind: "merge-attempt",
    });
  });

  it("renders that claim verified when the chosen attempt did land", async () => {
    await parallel(oneTask, {
      redundancy: 2,
      byWorker: { "worker-1": attemptWriting(1), "worker-2": attemptWriting(4) },
    });

    const dag = buildEvidenceDag(coordinator.records(), coordinator.payloads());
    expect(dag.claims.map((claim) => claim.evaluation.verdict)).toEqual(["verified"]);
  });

  it("renders it unverified when the chosen attempt was refused, naming what was chosen", async () => {
    const collide = {
      "add a shout to alpha": attemptWriting(1),
      "add a shout to alpha again": attemptWriting(1),
    };
    await parallel(collide, {
      redundancy: 2,
      byWorker: {
        "worker-1": attemptWriting(1),
        "worker-2": attemptWriting(4),
        "worker-3": attemptWriting(2),
        // The winner of the second task writes the same file as the winner of the first,
        // with different content, so the queue has a real conflict to refuse.
        "worker-4": attemptWriting(6),
      },
    });

    const dag = buildEvidenceDag(coordinator.records(), coordinator.payloads());
    expect(dag.claims.map((claim) => claim.evaluation.verdict).sort()).toEqual([
      "unverified",
      "verified",
    ]);
    const refused = dag.claims.find((claim) => claim.evaluation.verdict === "unverified");
    expect(refused?.evaluation.reason).toBe("predicate-false");
    expect(refused?.narrative).toMatch(/chose worker-4/);
  });

  it("offers only the winner to the queue, so the losers never conflict with it", async () => {
    const result = await parallel(oneTask, {
      redundancy: 3,
      byWorker: {
        "worker-1": attemptWriting(1),
        "worker-2": attemptWriting(5),
        "worker-3": attemptWriting(2),
      },
    });

    expect(result.queue?.landings).toHaveLength(1);
    expect(result.queue?.landings.some((landing) => landing.reason === "merge-conflict")).toBe(
      false,
    );
  });
});

describe("running a declared task graph", () => {
  const shoutAlpha = "add a shout to alpha";
  const shoutBeta = "add a shout to beta, now that alpha shouts";

  const scripts = {
    [shoutAlpha]: scriptFor({
      "src/alpha.js": withShout(alpha, "Alpha", "alpha"),
      "src/alpha-shout.test.js": shoutTest("Alpha", "alpha"),
    }),
    [shoutBeta]: scriptFor({
      "src/beta.js": withShout(beta, "Beta", "beta"),
      "src/beta-shout.test.js": shoutTest("Beta", "beta"),
    }),
  };

  const graph = readTaskGraph({
    goal: "make both modules shout",
    nodes: [
      {
        id: "alpha",
        title: "alpha shouts",
        instruction: shoutAlpha,
        files: ["src/alpha.js", "src/alpha-shout.test.js"],
      },
      {
        id: "beta",
        title: "beta shouts",
        instruction: shoutBeta,
        files: ["src/beta.js", "src/beta-shout.test.js"],
        dependsOn: ["alpha"],
      },
    ],
  });

  it("declares the graph before it starts a single worker", async () => {
    await parallel(scripts, { graph });

    const types = coordinator.records().map((record) => record.type);
    expect(types.indexOf("task-graph")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("task-graph")).toBeLessThan(types.indexOf("worker-started"));
  });

  it("runs a dependent node against the tree its parent landed", async () => {
    const result = await parallel(scripts, { graph });

    expect(result.workers.map((worker) => worker.task)).toEqual([shoutAlpha, shoutBeta]);
    expect(result.queue?.landings.map((landing) => landing.landed)).toEqual([true, true]);
    expect(result.headCommit).not.toBe(result.baseCommit);
  });

  it("claims every declared node landed, and the harness agrees when they did", async () => {
    await parallel(scripts, { graph });

    const dag = buildEvidenceDag(coordinator.records(), coordinator.payloads());
    const outcome = dag.claims.find((claim) => claim.recordKind === "task-graph-outcome");
    expect(outcome?.predicate).toBe("nodes == 2 && landed == 2");
    expect(outcome?.evaluation.verdict).toBe("verified");
  });

  it("says out loud that it does not check the nodes add up to the goal", async () => {
    await parallel(scripts, { graph });

    const dag = buildEvidenceDag(coordinator.records(), coordinator.payloads());
    const outcome = dag.claims.find((claim) => claim.recordKind === "task-graph-outcome");
    expect(outcome?.narrative).toMatch(/not check|not checkable/i);
  });

  it("blocks a node whose parent never landed, and refuses the claim", async () => {
    const failing = {
      ...scripts,
      [shoutAlpha]: scriptFor({
        "src/alpha.js": "export function alpha() {\n  return 'wrong';\n}\n",
      }),
    };

    const result = await parallel(failing, { graph });

    expect(result.workers.map((worker) => worker.task)).toEqual([shoutAlpha]);

    const dag = buildEvidenceDag(coordinator.records(), coordinator.payloads());
    const outcome = dag.claims.find((claim) => claim.recordKind === "task-graph-outcome");
    expect(outcome?.evaluation.verdict).toBe("unverified");

    const written = coordinator.records().find((record) => record.type === "task-graph-outcome");
    expect(coordinator.payloads().get(written?.payloadDigest ?? "")).toMatchObject({
      landed: 0,
      blocked: ["beta"],
    });
  });
});
