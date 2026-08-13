import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { digestOfJson } from "./canonical-json.ts";
import {
  LedgerSealedError,
  LedgerWriteFailedError,
  openLedger,
  parseLedgerText,
  verifyChain,
} from "./ledger.ts";
import { genesisHash, hashOfRecord, type LedgerRecord } from "./ledger-record.ts";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-ledger-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function payloadDigest(seed: string): string {
  return digestOfJson({ seed });
}

async function openTestLedger(
  overrides: { write?: (path: string, line: string) => Promise<void> } = {},
) {
  const clock = createTestClock(1_700_000_000_000);
  const ledger = await openLedger({
    path: join(directory, "ledger.jsonl"),
    clock,
    ...overrides,
  });
  return { ledger, clock };
}

describe("append-only ledger", () => {
  it("starts at genesis and chains each record to the one before it", async () => {
    const { ledger } = await openTestLedger();

    const first = await ledger.append({
      type: "session-started",
      actor: "harness",
      payloadDigest: payloadDigest("one"),
      provenance: ["user"],
    });
    const second = await ledger.append({
      type: "tool-call",
      actor: "harness",
      payloadDigest: payloadDigest("two"),
      provenance: ["model"],
    });

    expect(first.sequence).toBe(0);
    expect(first.previousHash).toBe(genesisHash);
    expect(second.sequence).toBe(1);
    expect(second.previousHash).toBe(hashOfRecord(first));
    expect(ledger.head()).toEqual({
      hash: hashOfRecord(second),
      sequence: 1,
      recordCount: 2,
    });
  });

  it("takes the timestamp from the injected clock, never the ambient one", async () => {
    const { ledger, clock } = await openTestLedger();

    const first = await ledger.append({
      type: "tool-call",
      actor: "harness",
      payloadDigest: payloadDigest("one"),
      provenance: ["model"],
    });
    clock.advance(5_000);
    const second = await ledger.append({
      type: "tool-call",
      actor: "harness",
      payloadDigest: payloadDigest("two"),
      provenance: ["model"],
    });

    expect(first.timestamp).toBe(1_700_000_000_000);
    expect(second.timestamp).toBe(1_700_000_005_000);
  });

  it("writes one JSON object per line, appended in order", async () => {
    const { ledger } = await openTestLedger();
    for (const seed of ["a", "b", "c"]) {
      await ledger.append({
        type: "tool-call",
        actor: "harness",
        payloadDigest: payloadDigest(seed),
        provenance: ["model"],
      });
    }

    const text = await readFile(join(directory, "ledger.jsonl"), "utf8");
    const parsed = parseLedgerText(text);

    expect(parsed.problems).toEqual([]);
    expect(parsed.records.map((record) => record.sequence)).toEqual([0, 1, 2]);
    expect(verifyChain(parsed.records).ok).toBe(true);
  });

  it("serializes concurrent appends so no two records claim the same link", async () => {
    const { ledger } = await openTestLedger();

    const appended = await Promise.all(
      ["a", "b", "c", "d", "e"].map((seed) =>
        ledger.append({
          type: "tool-call",
          actor: "harness",
          payloadDigest: payloadDigest(seed),
          provenance: ["model"],
        }),
      ),
    );

    expect(appended.map((record) => record.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(verifyChain(ledger.records()).ok).toBe(true);
  });

  it("aborts the run on a failed write and refuses everything after it", async () => {
    const { ledger } = await openTestLedger({
      write: () => Promise.reject(new Error("disk full")),
    });

    await expect(
      ledger.append({
        type: "tool-call",
        actor: "harness",
        payloadDigest: payloadDigest("one"),
        provenance: ["model"],
      }),
    ).rejects.toThrow(LedgerWriteFailedError);

    await expect(
      ledger.append({
        type: "tool-call",
        actor: "harness",
        payloadDigest: payloadDigest("two"),
        provenance: ["model"],
      }),
    ).rejects.toThrow(LedgerSealedError);

    expect(ledger.records()).toEqual([]);
  });
});

describe("chain verification", () => {
  async function threeRecords(): Promise<LedgerRecord[]> {
    const { ledger } = await openTestLedger();
    for (const seed of ["a", "b", "c"]) {
      await ledger.append({
        type: "tool-call",
        actor: "harness",
        payloadDigest: payloadDigest(seed),
        provenance: ["model"],
      });
    }
    return [...ledger.records()];
  }

  it("accepts an intact chain", async () => {
    const verification = verifyChain(await threeRecords());

    expect(verification.ok).toBe(true);
    expect(verification.problems).toEqual([]);
    expect(verification.recordCount).toBe(3);
  });

  it("catches a byte changed in the middle of the chain", async () => {
    const records = await threeRecords();
    const tampered = records.map((record, index) =>
      index === 1 ? { ...record, actor: "harnesx" } : record,
    );

    const verification = verifyChain(tampered);

    expect(verification.ok).toBe(false);
    expect(verification.problems[0]?.detail).toContain("does not match the recomputed hash");
  });

  it("catches a record removed from the middle", async () => {
    const records = await threeRecords();
    const verification = verifyChain([records[0] as LedgerRecord, records[2] as LedgerRecord]);

    expect(verification.ok).toBe(false);
  });

  it("moves the head when the last record changes, which is what the signature covers", async () => {
    const records = await threeRecords();
    const last = records[2] as LedgerRecord;
    const tampered = [...records.slice(0, 2), { ...last, timestamp: last.timestamp + 1 }];

    // The links still hold: nothing chains to the last record, so only the head shifts.
    expect(verifyChain(tampered).ok).toBe(true);
    expect(verifyChain(tampered).head).not.toBe(verifyChain(records).head);
  });

  it("reports an unreadable line as a problem instead of throwing", () => {
    const parsed = parseLedgerText('{"not":"a record"}\nnot json at all\n');

    expect(parsed.records).toEqual([]);
    expect(parsed.problems).toHaveLength(2);
  });
});
