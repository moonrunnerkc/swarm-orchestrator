import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import { type QueueCandidate, runMergeQueue } from "./merge-queue.ts";
import { addWorktree, headCommit } from "./worktree.ts";

const run = promisify(execFile);
const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

let scratch = "";
let repository = "";
let evidence: EvidenceRecorder;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

/** A repository whose tests pass, so the queue starts from a green base. */
const seedTest = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { alpha } from './alpha.js';",
  "import { beta } from './beta.js';",
  "",
  "test('alpha', () => { assert.equal(alpha(), 'alpha'); });",
  "test('beta', () => { assert.equal(beta(), 'beta'); });",
  "",
].join("\n");

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-queue-"));
  repository = join(scratch, "repo");
  await run("git", ["init", "--quiet", repository]);
  await git(repository, "config", "user.email", "queue@example.com");
  await git(repository, "config", "user.name", "queue");
  await write(repository, "src/alpha.js", "export function alpha() {\n  return 'alpha';\n}\n");
  await write(repository, "src/beta.js", "export function beta() {\n  return 'beta';\n}\n");
  await write(repository, "src/suite.test.js", seedTest);
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "seed");

  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "queue-session",
    clock,
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A finished worker: a branch with one commit, its working copy already gone. */
async function worker(
  name: string,
  edits: Readonly<Record<string, string>>,
): Promise<{ branch: string; files: readonly string[] }> {
  const worktree = await addWorktree({
    repositoryRoot: repository,
    path: join(scratch, name),
    branch: `swarm/${name}`,
    baseRef: "HEAD",
  });
  for (const [path, contents] of Object.entries(edits)) {
    await write(worktree.path, path, contents);
  }
  await worktree.commitAll(`work by ${name}`);
  await worktree.remove();
  return { branch: worktree.branch, files: Object.keys(edits) };
}

/** alpha.js with one extra line at the end: two of these conflict, and neither breaks a test. */
function alphaWith(extra: string): string {
  return `export function alpha() {\n  return 'alpha';\n}\n${extra}\n`;
}

const gateOverrides = {
  // No reporter of its own: the harness adds the ones it needs, and the collected count comes
  // from the TAP that run writes to a path under the session store. A command carrying a
  // reporter flag is one the harness cannot vouch for, so it would be asked for no artifact.
  tests: "node --test",
  lint: "node --check src/alpha.js",
  typecheck: "node --check src/beta.js",
  format: "node --check src/suite.test.js",
};

interface QueueFixture {
  readonly branch: string;
  readonly files: readonly string[];
  readonly workerId: string;
  readonly alternates?: readonly QueueFixture[];
}

async function queue(candidates: readonly QueueFixture[]) {
  const integration = await addWorktree({
    repositoryRoot: repository,
    path: join(scratch, "integration"),
    branch: "swarm/integration",
    baseRef: "HEAD",
  });

  return runMergeQueue({
    integrationPath: integration.path,
    baseCommit: await headCommit(integration.path),
    candidates: candidates.map(function asCandidate(candidate): QueueCandidate {
      return {
        workerId: candidate.workerId,
        branch: candidate.branch,
        task: `task for ${candidate.workerId}`,
        declaredFiles: candidate.files,
        evidence,
        alternates: (candidate.alternates ?? []).map(asCandidate),
      };
    }),
    evidence,
    fileSet: createFileSetRegistry(evidence),
    clock,
    emit: () => {},
    gateOptions: { commandOverrides: gateOverrides },
  });
}

describe("runMergeQueue with work that does not collide", () => {
  it("lands both, one after the other", async () => {
    const one = await worker("one", {
      "src/alpha.js": "export function alpha() {\n  return 'alpha';\n}\nexport const one = 1;\n",
    });
    const two = await worker("two", {
      "src/beta.js": "export function beta() {\n  return 'beta';\n}\nexport const two = 2;\n",
    });

    const result = await queue([
      { ...one, workerId: "one" },
      { ...two, workerId: "two" },
    ]);

    expect(result.landings.map((landing) => landing.landed)).toEqual([true, true]);
    expect(result.headCommit).not.toBe(result.baseCommit);
  });

  it("runs the full gate set at every merge, not only at the end", async () => {
    const one = await worker("one", {
      "src/alpha.js": "export function alpha() {\n  return 'alpha';\n}\n// one\n",
    });
    const two = await worker("two", {
      "src/beta.js": "export function beta() {\n  return 'beta';\n}\n// two\n",
    });

    const result = await queue([
      { ...one, workerId: "one" },
      { ...two, workerId: "two" },
    ]);

    for (const landing of result.landings) {
      expect(landing.cycle?.runs.some((gate) => gate.gateId.includes("tests"))).toBe(true);
    }
  });

  it("declares the union of what the workers declared, so the file-set gate can rule", async () => {
    const one = await worker("one", {
      "src/alpha.js": "export function alpha() {\n  return 'alpha';\n}\n// one\n",
    });

    const result = await queue([{ ...one, workerId: "one" }]);

    const fileSet = result.landings[0]?.cycle?.runs.find((gate) => gate.gateId === "file-set");
    expect(fileSet?.status).toBe("passed");
  });
});

