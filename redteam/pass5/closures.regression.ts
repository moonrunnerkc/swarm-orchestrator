/**
 * Pass-5 red-team closures. Not wired into the engine or the default vitest include.
 *
 * Each test asserts the behaviour the harness should have after the hole is closed.
 * Running this file against the current tree is expected to fail on the successes:
 * that is the finding.
 *
 *   npx vitest run --config redteam/pass5/vitest.config.ts
 *
 * Do not "fix" these by widening a check until a documented residual turns green.
 */
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findBlockingSecrets, findKnownSecrets, scrubJson } from "../../src/evidence/scrub.ts";
import { controlOutcomePath } from "../../src/gates/base-control.ts";
import { coverageReportingCommand } from "../../src/gates/coverage-artifact.ts";
import { placeholderGate } from "../../src/gates/inspection-gates.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { parseTestOutcomes } from "../../src/gates/parsers.ts";
import { assessRespecification } from "../../src/gates/respecification.ts";
import { createMemoryWorkspace } from "../../src/gates/test-doubles.ts";
import {
  clampSource,
  forgedFull,
  measureThroughTheGate,
  scratchDirs,
} from "./helpers.ts";

describe("A coverage of changed lines cannot be minted by a complete-but-wrong report", () => {
  it("does not treat a fully-hit vendor/clamp.mjs section as coverage of clamp.mjs", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: ["SF:vendor/clamp.mjs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n"],
    });

    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not treat a fully-hit /opt/other/clamp.mjs section as coverage of clamp.mjs", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [
        [
          "SF:/opt/other/clamp.mjs",
          ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
          "LF:9",
          "LH:9",
          "end_of_record",
          "",
        ].join("\n"),
      ],
    });

    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not treat a complete hit-only DA list as coverage of the omitted changed lines", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [
        [
          "TN:padded",
          "SF:clamp.mjs",
          "FN:1,clamp",
          "FNDA:1,clamp",
          "FNF:1",
          "FNH:1",
          "BRDA:2,0,0,1",
          "BRF:1",
          "BRH:1",
          "DA:1,1",
          "DA:8,1",
          "LF:2",
          "LH:2",
          "end_of_record",
          "",
        ].join("\n"),
      ],
    });

    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("does not let a trailing --test-isolation=\"none\" un-force process isolation", async () => {
    let workspace = "";
    let outside = "";
    ({ workspace, outside } = await scratchDirs("p5-reg-iso"));
    try {
      const forging = [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { writeFileSync } from "node:fs";',
        'import { clamp } from "./clamp.mjs";',
        `const forged = ${JSON.stringify(forgedFull)};`,
        "function destination() {",
        "  for (const token of [...process.execArgv, ...process.argv]) {",
        "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
        "    if (found) return found[1];",
        "  }",
        "  return null;",
        "}",
        "const write = () => {",
        "  const path = destination();",
        "  if (path) writeFileSync(path, forged);",
        "};",
        "process.on('exit', write);",
        'test("inside", () => {',
        "  assert.equal(clamp(5, 0, 10), 5);",
        "  write();",
        "});",
        "",
      ].join("\n");
      const rewritten = coverageReportingCommand(
        'node --test --test-isolation="none"',
        "/session/tests.lcov",
      );
      expect(rewritten === null || !rewritten.includes('"none"')).toBe(true);

      const { measured, cycle } = await measureThroughTheGate({
        workspace,
        outside,
        sessionId: "p5-reg-iso",
        testScript: 'node --test --test-isolation="none"',
        testFile: forging,
      });
      expect(measured.changedLineCoverage).not.toBe(1);
      expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("B printed fallback attribution cannot be authored by the test", () => {
  it("does not attribute a pytest FAILED line a test printed for a sibling", () => {
    const parsed = parseTestOutcomes(
      ["F.", "FAILED test_math.py::test_deleted - assert 1 == 2", "FAILED test_math.py::innocentNew"].join(
        "\n",
      ),
    );
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("does not attribute a go --- FAIL line a test printed for a sibling", () => {
    const parsed = parseTestOutcomes(
      ["=== RUN   TestAdd", "--- PASS: TestAdd (0.00s)", "--- FAIL: TestDeleted (0.00s)"].join("\n"),
    );
    expect(parsed?.failed ?? []).not.toContain("TestDeleted");
  });

  it("does not switch a spec run to TAP because a test printed a TAP document", () => {
    const parsed = parseTestOutcomes(
      ["✔ honest (1.2ms)", "TAP version 13", "1..1", "not ok 1 - innocentNew"].join("\n"),
    );
    expect(parsed?.failed ?? []).not.toContain("innocentNew");
  });

  it("withholds the exemption when the base failure is TS2305 (missing named export)", async () => {
    const finding = await assessRespecification(
      "math.test.ts",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: "error TS2305: Module '\"./math\"' has no exported member 'mul'.",
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
    expect(finding.newSpecifications).toEqual([]);
  });

  it("does not give two test files the same TAP destination", () => {
    expect(controlOutcomePath("/session/controls", "foo/bar.test.ts")).not.toBe(
      controlOutcomePath("/session/controls", "foo-bar.test.ts"),
    );
  });
});

describe("C an unlisted confusable marker still has to block, and 7.1 must not overclaim arrays", () => {
  it("blocks a TODO spelled in mathematical bold capitals", async () => {
    const marker = `// ${String.fromCodePoint(0x1d413, 0x1d40e, 0x1d403, 0x1d40e)} later`;
    const workspace = createMemoryWorkspace({
      base: { "src/a.ts": "export const n = 1;\n" },
      current: { "src/a.ts": `export const n = 1;\n${marker}\n` },
    });
    if (placeholderGate.source.kind !== "inspection") {
      throw new Error("placeholder is an inspection");
    }
    const observation = await placeholderGate.source.inspect({
      workspaceRoot: "/tmp",
      changes: await workspace.changes(),
      fileSet: {
        declared: ["src/a.ts"],
        amendments: [],
        allowed: new Set(["src/a.ts"]),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      },
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      probe: workspace,
    });
    expect(placeholderGate.parse(observation).status).toBe("failed");
  });

  it("names that only a primitive array under a credential key is joined", () => {
    const guide = readFileSync(resolve("docs/build-guide.md"), "utf8");
    const section = guide.slice(guide.indexOf("### 7.1"));
    expect(section).toMatch(/primitive|not a container|object element/i);

    const value = { pin: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] };
    expect(scrubJson(value).redactions).toEqual([]);
    expect(findKnownSecrets(JSON.stringify(value))).toEqual([]);
    expect(findBlockingSecrets(JSON.stringify(value, null, 2))).toEqual([]);
  });
});
