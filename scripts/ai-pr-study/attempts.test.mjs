import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginAttempt,
  classifyFailure,
  finishAttempt,
  listAttempts,
  makeRunId,
  openRun,
  RunIdentityError,
  retryDecision,
  runPaths,
  standingAttempt,
} from "./attempts.mjs";
import { inventory } from "./inventory.mjs";
import { assembleRow, loadRows } from "./rows.mjs";

const identity = {
  verifierVersion: "1.0.7",
  frameDigest: `sha256:${"a".repeat(64)}`,
  harnessCommit: "b".repeat(40),
};

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "study-runs-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("makeRunId", () => {
  it("names the verifier, the frame, the harness commit and the moment, and labels development", () => {
    const startedAt = new Date("2026-09-29T10:15:00.123Z");
    expect(makeRunId({ ...identity, startedAt })).toBe(
      `sv1.0.7-f${"a".repeat(12)}-h${"b".repeat(12)}-20260929T101500Z`,
    );
    expect(makeRunId({ ...identity, startedAt, development: true })).toMatch(/^dev-sv1\.0\.7-/);
    expect(() => makeRunId({ ...identity, verifierVersion: "../x", startedAt })).toThrow(
      RunIdentityError,
    );
  });
});

describe("openRun", () => {
  it("creates a manifest once and resumes it only under the same identity and budgets", () => {
    const opened = openRun(root, { identity, budgets: { maxAttempts: 2 }, development: true });
    expect(opened.budgets.maxAttempts).toBe(2);
    const manifestBytes = readFileSync(opened.paths.manifest, "utf8");
    const resumed = openRun(root, { resume: opened.runId, identity });
    expect(resumed.runId).toBe(opened.runId);
    expect(resumed.budgets.maxAttempts).toBe(2);
    expect(() =>
      openRun(root, { resume: opened.runId, identity, budgets: { maxAttempts: 9 } }),
    ).toThrow(/keeps the budgets/);
    expect(() =>
      openRun(root, { resume: opened.runId, identity: { ...identity, verifierVersion: "1.0.8" } }),
    ).toThrow(/cannot resume/);
    expect(() => openRun(root, { resume: "no-such-run", identity })).toThrow(/no run/);
    expect(readFileSync(opened.paths.manifest, "utf8")).toBe(manifestBytes);
  });
});

describe("attempt files", () => {
  it("cannot be overwritten, and each attempt keeps its intent and result", () => {
    const rows = join(root, "rows");
    mkdirSync(rows);
    const first = beginAttempt(rows, 3, "verifier", { runId: "r" });
    expect(first.attempt).toBe(1);
    finishAttempt(rows, 3, "verifier", 1, { outcome: "executed" });
    expect(() => finishAttempt(rows, 3, "verifier", 1, { outcome: "doctored" })).toThrow(
      /already has a result/,
    );
    expect(JSON.parse(readFileSync(join(rows, "03.verifier.attempt-1.json"), "utf8")).outcome).toBe(
      "executed",
    );
    const second = beginAttempt(rows, 3, "verifier", { runId: "r" });
    expect(second.attempt).toBe(2);
    expect(
      listAttempts(rows, 3, "verifier").map((entry) => [
        entry.attempt,
        entry.result?.outcome ?? null,
      ]),
    ).toEqual([
      [1, "executed"],
      [2, null],
    ]);
  });

  it("resume keeps every attempt, counts an interrupted one, and cannot refresh the cap", () => {
    const opened = openRun(root, { identity, budgets: { maxAttempts: 2 }, development: true });
    const rows = opened.paths.rows;
    // Attempt 1 failed on infrastructure; attempt 2 started and the process died.
    beginAttempt(rows, 1, "suite", {});
    finishAttempt(rows, 1, "suite", 1, {
      failure: { kind: "infrastructure", reason: "ECONNRESET" },
    });
    beginAttempt(rows, 1, "suite", {});
    const resumed = openRun(root, { resume: opened.runId, identity });
    const attempts = listAttempts(resumed.paths.rows, 1, "suite");
    expect(attempts).toHaveLength(2);
    const decision = retryDecision(attempts, resumed.budgets.maxAttempts);
    expect(decision.run).toBe(false);
    expect(decision.reason).toMatch(/2 attempts are spent/);
    expect(readdirSync(rows).sort()).toEqual([
      "01.suite.attempt-1.json",
      "01.suite.attempt-1.started.json",
      "01.suite.attempt-2.started.json",
    ]);
  });
});