describe("runMergeQueue when two workers touch the same lines", () => {
  it("lands the first and refuses the second, naming the file", async () => {
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });
    const two = await worker("two", { "src/alpha.js": alphaWith("export const two = 2;") });

    const result = await queue([
      { ...one, workerId: "one" },
      { ...two, workerId: "two" },
    ]);

    expect(result.landings[0]).toMatchObject({ workerId: "one", landed: true });
    expect(result.landings[1]).toMatchObject({
      workerId: "two",
      landed: false,
      reason: "merge-conflict",
    });
    expect(result.landings[1]?.feedback).toMatch(/src\/alpha\.js/);
  });

  it("leaves the integration tree on the last commit it accepted", async () => {
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });
    const two = await worker("two", { "src/alpha.js": alphaWith("export const two = 2;") });

    const result = await queue([
      { ...one, workerId: "one" },
      { ...two, workerId: "two" },
    ]);

    expect(result.headCommit).toBe(result.landings[0]?.commit);
  });
});

describe("runMergeQueue when a merge breaks the gates", () => {
  it("refuses it and hands back the gates' own output", async () => {
    // Merges cleanly, because it only touches beta.js, and then fails the suite.
    const breaking = await worker("breaks", {
      "src/beta.js": "export function beta() {\n  return 'broken';\n}\n",
    });

    const result = await queue([{ ...breaking, workerId: "breaks" }]);

    expect(result.landings[0]).toMatchObject({ landed: false, reason: "gates" });
    expect(result.landings[0]?.feedback).toMatch(/tests/);
    expect(result.headCommit).toBe(result.baseCommit);
  });

  it("puts the tree back, so the next candidate starts from an accepted state", async () => {
    const breaking = await worker("breaks", {
      "src/beta.js": "export function beta() {\n  return 'broken';\n}\n",
    });
    const good = await worker("good", {
      "src/alpha.js": "export function alpha() {\n  return 'alpha';\n}\n// good\n",
    });

    const result = await queue([
      { ...breaking, workerId: "breaks" },
      { ...good, workerId: "good" },
    ]);

    expect(result.landings.map((landing) => landing.landed)).toEqual([false, true]);
    expect(result.headCommit).toBe(result.landings[1]?.commit);
  });
});

/** suite.test.js with the beta test removed: still valid, still passes, but one test fewer. */
const suiteWithoutBeta = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { alpha } from './alpha.js';",
  "",
  "test('alpha', () => { assert.equal(alpha(), 'alpha'); });",
  "",
].join("\n");

describe("runMergeQueue when a merge is green but takes the tree backwards", () => {
  it("refuses it on the ratchet, not the gates, and leaves the tree on the base commit", async () => {
    // Merges cleanly (only the test file changes) and the remaining test still passes, so
    // every gate goes green. The tree now runs one test fewer than the base did, which no
    // boolean gate can see and only the ratchet catches. This is the one guard that stops
    // two individually-green workers from jointly eroding the integrated suite.
    const erodes = await worker("erodes", { "src/suite.test.js": suiteWithoutBeta });

    const result = await queue([{ ...erodes, workerId: "erodes" }]);

    expect(result.landings[0]).toMatchObject({ landed: false, reason: "ratchet" });
    expect(result.landings[0]?.decision?.accepted).toBe(false);
    expect(result.landings[0]?.decision?.violations.map((violation) => violation.kind)).toContain(
      "tests-collected-decreased",
    );
    expect(result.landings[0]?.feedback).toMatch(/backwards/);
    expect(result.headCommit).toBe(result.baseCommit);
  });
});

