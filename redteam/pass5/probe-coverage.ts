/**
 * Live coverage attacks. New framings relative to pass 2-4 and the loop fixtures:
 * suffix-colliding SF path, parent --import write intercept, isolated child ps+detached
 * overwrite, FN/BRDA-padded omit-DA, quoted-equals isolation sibling.
 */
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { coverageReportingCommand } from "../../src/gates/coverage-artifact.ts";
import { parseUncoveredLines } from "../../src/gates/parsers.ts";
import { createMemoryWorkspace } from "../../src/gates/test-doubles.ts";
import {
  clampSource,
  forgedFull,
  honestClampTest,
  measureThroughTheGate,
  scratchDirs,
} from "./helpers.ts";

describe("coverage probes", () => {
  let workspace = "";
  let outside = "";

  beforeEach(async () => {
    ({ workspace, outside } = await scratchDirs("p5-cov"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("A-suffix: a complete all-hit section for vendor/clamp.mjs is not 100% of clamp.mjs", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const report = [
      "SF:vendor/clamp.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "",
    ].join("\n");
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [report],
    });
    // Succeeds (as an attack) if the harness treats the other file's 100% as this file's.
    console.log("A-suffix", {
      coverage: measured.changedLineCoverage,
      measured: measured.changedLinesMeasured,
      covered: measured.changedLinesCovered,
      files: [...parseUncoveredLines(report).keys()],
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("A-omitda: complete section listing only hit lines of the real file is not 100%", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const report = [
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
    ].join("\n");
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [report],
    });
    console.log("A-omitda", {
      coverage: measured.changedLineCoverage,
      measured: measured.changedLinesMeasured,
      covered: measured.changedLinesCovered,
    });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("A-abspath-suffix: /opt/other/clamp.mjs all-hit is not 100% of clamp.mjs", async () => {
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": clampSource },
    });
    const report = [
      "SF:/opt/other/clamp.mjs",
      ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
      "LF:9",
      "LH:9",
      "end_of_record",
      "",
    ].join("\n");
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [report],
    });
    console.log("A-abspath-suffix", { coverage: measured.changedLineCoverage });
    expect(measured.changedLineCoverage).not.toBe(1);
  });

  it("A-import: parent --import intercept of the reporter write is not trusted", async () => {
    const preload = [
      "import { writeFileSync } from 'node:fs';",
      "import * as fs from 'node:fs';",
      `const forged = ${JSON.stringify(forgedFull)};`,
      "function dest() {",
      "  for (const token of [...process.execArgv, ...process.argv]) {",
      "    const found = String(token).match(/(\\/[^\\s']+\\.lcov)/);",
      "    if (found) return found[1];",
      "  }",
      "  return null;",
      "}",
      "const orig = fs.writeFileSync;",
      "fs.writeFileSync = function(path, data, ...rest) {",
      "  if (String(path).endsWith('.lcov')) return orig.call(this, path, forged, ...rest);",
      "  return orig.call(this, path, data, ...rest);",
      "};",
      "const origWrite = fs.writeFile;",
      "fs.writeFile = function(path, data, ...rest) {",
      "  if (String(path).endsWith('.lcov')) return origWrite.call(this, path, forged, ...rest);",
      "  return origWrite.call(this, path, data, ...rest);",
      "};",
      "const origStream = fs.createWriteStream;",
      "fs.createWriteStream = function(path, options) {",
      "  if (String(path).endsWith('.lcov')) {",
      "    const stream = origStream.call(this, path, options);",
      "    const origEnd = stream.end.bind(stream);",
      "    stream.end = function(chunk, encoding, cb) {",
      "      try { writeFileSync(path, forged); } catch {}",
      "      return origEnd(chunk, encoding, cb);",
      "    };",
      "    return stream;",
      "  }",
      "  return origStream.call(this, path, options);",
      "};",
      "process.on('exit', () => {",
      "  const path = dest();",
      "  if (path) writeFileSync(path, forged);",
      "});",
      "",
    ].join("\n");

    const { measured, cycle } = await measureThroughTheGate({
      workspace,
      outside,
      sessionId: "p5-import",
      testScript: "node --import ./preload.mjs --test",
      testFile: honestClampTest,
      extraFiles: { "preload.mjs": preload },
    });
    console.log("A-import", {
      coverage: measured.changedLineCoverage,
      reportHead: (cycle.coverageReports[0] ?? "").slice(0, 80),
      hasZero: /DA:\d+,0/.test(cycle.coverageReports[0] ?? ""),
      commandDeclined: coverageReportingCommand("node --import ./preload.mjs --test", "/c.lcov"),
    });
    expect(measured.changedLineCoverage).not.toBe(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("A-ps: isolated child discovers the dest via ps and overwrites after the reporter", async () => {
    const testFile = [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { spawnSync, spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'import { clamp } from "./clamp.mjs";',
      `const forged = ${JSON.stringify(forgedFull)};`,
      "function destFromPs() {",
      "  const listed = spawnSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' });",
      "  const hit = listed.stdout.match(/(\\/[^\\s']+\\.lcov)/);",
      "  return hit ? hit[1] : null;",
      "}",
      'test("inside", () => {',
      "  assert.equal(clamp(5, 0, 10), 5);",
      "  const dest = destFromPs();",
      "  if (dest) {",
      "    const child = spawn(process.execPath, ['-e', `const fs=require('fs');const d=${JSON.stringify('__DEST__')};const f=${JSON.stringify(forgedFull)};const t=setInterval(()=>{if(fs.existsSync(d)){fs.writeFileSync(d,f);clearInterval(t);process.exit(0);}},15);setTimeout(()=>process.exit(0),8000);`.replace('__DEST__', dest)], { detached: true, stdio: 'ignore' });",
      "    child.unref();",
      "    writeFileSync(dest, forged);",
      "  }",
      "});",
      "",
    ].join("\n");

    const { measured, cycle } = await measureThroughTheGate({
      workspace,
      outside,
      sessionId: "p5-ps",
      testScript: "node --test",
      testFile,
    });
    console.log("A-ps", {
      coverage: measured.changedLineCoverage,
      hasZero: /DA:\d+,0/.test(cycle.coverageReports[0] ?? ""),
      reportHasForgedLh: (cycle.coverageReports[0] ?? "").includes("LH:9"),
    });
    expect(measured.changedLineCoverage).not.toBe(1);
    expect(cycle.coverageReports[0] ?? "").toMatch(/DA:\d+,0/);
  });

  it("A-iso-eq: --test-isolation = none with spaces around equals is stripped or abstains", () => {
    const rewritten = coverageReportingCommand("node --test --test-isolation = none", "/c.lcov");
    console.log("A-iso-eq", { rewritten });
    const leavesNone = rewritten?.includes("none") ?? false;
    const forced = rewritten?.includes("--test-isolation=process") ?? false;
    expect(rewritten === null || (forced && !leavesNone)).toBe(true);
  });

  it("A-iso-unicode: fullwidth-equals isolation is stripped or the command is declined", () => {
    const rewritten = coverageReportingCommand("node --test --test-isolation＝none", "/c.lcov");
    console.log("A-iso-unicode", { rewritten });
    const leavesNone = rewritten?.includes("none") ?? false;
    const forced = rewritten?.includes("--test-isolation=process") ?? false;
    expect(rewritten === null || (forced && !leavesNone)).toBe(true);
  });
});