describe("retryDecision, the written replacement rule", () => {
  const attempt = (n, result) => ({ attempt: n, started: {}, result });
  it("retries only infrastructure failures, up to the cap", () => {
    expect(retryDecision([], 3).run).toBe(true);
    expect(retryDecision([attempt(1, { outcome: "executed" })], 3).run).toBe(false);
    expect(
      retryDecision([attempt(1, { failure: { kind: "product", reason: "refused" } })], 3).run,
    ).toBe(false);
    expect(
      retryDecision([attempt(1, { failure: { kind: "harness", reason: "TypeError" } })], 3).run,
    ).toBe(false);
    const retry = retryDecision(
      [attempt(1, { failure: { kind: "infrastructure", reason: "daemon" } })],
      3,
    );
    expect(retry).toMatchObject({ run: true, retryOf: 1 });
    expect(retryDecision([attempt(1, null)], 3).run).toBe(true);
    expect(retryDecision([attempt(1, null), attempt(2, null), attempt(3, null)], 3).run).toBe(
      false,
    );
  });

  it("classifies network and daemon failures as infrastructure whatever kind was written", () => {
    expect(
      classifyFailure({ failure: { kind: "product", reason: "npm ERR! code ECONNRESET" } }).kind,
    ).toBe("infrastructure");
    expect(
      classifyFailure({ failure: { kind: "product", reason: "exit 1: 3 tests failed" } }).kind,
    ).toBe("product");
    expect(classifyFailure({ outcome: "executed" }).kind).toBe("none");
  });

  it("stands on the last finished attempt and reports every attempt", () => {
    const standing = standingAttempt([
      attempt(1, { failure: { kind: "infrastructure", reason: "ETIMEDOUT" } }),
      attempt(2, { outcome: "executed" }),
    ]);
    expect(standing.standing).toEqual({ outcome: "executed" });
    expect(standing.history.map((entry) => entry.failure.kind)).toEqual(["infrastructure", "none"]);
  });
});

describe("assembling rows from a run", () => {
  it("reads each arm's standing attempt with the history beside it", () => {
    const opened = openRun(root, { identity, development: true });
    const rows = opened.paths.rows;
    const write = (arm, result) => {
      const { attempt, record } = beginAttempt(rows, 4, arm, { runId: opened.runId });
      finishAttempt(rows, 4, arm, attempt, { ...record, ...result });
    };
    write("fetch", { pr: { index: 4, repository: "o/r", number: 9, author: "bot" } });
    write("suite", { failure: { kind: "infrastructure", reason: "daemon" } });
    write("suite", {
      originalSuite: { head: { status: "passed", collected: 3 } },
      setup: { head: {} },
    });
    write("verifier", {
      outcome: "executed",
      verdict: { refusal: "identity" },
      evidence: { valid: false, detail: "x" },
    });
    const row = assembleRow(opened.paths.run, 4);
    expect(row).toMatchObject({ runId: opened.runId, repository: "o/r", outcome: "executed" });
    expect(row.originalSuite.head.status).toBe("passed");
    expect(row.evidence.valid).toBe(false);
    expect(row.attempts.suite).toHaveLength(2);
    expect(loadRows(opened.paths.run)).toHaveLength(1);
  });
});

describe("inventory", () => {
  it("lists runs and labels the unversioned cache legacy without deleting anything", () => {
    mkdirSync(join(root, "diffs"));
    writeFileSync(join(root, "diffs", "01.diff"), "x");
    mkdirSync(join(root, "owner__repo-1", ".git"), { recursive: true });
    const opened = openRun(root, { identity, development: true });
    beginAttempt(opened.paths.rows, 1, "fetch", {});
    const found = inventory(root);
    expect(found.runs).toHaveLength(1);
    expect(found.runs[0]).toMatchObject({
      runId: opened.runId,
      development: true,
      unfinishedAttempts: ["01.fetch.attempt-1"],
    });
    expect(found.legacy.map((entry) => [entry.name, entry.kind])).toEqual([
      ["diffs", "unversioned results"],
      ["owner__repo-1", "unversioned clone"],
    ]);
    expect(found.legacy.every((entry) => entry.label.startsWith("legacy"))).toBe(true);
    expect(existsSync(join(root, "diffs", "01.diff"))).toBe(true);
    expect(existsSync(runPaths(root, opened.runId).manifest)).toBe(true);
  });
});
