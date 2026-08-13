import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle, readBundle } from "./bundle.ts";
import { renderReplay, replayBundle } from "./replay.ts";
import { openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";

let root = "";
let sessionRoot = "";
let destination = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-replay-"));
  sessionRoot = join(root, "sessions");
  destination = join(root, "bundle");

  const evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: "replay-session",
    clock: createTestClock(1_700_000_000_000),
  });
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "rename the widget module" },
  });
  const { record } = await evidence.record({
    type: "tool-call",
    actor: "harness",
    provenance: ["model"],
    payload: {
      toolName: "shell",
      decision: "allowed",
      detail: "812 bytes returned",
      facts: { command: "npm test", exitCode: 0 },
      tests: { collected: 47, failed: 0 },
    },
  });
  await evidence.submitClaim(
    { predicate: "facts.exitCode == 0", record: record.payloadDigest, narrative: "" },
    "test-model",
  );
  await evidence.submitClaim(
    { predicate: "facts.exitCode == 0", record: null, narrative: "it all works" },
    "test-model",
  );
  await evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["model"],
    payload: { stopReason: "completed", steps: 3, tokensUsed: 900, completionNarrative: "done" },
  });

  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock: createTestClock(1_700_000_100_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function snapshot(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const rows: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const path = join(entry.parentPath, entry.name);
    const stats = await stat(path);
    rows.push(`${path} ${stats.size} ${stats.mtimeMs} ${await readFile(path, "utf8")}`);
  }
  return rows.sort();
}

describe("replay", () => {
  it("re-renders the run from the bundle alone, with the session store gone", async () => {
    await rm(sessionRoot, { recursive: true, force: true });

    const lines = (await replayBundle(destination)).join("\n");

    expect(lines).toContain("rename the widget module");
    expect(lines).toContain("allowed shell");
    expect(lines).toContain("hash chain intact");
    expect(lines).toContain("signature over the chain head: valid");
    expect(lines).toContain("completed after 3 steps");
  });

  it("shows the harness verdicts, not the model's account of them", async () => {
    const lines = (await replayBundle(destination)).join("\n");

    expect(lines).toContain("VERIFIED   #2 facts.exitCode == 0");
    expect(lines).toContain("UNVERIFIED #3 facts.exitCode == 0 [no-evidence-edge]");
    expect(lines).toContain("1 of 2 claims verified by the harness");
  });

  it("writes nothing at all", async () => {
    const before = await snapshot(destination);
    await replayBundle(destination);
    expect(await snapshot(destination)).toEqual(before);
  });

  it("reports a broken chain instead of rendering a run that never happened", async () => {
    const bundle = await readBundle(destination);
    const records = [...bundle.records];
    const second = records[1];
    if (second === undefined) {
      throw new Error("the fixture bundle should have more than one record");
    }
    records[1] = { ...second, actor: "someone-else" };

    const lines = renderReplay({ records, payloads: bundle.payloads }).join("\n");

    expect(lines).toContain("hash chain BROKEN");
  });
});
