/**
 * Live confirmation that leftover isolation flags actually hand the test the destination.
 */
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coverageReportingCommand } from "../../src/gates/coverage-artifact.ts";
import { forgedFull, measureThroughTheGate, scratchDirs } from "./helpers.ts";

const forgingFromArgv = [
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

describe("live isolation leftovers", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    ({ workspace, outside } = await scratchDirs("p5-live"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("A-iso-eq-live: spaced equals leaves the test able to author 100%", async () => {
    const body = "node --test --test-isolation = none";
    console.log("rewrite", coverageReportingCommand(body, "/tmp/x.lcov"));
    const { measured, cycle } = await measureThroughTheGate({
      workspace,
      outside,
      sessionId: "p5-iso-eq",
      testScript: body,
      testFile: forgingFromArgv,
    });
    console.log("A-iso-eq-live", {
      coverage: measured.changedLineCoverage,
      hasZero: /DA:\d+,0/.test(cycle.coverageReports[0] ?? ""),
      reportLh: /LH:(\d+)/.exec(cycle.coverageReports[0] ?? "")?.[1],
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("A-iso-unicode-live: fullwidth equals leaves the test able to author 100%", async () => {
    const body = "node --test --test-isolation＝none";
    const { measured, cycle } = await measureThroughTheGate({
      workspace,
      outside,
      sessionId: "p5-iso-uni",
      testScript: body,
      testFile: forgingFromArgv,
    });
    console.log("A-iso-unicode-live", {
      coverage: measured.changedLineCoverage,
      hasZero: /DA:\d+,0/.test(cycle.coverageReports[0] ?? ""),
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("A-iso-quoted-double: double-quoted none is a sibling of the quoted-single hole", async () => {
    const body = 'node --test --test-isolation="none"';
    const rewritten = coverageReportingCommand(body, "/tmp/x.lcov");
    console.log("A-iso-quoted-double rewrite", rewritten);
    const { measured, cycle } = await measureThroughTheGate({
      workspace,
      outside,
      sessionId: "p5-iso-dq",
      testScript: body,
      testFile: forgingFromArgv,
    });
    console.log("A-iso-quoted-double", {
      coverage: measured.changedLineCoverage,
      hasZero: /DA:\d+,0/.test(cycle.coverageReports[0] ?? ""),
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });
});
