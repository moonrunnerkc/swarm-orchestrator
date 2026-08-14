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

async function parallel(scripts: Readonly<Record<string, readonly FixtureTurn[]>>) {
  return runInParallel({
    repositoryRoot: repository,
    baseRef: "HEAD",
    tasks: Object.keys(scripts),
    runId: "run1",
    scratchRoot: join(scratch, "worktrees"),
    coordinator,
    createWorkerSession: (workerId) =>
      openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
    createModel: (_workerId, evidence) => modelFor(scripts, evidence),
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 8,
    attempts: 0,
    gateOptions: { commandOverrides: gateOverrides },
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
