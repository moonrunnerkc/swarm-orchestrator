import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { verifyArchive } from "./verify-archive.mjs";

it("refuses a changed artifact and a duplicate inventory entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campaign-inventory-"));
  try {
    const entry = { path: "observation.json", bytes: 2, digest: digestOfBytes("{}") };
    await writeFile(join(directory, entry.path), "{}");
    await writeFile(
      join(directory, "inventory.json"),
      JSON.stringify({ version: 1, sources: [entry] }),
    );
    expect((await verifyArchive(directory)).ok).toBe(true);
    await writeFile(join(directory, entry.path), "[]");
    expect((await verifyArchive(directory)).ok).toBe(false);
    await writeFile(
      join(directory, "inventory.json"),
      JSON.stringify({ version: 1, sources: [entry, entry] }),
    );
    expect((await verifyArchive(directory)).problems).toContain(
      "invalid inventory path observation.json",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects a summary that changes a recorded development failure into success", async () => {
  const { mkdir } = await import("node:fs/promises");
  const { summarizeCampaign } = await import("./report.mjs");
  const directory = await mkdtemp(join(tmpdir(), "campaign-summary-"));
  try {
    const row = {
      runId: "one",
      caseId: "case",
      arm: "swarm",
      status: "failed",
      heldBackAccepted: null,
      certified: null,
      totalMs: 1,
      tokens: 0,
      cleanup: "confirmed",
    };
    const schedule = [{ runId: "one", caseId: "case", arm: "swarm" }];
    const summary = summarizeCampaign([row], schedule);
    summary.arms[0].accepted = 1;
    const sources = [];
    for (const [path, value] of Object.entries({
      "recheck/protocol.json": { schedule, sources: {} },
      "recheck/summary.json": summary,
      "recheck/runs/one.json": row,
    })) {
      const bytes = JSON.stringify(value);
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), bytes);
      sources.push({ path, bytes: Buffer.byteLength(bytes), digest: digestOfBytes(bytes) });
    }
    await writeFile(join(directory, "inventory.json"), JSON.stringify({ version: 1, sources }));
    expect((await verifyArchive(directory)).problems).toContain(
      "recheck/campaign summary does not follow from scheduled outcomes",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
