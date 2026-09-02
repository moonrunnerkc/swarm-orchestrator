import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bondVerdict } from "../gates/bonds.ts";
import { assembleGateSet, defaultDiffBudget, runGatesEngine } from "../gates/engine.ts";
import { createFileSetRegistry } from "../gates/file-set.ts";
import { describeGateSet, sealGateSet } from "../gates/gate-set-seal.ts";
import { exitCodeParser, inspectionParser, testOutputParser } from "../gates/parsers.ts";
import { bundleSourceFromRecorder, exportBundle } from "./bundle.ts";
import { digestOfBytes } from "./canonical-json.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";
import * as rederive from "./verifier/rederive.mjs";
import * as verify from "./verifier/verify.mjs";

const run = promisify(execFile);

/**
 * The re-derivation script reimplements the parser rules in plain JavaScript, because a
 * bundle must be re-derivable without this package. These hold the two to each other.
 */
describe("the re-derivation script agrees with the parsers it ships beside", () => {
  const observations = [
    { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: null },
    { exitCode: 1, stdout: "boom", stderr: "", durationMs: 1, unavailable: null },
    {
      exitCode: 127,
      stdout: "",
      stderr: "sh: nope: command not found",
      durationMs: 1,
      unavailable: null,
    },
    { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: "no script" },
    {
      exitCode: 0,
      stdout: "TAP version 13\n# tests 3\n# pass 3\n# fail 0\n",
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    {
      exitCode: 1,
      stdout: "TAP version 13\n# tests 3\n# pass 2\n# fail 1\n",
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    {
      exitCode: 0,
      stdout: "# tests 0\n# pass 0\n# fail 0\n",
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    { exitCode: 0, stdout: " Tests  4 passed (4)\n", stderr: "", durationMs: 1, unavailable: null },
    {
      exitCode: 1,
      stdout: " Tests  1 failed | 3 passed (4)\n",
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    { exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 1, unavailable: null },
    {
      exitCode: 0,
      stdout: '{"detail":"fine","measures":{}}',
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    {
      exitCode: 1,
      stdout: '{"detail":"bad","measures":{}}',
      stderr: "",
      durationMs: 1,
      unavailable: null,
    },
    { exitCode: 0, stdout: "not json", stderr: "", durationMs: 1, unavailable: null },
  ];

  it("reads the exit-code, test-output and inspection rules the same way", () => {
    for (const observation of observations) {
      expect(rederive.readStatus("exit-code", observation), JSON.stringify(observation)).toBe(
        exitCodeParser(observation).status,
      );
      expect(rederive.readStatus("test-output", observation), JSON.stringify(observation)).toBe(
        testOutputParser(observation).status,
      );
      expect(rederive.readStatus("inspection", observation), JSON.stringify(observation)).toBe(
        inspectionParser(observation).status,
      );
    }
  });

  it("reads the no-output rule the way the go format gate does", () => {
    expect(rederive.readStatus("no-output", { exitCode: 0, stdout: "", stderr: "" })).toBe(
      "passed",
    );
    expect(rederive.readStatus("no-output", { exitCode: 0, stdout: "a.go\n", stderr: "" })).toBe(
      "failed",
    );
    expect(rederive.readStatus("no-output", { exitCode: 2, stdout: "", stderr: "" })).toBe(
      "failed",
    );
  });

  it("names a rule it does not know rather than guessing", () => {
    expect(rederive.readStatus("oracle", { exitCode: 0, stdout: "", stderr: "" })).toBeNull();
  });

  it("recomputes bond verdicts by the same rule as the harness", () => {
    for (const observed of ["passed", "failed", "not-applicable"] as const) {
      for (const provable of [true, false]) {
        for (const [before, after] of [
          [null, null],
          [3, 3],
          [3, 4],
          [4, 3],
        ] as const) {
          const input = { observed, provable, collectedBefore: before, collectedAfter: after };
          expect(verify.bondVerdict(input), JSON.stringify(input)).toBe(bondVerdict(input));
        }
      }
    }
  });

  it("finds the violations the ratchet's measures imply", () => {
    const decision = {
      scope: "retry",
      attempt: 1,
      accepted: true,
      violations: [],
      respecification: [],
      newSpecifications: [],
      measures: {
        before: {
          testsCollected: 5,
          testsDeclared: 5,
          assertions: 9,
          skipMarkers: 0,
          changedLineCoverage: 1,
        },
        after: {
          testsCollected: 4,
          testsDeclared: 4,
          assertions: 8,
          skipMarkers: 1,
          changedLineCoverage: 0.5,
        },
      },
      gates: { before: { tests: "passed" }, after: { tests: "failed" } },
    };

    expect(rederive.rederiveRatchet(decision).violations).toEqual([
      "gate-regressed",
      "tests-declared-decreased",
      "assertions-decreased",
      "skip-markers-increased",
      "tests-collected-decreased",
      "changed-line-coverage-decreased",
    ]);
  });
});

describe("re-deriving a bundle the real engine produced", () => {
  let workspace: string;
  let sessionRoot: string;
  let bundleDirectory: string;
  let evidence: EvidenceRecorder;

  const clock = { now: () => 1_700_000_000_000, sleep: async () => {} };

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "rederive-workspace-"));
    sessionRoot = await mkdtemp(join(tmpdir(), "rederive-session-"));
    bundleDirectory = join(sessionRoot, "bundle");
    await mkdir(join(workspace, "test"), { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      `${JSON.stringify({ name: "rederive-fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
    );
    await writeFile(
      join(workspace, "clamp.mjs"),
      "export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));\n",
    );
    await writeFile(
      join(workspace, "test", "clamp.test.mjs"),
      'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { clamp } from "../clamp.mjs";\n\ntest("clamps", () => {\n  assert.equal(clamp(11, 0, 10), 10);\n});\n',
    );
    const git = (...args: string[]) =>
      run(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: workspace },
      );
    await git("init", "-q");
    await git("add", "-A");
    await git("commit", "-q", "-m", "base");
    // The run's one change: a comment, so every gate has something to measure and passes.
    await writeFile(
      join(workspace, "clamp.mjs"),
      "// clamp keeps a value inside a range\nexport const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));\n",
    );
    evidence = await openEvidenceSession({ root: sessionRoot, sessionId: "rederive", clock });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(sessionRoot, { recursive: true, force: true });
  });

  it("seals the criteria, bonds every pass, exports both scripts, and both agree with the ledger", async () => {
    const baseRef = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const fileSet = createFileSetRegistry(evidence);
    await fileSet.declare(["clamp.mjs"], "test");
    const assembled = await assembleGateSet({ workspaceRoot: workspace, baseRef });
    await sealGateSet(
      evidence,
      describeGateSet({
        detection: assembled.detection,
        gates: assembled.gates,
        budgets: defaultDiffBudget,
        attemptCap: 0,
      }),
    );

    const engine = await runGatesEngine({
      workspaceRoot: workspace,
      baseRef,
      evidence,
      fileSet,
      clock,
      emit: () => {},
      cap: 0,
      criteriaSealed: true,
      resolve: () => Promise.reject(new Error("no retries in this test")),
    });

    expect(engine.outcome.settled).toBe("green");
    const byGate = Object.fromEntries(engine.bonds.map((bond) => [bond.gateId, bond.verdict]));
    expect(byGate.tests).toBe("held");
    expect(byGate.placeholder).toBe("held");
    expect(byGate["secret-scan"]).toBe("held");
    expect(byGate["file-set"]).toBe("held");
    expect(byGate["diff-budget"]).toBe("held");
    expect(await readFile(join(workspace, "clamp.mjs"), "utf8")).toContain("// clamp keeps");

    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination: bundleDirectory,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const manifest = JSON.parse(await readFile(join(bundleDirectory, "manifest.json"), "utf8"));
    expect(manifest.bundleFormat).toBe(2);

    const verified = await run(process.execPath, [
      join(bundleDirectory, "verify.mjs"),
      bundleDirectory,
    ]);
    expect(verified.stdout).toContain("PASS  gate runs conform to the sealed criteria");
    expect(verified.stdout).toContain("PASS  bond verdicts recomputed");
    expect(verified.stdout).toContain("bundle verified: every check passed");

    const rederived = await run(process.execPath, [
      join(bundleDirectory, "rederive.mjs"),
      bundleDirectory,
    ]);
    expect(rederived.stdout).not.toContain("DISAGREES");
    expect(rederived.stdout).toContain("AGREES        sealed criteria");
    expect(rederived.stdout).toMatch(/gate-bond \d+ tests: failed over the bond, so held/);
    expect(rederived.stdout).toContain("every re-derived verdict agrees");
  });
});

describe("a bundle that lies about a gate", () => {
  it("is caught by re-derivation, since the recorded bytes read the other way", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rederive-liar-"));
    try {
      const payload = {
        gateId: "tests",
        title: "tests",
        severity: "blocking",
        status: "passed",
        blocking: true,
        detail: "the command exited 0",
        attempt: 0,
        command: "npm test",
        argv: null,
        parser: "exit-code",
        exitCode: 1,
        durationMs: 1,
        unavailable: null,
        stdout: "",
        stderr: "1 failing",
        outputTruncated: false,
        measures: {},
      };
      const bytes = JSON.stringify(payload);
      const digest = digestOfBytes(bytes);
      await mkdir(join(directory, "blobs"));
      await writeFile(join(directory, "blobs", `${digest.replace("sha256:", "")}.json`), bytes);
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({ bundleFormat: 1, claims: { verified: 0, unverified: 0 } }),
      );
      await writeFile(
        join(directory, "ledger.jsonl"),
        `${JSON.stringify({ sequence: 0, type: "gate-run", payloadDigest: digest })}\n`,
      );
      const lines: string[] = [];

      const exitCode = rederive.rederiveBundle(directory, (line: string) => lines.push(line));

      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "DISAGREES     gate-run 0 tests: recorded passed, the exit-code rule reads failed",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
