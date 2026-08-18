import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestClock } from "../../src/core/test-doubles.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createFileCoverageArtifactStore } from "../../src/gates/coverage-artifact.ts";
import { assembleGates } from "../../src/gates/default-gates.ts";
import { runGateCycle } from "../../src/gates/gate-runner.ts";
import { takeMeasureSnapshot } from "../../src/gates/measure-snapshot.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { createMemoryWorkspace } from "../../src/gates/test-doubles.ts";

export const clampSource = [
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

export const forgedFull = [
  "SF:clamp.mjs",
  ...Array.from({ length: 9 }, (_unused, index) => `DA:${index + 1},1`),
  "LF:9",
  "LH:9",
  "end_of_record",
  "",
].join("\n");

export async function readFileOrNull(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

export async function scratchDirs(prefix: string): Promise<{
  workspace: string;
  outside: string;
}> {
  return {
    workspace: await mkdtemp(join(tmpdir(), `${prefix}-ws-`)),
    outside: await mkdtemp(join(tmpdir(), `${prefix}-out-`)),
  };
}

export async function measureThroughTheGate(options: {
  workspace: string;
  outside: string;
  sessionId: string;
  testScript: string;
  testFile: string;
  extraFiles?: Readonly<Record<string, string>>;
  source?: string;
}) {
  const source = options.source ?? clampSource;
  await writeFile(join(options.workspace, "clamp.mjs"), source);
  await writeFile(join(options.workspace, "clamp.test.mjs"), options.testFile);
  await writeFile(
    join(options.workspace, "package.json"),
    JSON.stringify({ name: "scratch", scripts: { test: options.testScript } }),
  );
  for (const [name, contents] of Object.entries(options.extraFiles ?? {})) {
    await writeFile(join(options.workspace, name), contents);
  }

  const probe = createMemoryWorkspace({
    base: { "clamp.mjs": "export const nothing = 0;\n" },
    current: { "clamp.mjs": source },
  });
  const gates = assembleGates(await detectProject((path) => readFileOrNull(options.workspace, path)), {
    coverageArtifactDirectory: join(options.outside, "coverage"),
  });
  const cycle = await runGateCycle(
    gates.filter((gate) => gate.id === "tests"),
    {
      workspaceRoot: options.workspace,
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
        root: join(options.outside, "sessions"),
        sessionId: options.sessionId,
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
  return { cycle, measured, probe };
}

export const honestClampTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "./clamp.mjs";',
  'test("inside", () => { assert.equal(clamp(5, 0, 10), 5); });',
  "",
].join("\n");
