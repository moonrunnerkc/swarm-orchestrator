/**
 * Pass-3 red-team closures. Not wired into the engine or the default vitest include.
 *
 * Each test asserts the behaviour the harness should have after the hole is closed.
 * Running this file against the current tree is expected to fail: that is the finding.
 *
 *   npx vitest run --config redteam/pass3/vitest.config.ts
 *
 * Do not "fix" these by widening a check until a documented residual turns green.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import type { JsonValue } from "../../src/evidence/canonical-json.ts";
import { evaluateClaim } from "../../src/evidence/claim.ts";
import { buildEvidenceDag } from "../../src/evidence/dag.ts";
import { indexCitedRecords } from "../../src/evidence/record-index.ts";
import {
  findBlockingSecrets,
  findKnownSecrets,
  scrubJson,
} from "../../src/evidence/scrub.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../../src/evidence/session.ts";
import * as embedded from "../../src/evidence/verifier/verify.mjs";
import { createFileCoverageArtifactStore } from "../../src/gates/coverage-artifact.ts";
import { assembleGates } from "../../src/gates/default-gates.ts";
import type { GateContext } from "../../src/gates/gate-definition.ts";
import { runGateCycle } from "../../src/gates/gate-runner.ts";
import { secretScanGate } from "../../src/gates/inspection-gates.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { parseTestOutcomes, parseUncoveredLines } from "../../src/gates/parsers.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";
import { createMemoryWorkspace } from "../../src/gates/test-doubles.ts";

const clampSource = [
  "export function clamp(value, low, high) {",
  "  if (value < low) {",
  "    return low;",
  "  }",
  "  if (value > high) {",
  "    return high;",
  "  }",
  "  return value;",
  "}",
  "",
].join("\n");

async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

async function inspectSecret(current: Record<string, string>) {
  const probe = createMemoryWorkspace({
    base: Object.fromEntries(Object.keys(current).map((path) => [path, "{}\n"])),
    current,
  });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet: {
      declared: Object.keys(current),
      amendments: [],
      allowed: new Set(Object.keys(current)),
      wasDeclared: true,
      editedBeforeAuthorized: [],
    },
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
  };
  if (secretScanGate.source.kind !== "inspection") {
    throw new Error("secret-scan is an inspection");
  }
  return secretScanGate.parse(await secretScanGate.source.inspect(context));
}

describe("A the test process authors an lcov the harness then trusts", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pass3-a-ws-"));
    outside = await mkdtemp(join(tmpdir(), "pass3-a-out-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("does not trust a 100% lcov written by the test when isolation is none", async () => {
    const forged = [
      "SF:clamp.mjs",
      "DA:1,1",
      "DA:2,1",
      "DA:3,1",
      "DA:4,1",
      "DA:5,1",
      "DA:6,1",
      "DA:7,1",
      "DA:8,1",
      "end_of_record",
      "",
    ].join("\n");
    await writeFile(join(workspace, "clamp.mjs"), clampSource);
    await writeFile(
      join(workspace, "clamp.test.mjs"),
      [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { writeFileSync } from "node:fs";',
        'import { clamp } from "./clamp.mjs";',
        `const forged = ${JSON.stringify(forged)};`,
        "function dest() {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
        "    if (found) return found[1];",
        "  }",
        "  return null;",
        "}",
        "process.on('exit', () => { const path = dest(); if (path) writeFileSync(path, forged); });",
        'test("inside", () => {',
        "  assert.equal(clamp(5, 0, 10), 5);",
        "  const path = dest();",
        "  if (path) writeFileSync(path, forged);",
        "});",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --test --test-isolation=none" } }),
    );

    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const gates = assembleGates(await detectProject((path) => readFileOrNull(workspace, path)), {
      coverageArtifactDirectory: join(outside, "coverage"),
    });
    const cycle = await runGateCycle(
      gates.filter((gate) => gate.id === "tests"),
      {
        workspaceRoot: workspace,
        changes: await probe.changes(),
        fileSet: {
          declared: ["clamp.mjs"],
          amendments: [],
          allowed: new Set(["clamp.mjs"]),
          wasDeclared: true,
          editedBeforeAuthorized: [],
        },
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        probe,
      },
      0,
      {
        commands: createNodeCommandRunner(createTestClock(1)),
        evidence: await openEvidenceSession({
          root: join(outside, "sessions"),
          sessionId: "pass3-a",
          clock: createTestClock(1),
        }),
        emit: () => undefined,
        coverageArtifacts: createFileCoverageArtifactStore(),
      },
    );
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: cycle.measures,
      coverageReports: cycle.coverageReports,
    });

    // Honest coverage of this fixture is about 0.5. A number of 1 is the test's own file.
    expect(measured.changedLineCoverage).not.toBeNull();
    expect(measured.changedLineCoverage).toBeLessThan(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("treats a truncated or header-only lcov as not measured, not as 100%", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const changes = await probe.changes();

    for (const report of [
      "SF:clamp.mjs\n",
      "SF:clamp.mjs\nend_of_record\n",
      "SF:clamp.mjs\nDA:1,1\nend_of_record\n",
      [
        "start of coverage report",
        "file | line % | branch % | funcs % | uncovered lines",
        "clamp.mjs | 100.00 | 100.00 | 100.00 | ",
        "end of coverage report",
      ].join("\n"),
    ]) {
      const measured = await takeMeasureSnapshot({
        changes,
        probe,
        trackedTestFiles: [],
        gateMeasures: {},
        coverageReports: [report],
      });
      expect({ report: report.slice(0, 24), coverage: measured.changedLineCoverage }).toEqual({
        report: report.slice(0, 24),
        coverage: null,
      });
    }
  });
});

describe("B a later colliding record must not un-verify an earlier honest claim", () => {
  let root = "";
  let evidence: EvidenceRecorder;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pass3-b-"));
    evidence = await openEvidenceSession({
      root,
      sessionId: "pass3-b",
      clock: createTestClock(1),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the original verdict after a different kind reuses the same digest", async () => {
    const payload: JsonValue = { gateId: "tests", status: "passed", extra: "pass3-unique" };
    const run = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    const claim = {
      predicate: 'status == "passed"',
      record: run.record.payloadDigest,
      recordKind: "gate-run:tests",
      narrative: "the tests gate passed",
    };
    const atSubmit = await evidence.submitClaim(claim, "harness");
    expect(atSubmit.verdict).toBe("verified");

    await evidence.record({
      type: "tool-call",
      actor: "fixture",
      provenance: ["model"],
      payload,
    });

    const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
    const liveIndex = indexCitedRecords(evidence.records(), evidence.payloads());
    const live = evaluateClaim(claim, (digest) => liveIndex.get(digest));
    const offline = embedded.evaluateClaim(claim, (digest: string) => liveIndex.get(digest));

    expect(dag.claims[0]?.evaluation.verdict).toBe("verified");
    expect(live.verdict).toBe("verified");
    expect(offline.verdict).toBe("verified");
  });
});

describe("C the three scrub sites still have to agree on the same input", () => {
  it("catches a pretty-printed PIN array at write time, export scan, and the gate", async () => {
    const pretty = `${JSON.stringify({ PIN: [4, 8, 2, 9, 1, 7] }, null, 2)}\n`;
    const written = scrubJson({ PIN: [4, 8, 2, 9, 1, 7] });
    const gate = await inspectSecret({ "cfg.json": pretty });

    expect(JSON.stringify(written.value)).not.toMatch(/4,\s*8,\s*2,\s*9,\s*1,\s*7/);
    expect(findKnownSecrets(pretty).length).toBeGreaterThan(0);
    expect(findBlockingSecrets(pretty).length).toBeGreaterThan(0);
    expect(gate.status).toBe("failed");
  });

  it("catches a compact nested PIN the export scan currently swallows", () => {
    const compact = JSON.stringify({ secrets: { inner: { deeper: { PIN: 482917 } } } });
    const written = scrubJson({ secrets: { inner: { deeper: { PIN: 482917 } } } });

    expect(JSON.stringify(written.value)).not.toContain("482917");
    expect(findKnownSecrets(compact)).toContain("credential-assignment");
    expect(findBlockingSecrets(compact)).toContain("credential-assignment");
  });

  it("catches a credential-named object whose child primitives carry the secret", () => {
    const value = { PIN: { note: "ok", payload: "48291736" } };
    const written = scrubJson(value);
    const compact = JSON.stringify(value);
    const pretty = JSON.stringify(value, null, 2);

    expect(JSON.stringify(written.value)).not.toContain("48291736");
    expect(findKnownSecrets(compact).length).toBeGreaterThan(0);
    expect(findKnownSecrets(pretty).length).toBeGreaterThan(0);
    expect(findBlockingSecrets(compact).length).toBeGreaterThan(0);
  });
});

describe("D forged or confused base-control attribution must not clear a test", () => {
  it("does not treat a printed spec fail marker as a named base failure", async () => {
    const specOut = [
      "✖ innocentNew",
      "not ok 1 - innocentNew",
      "✖ multiplies (0.7ms)",
      "✔ innocentNew (0.1ms)",
      "ℹ fail 1",
      "",
    ].join("\n");
    const outcomes = parseTestOutcomes(specOut);
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: specOut,
            exitCode: 1,
            failedTests: outcomes === null ? null : outcomes.failed,
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed",
            detail: "ok",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies", "innocentNew"] },
    );

    expect(finding.newSpecifications).toEqual(["multiplies"]);
    expect(finding.newSpecifications).not.toContain("innocentNew");
  });

  it("withholds the exemption when the base failure is a CJS missing-export TypeError", async () => {
    const detail = [
      "✖ multiplies (0.7ms)",
      "  TypeError: mul is not a function",
      "not ok 1 - multiplies",
      "",
    ].join("\n");
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail,
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed",
            detail: "ok",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );

    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
    expect(finding.reason).toMatch(/load|not a function|did not run/i);
  });
});

describe("sanity: parseUncoveredLines still has a table fallback the artifact path can feed", () => {
  it("documents the current hole so a closer can see the table path", () => {
    // This file is expected to fail once the hole is closed. Today a table with no SF:
    // is parsed as "every named file is fully covered".
    const uncovered = parseUncoveredLines(
      [
        "start of coverage report",
        "file | line % | branch % | funcs % | uncovered lines",
        "clamp.mjs | 100.00 | 100.00 | 100.00 | ",
        "end of coverage report",
      ].join("\n"),
    );
    expect(
      uncovered.get("clamp.mjs") === undefined || (uncovered.get("clamp.mjs")?.size ?? 0) > 0,
    ).toBe(true);
  });
});
