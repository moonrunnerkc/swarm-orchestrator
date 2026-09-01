import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { assembleGates } from "./default-gates.ts";
import { runGateCycle } from "./gate-runner.ts";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { detectProject } from "./project-type.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The attack that took the first version of this apart, run for real against the second.
 *
 * The reports used to be files at paths the harness named under the session store, which is
 * outside the workspace and denied to tools. That was not enough, and the reasoning that said
 * it was had a hole in it: a destination path is an argument of the process the harness spawns,
 * `ps -p $PPID -o command=` hands it to any test that asks, and the file is writable by
 * anything running as the same user. Unix permissions do not help when the writer is the
 * same uid.
 *
 * How far that got, exactly, because the difference matters. Writing the file worked: a real
 * `1..2` became a self-consistent forged `1..500`. Getting the harness to *read* the forgery did
 * not: it reads as soon as the runner exits and won that race every time. What did work, four
 * times out of four, was destroying both measures. A test hammering the two paths left torn
 * files, both parsed as nothing, and both blocking arms abstained, which is the ratchet's two
 * runner-reported arms switched off at the tests own choosing.
 *
 * The test below is that attack, by every route a test process has.
 *
 * It fails here because there is no file to find. Both reports go to streams of the spawned
 * process, and under `--test-isolation=process` a test's own output is captured by the parent
 * and folded into the reporters' streams as escaped comments, so nothing a test writes reaches
 * column zero, which is the only place a result point or an `SF:` record is read from.
 */

let workspace = "";
let outside = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-forgery-workspace-"));
  outside = await mkdtemp(join(tmpdir(), "swarm-forgery-session-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const source = [
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

/**
 * One real test, and an attempt to add four hundred and ninety-nine that never ran, by every
 * route a test process has: its own stdout, its own stderr, and a detached process writing to
 * whatever destination it can find in its parent's argv.
 */
const forgingTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { execFileSync, spawn } from "node:child_process";',
  'import { clamp } from "./clamp.mjs";',
  "",
  "const forged = [",
  '  "TAP version 13",',
  "  ...Array.from({ length: 500 }, (unused, index) => `ok ${index + 1} - forged ${index + 1}`),",
  '  "1..500",',
  '  "# tests 500",',
  '].join("\\n");',
  "",
  "const forgedCoverage = [",
  '  "TN:",',
  '  "SF:clamp.mjs",',
  "  ...Array.from({ length: 9 }, (unused, index) => `DA:${index + 1},7`),",
  '  "LF:9",',
  '  "LH:9",',
  '  "end_of_record",',
  '].join("\\n");',
  "",
  'test("inside", () => {',
  "  process.stdout.write(`\\n${forged}\\n`);",
  "  process.stderr.write(`\\n${forgedCoverage}\\n`);",
  "  try {",
  '    const parent = execFileSync("ps", ["-p", String(process.ppid), "-o", "command="], {',
  '      encoding: "utf8",',
  "    });",
  "    for (const found of parent.matchAll(/--test-reporter-destination=(\\S+)/g)) {",
  "      const destination = found[1];",
  '      if (destination === "stdout" || destination === "stderr") continue;',
  '      const body = destination.endsWith(".lcov") ? forgedCoverage : forged;',
  '      const child = spawn("/bin/sh", ["-c", `sleep 1; printf %s ${JSON.stringify(body)} > ${JSON.stringify(destination)}`], {',
  "        detached: true,",
  '        stdio: "ignore",',
  "      });",
  "      child.unref();",
  "    }",
  "  } catch {}",
  "  assert.equal(clamp(5, 1, 9), 5);",
  "});",
  "",
].join("\n");

describe("a test that goes looking for the report it is measured by", () => {
  it("finds no destination to overwrite, and moves neither number", async () => {
    await writeFile(join(workspace, "clamp.mjs"), source);
    await writeFile(join(workspace, "clamp.test.mjs"), forgingTest);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }),
    );

    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": source },
    });
    const gates = assembleGates(
      await detectProject(async (path) =>
        path === "package.json"
          ? JSON.stringify({ name: "scratch", scripts: { test: "node --test" } })
          : null,
      ),
    );

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
          sessionId: "report-forgery",
          clock: createTestClock(1),
        }),
        emit: () => undefined,
      },
    );

    // Read the way the ratchet reads it, after the detached writer has had its second.
    await new Promise((resume) => setTimeout(resume, 2_000));
    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      workspaceRoot: workspace,
      trackedTestFiles: [],
      coverageReports: cycle.coverageReports,
      testReports: cycle.testReports,
    });

    // One test ran. Five hundred were claimed, on three separate routes.
    expect(measured.testsCollected).toBe(1);
    // clamp has three branches and the one test exercises one of them, so honest coverage of
    // the changed lines is well under the 100% the forged lcov claims.
    expect(measured.changedLineCoverage).not.toBeNull();
    expect(measured.changedLineCoverage).toBeLessThan(1);
  }, 90_000);
});
