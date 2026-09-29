import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { taskPresetSchema } from "../evidence/task-preset.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import { observeUpgradeResolution } from "./upgrade-resolution.ts";

let scratch = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-upgrade-resolution-"));
  await writeFile(join(scratch, "pyproject.toml"), '[project]\ndependencies=["example==2.0.0"]\n');
  await writeFile(join(scratch, "uv.lock"), "version = 1\n");
  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "upgrade-resolution",
    clock: createTestClock(),
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const preset = taskPresetSchema.parse({
  kind: "upgrade",
  manager: "uv",
  manifest: "pyproject.toml",
  lockfile: "uv.lock",
  dependencies: [{ name: "example", section: "dependencies", version: "2.0.0" }],
  sourcePaths: [],
});

function reporting(stdout: string): GateCommandRunner {
  const observation = { exitCode: 0, stdout, stderr: "", durationMs: 1, unavailable: null };
  return { run: async () => observation, runVouched: async () => observation };
}

it("records only the declared dependencies from the project environment's report", async () => {
  if (preset.kind !== "upgrade") throw new Error("fixture");
  // The report is printed inside the project's own environment, which can add names to it.
  const digest = await observeUpgradeResolution({
    preset,
    checkout: scratch,
    commands: reporting('{"example":"2.0.0","injected":"9.9.9"}'),
    evidence,
    timeoutMs: 1000,
  });
  expect(evidence.payloads().get(digest)).toMatchObject({
    rule: "upgrade-resolution-v1",
    matched: true,
    versions: { example: "2.0.0" },
  });
  expect(JSON.stringify(evidence.payloads().get(digest))).not.toContain("injected");
});

it("treats a declared dependency the report omits as unresolved", async () => {
  if (preset.kind !== "upgrade") throw new Error("fixture");
  await expect(
    observeUpgradeResolution({
      preset,
      checkout: scratch,
      commands: reporting('{"other":"2.0.0"}'),
      evidence,
      timeoutMs: 1000,
    }),
  ).rejects.toThrow("installed dependency versions do not match the sealed upgrade targets");
});
