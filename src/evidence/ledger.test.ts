import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LedgerSealedError,
  LedgerWriteFailedError,
  parseLedgerText,
  verifyChain,
} from "./ledger.ts";
import { openEvidenceSession } from "./session.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ledger-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const entry = (note: string) => ({
  type: "tool-call" as const,
  actor: "harness",
  provenance: ["model" as const],
  payload: { note },
});

describe("the evidence ledger", () => {
  it("chains every record to the one before it", async () => {
    const session = await openEvidenceSession({ root, sessionId: "s", now: () => 1 });
    await session.record(entry("one"));
    await session.record(entry("two"));
    const parsed = parseLedgerText(await readFile(session.ledgerPath, "utf8"));
    expect(verifyChain(parsed.records)).toMatchObject({ ok: true, recordCount: 2 });
  });

  it("reports a record changed after it was written", async () => {
    const session = await openEvidenceSession({ root, sessionId: "s", now: () => 1 });
    await session.record(entry("one"));
    await session.record(entry("two"));
    const text = await readFile(session.ledgerPath, "utf8");
    const altered = text.replace('"actor":"harness"', '"actor":"someone"');
    expect(verifyChain(parseLedgerText(altered).records).ok).toBe(false);
  });

  it("refuses to resume a damaged chain rather than repairing it", async () => {
    const session = await openEvidenceSession({ root, sessionId: "s", now: () => 1 });
    await session.record(entry("one"));
    await writeFile(session.ledgerPath, "{not json\n", { flag: "a" });
    await expect(openEvidenceSession({ root, sessionId: "s", now: () => 1 })).rejects.toThrow(
      /cannot be resumed/,
    );
  });

  it("aborts on a failed write and records nothing after it", async () => {
    let fail = true;
    const session = await openEvidenceSession({
      root,
      sessionId: "s",
      now: () => 1,
      ledgerWrite: async () => {
        if (fail) throw new Error("disk full");
      },
    });
    await expect(session.record(entry("one"))).rejects.toThrow(LedgerWriteFailedError);
    fail = false;
    await expect(session.record(entry("two"))).rejects.toThrow(LedgerSealedError);
  });

  it("scrubs known credential patterns before anything is stored", async () => {
    const session = await openEvidenceSession({ root, sessionId: "s", now: () => 1 });
    const recorded = await session.record({
      ...entry(""),
      payload: { api_key: "sk-live-abcdefgh12345678" },
    });
    const stored = await session.blobs.bytes(recorded.record.payloadDigest);
    expect(stored).not.toContain("sk-live-abcdefgh12345678");
    expect(recorded.redactions.length).toBeGreaterThan(0);
  });

  it("keeps the session owner-only", async () => {
    const session = await openEvidenceSession({ root, sessionId: "s", now: () => 1 });
    expect((await stat(session.directory)).mode & 0o777).toBe(0o700);
  });
});