describe("what the queue records", () => {
  it("writes a merge attempt to the coordinator's chain for every candidate", async () => {
    const one = await worker("one", {
      "src/alpha.js": "export function alpha() {\n  return 'alpha';\n}\n// one\n",
    });

    await queue([{ ...one, workerId: "one" }]);

    expect(evidence.records().filter((entry) => entry.type === "merge-attempt")).toHaveLength(1);
  });

  it("returns the rejection to the worker's own chain, so its bundle carries the reason", async () => {
    const workerEvidence = await openEvidenceSession({
      root: join(scratch, "sessions"),
      sessionId: "worker-two",
      clock,
    });
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });
    const two = await worker("two", { "src/alpha.js": alphaWith("export const two = 2;") });

    const integration = await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "integration"),
      branch: "swarm/integration",
      baseRef: "HEAD",
    });
    await runMergeQueue({
      integrationPath: integration.path,
      baseCommit: await headCommit(integration.path),
      candidates: [
        { workerId: "one", branch: one.branch, task: "one", declaredFiles: one.files, evidence },
        {
          workerId: "two",
          branch: two.branch,
          task: "two",
          declaredFiles: two.files,
          evidence: workerEvidence,
        },
      ],
      evidence,
      fileSet: createFileSetRegistry(evidence),
      clock,
      emit: () => {},
      gateOptions: { commandOverrides: gateOverrides },
    });

    const returned = workerEvidence
      .records()
      .filter((entry) => entry.type === "merge-attempt")
      .map((entry) => workerEvidence.payloads().get(entry.payloadDigest));
    expect(returned).toHaveLength(1);
    expect(JSON.stringify(returned[0])).toMatch(/merge-conflict/);
  });
});

describe("a candidate that carries the attempts ranked behind it", () => {
  it("says which role and rank landed, so a reviewer knows it was the chosen one", async () => {
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });

    await queue([{ ...one, workerId: "one" }]);

    const written = evidence
      .records()
      .filter((entry) => entry.type === "merge-attempt")
      .map((entry) => evidence.payloads().get(entry.payloadDigest));
    expect(written[0]).toMatchObject({ role: "winner", rank: 1 });
  });

  it("falls to the next attempt when the integrated gates refuse the chosen one", async () => {
    // Merges cleanly and passes on its own, but the integrated tree fails the tests gate,
    // which is the one rejection a structurally different patch at the same task can survive.
    const breaks = await worker("breaks", {
      "src/alpha.js": "export function alpha() {\n  return 'broken';\n}\n",
    });
    const works = await worker("works", { "src/alpha.js": alphaWith("export const works = 1;") });

    const result = await queue([
      { ...breaks, workerId: "breaks", alternates: [{ ...works, workerId: "works" }] },
    ]);

    expect(result.landings.map((landing) => [landing.workerId, landing.landed])).toEqual([
      ["breaks", false],
      ["works", true],
    ]);
  });

  it("marks the attempt that stepped in as a fallback at its own rank", async () => {
    const breaks = await worker("breaks", {
      "src/alpha.js": "export function alpha() {\n  return 'broken';\n}\n",
    });
    const works = await worker("works", { "src/alpha.js": alphaWith("export const works = 1;") });

    await queue([{ ...breaks, workerId: "breaks", alternates: [{ ...works, workerId: "works" }] }]);

    const written = evidence
      .records()
      .filter((entry) => entry.type === "merge-attempt")
      .map((entry) => evidence.payloads().get(entry.payloadDigest));
    expect(written).toMatchObject([
      { workerId: "breaks", role: "winner", rank: 1 },
      { workerId: "works", role: "fallback", rank: 2 },
    ]);
  });

  it("does not fall back over a conflict, which the next attempt at one task shares", async () => {
    const first = await worker("first", { "src/alpha.js": alphaWith("export const first = 1;") });
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });
    const two = await worker("two", { "src/alpha.js": alphaWith("export const two = 2;") });

    const result = await queue([
      { ...first, workerId: "first" },
      { ...one, workerId: "one", alternates: [{ ...two, workerId: "two" }] },
    ]);

    expect(result.landings.map((landing) => landing.workerId)).toEqual(["first", "one"]);
    expect(result.landings[1]).toMatchObject({ landed: false, reason: "merge-conflict" });
  });
});

describe("a queue that runs again over the same chain", () => {
  it("amends the declared set on a later pass rather than declaring twice", async () => {
    const fileSet = createFileSetRegistry(evidence);
    const one = await worker("one", { "src/alpha.js": alphaWith("export const one = 1;") });
    const integration = await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "integration"),
      branch: "swarm/integration",
      baseRef: "HEAD",
    });

    async function pass(branch: string, files: readonly string[]) {
      return runMergeQueue({
        integrationPath: integration.path,
        baseCommit: await headCommit(integration.path),
        candidates: [
          { workerId: "one", branch, task: "one", declaredFiles: files, evidence, alternates: [] },
        ],
        evidence,
        fileSet,
        clock,
        emit: () => {},
        gateOptions: { commandOverrides: gateOverrides },
      });
    }

    await pass(one.branch, one.files);
    await expect(pass(one.branch, ["src/beta.js"])).resolves.toBeDefined();

    const types = evidence.records().map((record) => record.type);
    expect(types.filter((type) => type === "file-set-declared")).toHaveLength(1);
    expect(types.filter((type) => type === "file-set-amended")).toHaveLength(1);
    expect(fileSet.state().allowed.has("src/beta.js")).toBe(true);
  });
});
