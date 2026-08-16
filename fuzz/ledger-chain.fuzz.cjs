"use strict";

/**
 * The ledger-write path. What a model contributes reaches the chain as an actor, a payload
 * digest and provenance tags, and the chain has to hold whatever those turn out to be.
 * What is under test is invariant 2, that the ledger is append-only and self-verifying:
 *
 *   - reading a ledger back is a report of problems, never a throw
 *   - an entry the schema refuses leaves the chain exactly where it was
 *   - an accepted entry links to the record before it
 *   - what lands on disk parses back to what was appended, and verifies
 *
 * The write is injected, so nothing here appends to a real ledger.
 */

const { strict: assert } = require("node:assert");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { asJsonValue, digestOfJson } = require(
  "../.swarm/fuzz-build/evidence/canonical-json.js",
);
const { openLedger, parseLedgerText, verifyChain } = require(
  "../.swarm/fuzz-build/evidence/ledger.js",
);
const { genesisHash, hashOfRecord, ledgerRecordSchema } = require(
  "../.swarm/fuzz-build/evidence/ledger-record.js",
);

/** dirname of this is the only path openLedger touches; the write itself is injected. */
const LEDGER_PATH = join(mkdtempSync(join(tmpdir(), "swarm-fuzz-ledger-")), "ledger.jsonl");

/** Bounded so one input cannot grow a chain without end. */
const MAX_APPENDS = 8;

const clock = { now: () => 1_700_000_000_000, sleep: async () => undefined };

/** One model turn, read as the entries it is asking the harness to record. */
function appendsFrom(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const proposals = Array.isArray(parsed) ? parsed.slice(0, MAX_APPENDS) : [parsed];
  return proposals.map((proposal) => appendFrom(proposal));
}

function appendFrom(proposal) {
  if (proposal === null || typeof proposal !== "object") {
    // A turn with no structure still has to reach the ledger as a recordable payload.
    return {
      type: "tool-call",
      actor: "harness",
      payloadDigest: digestOfJson(asJsonValue(proposal)),
      provenance: ["model"],
    };
  }
  return {
    type: proposal.type ?? "tool-call",
    actor: proposal.actor ?? "harness",
    payloadDigest:
      typeof proposal.payloadDigest === "string"
        ? proposal.payloadDigest
        : digestOfJson(asJsonValue(proposal)),
    provenance: Array.isArray(proposal.provenance) ? proposal.provenance : ["model"],
    ...(proposal.promptDigest === undefined ? {} : { promptDigest: proposal.promptDigest }),
    ...(proposal.responseDigest === undefined ? {} : { responseDigest: proposal.responseDigest }),
  };
}

module.exports.fuzz = async function (data) {
  const text = data.toString("utf8");

  // Read side: whatever is in the file, reading it is a report and never an exception.
  const read = parseLedgerText(text);
  for (const record of read.records) {
    assert.ok(
      ledgerRecordSchema.safeParse(record).success,
      "parseLedgerText returned a record its own schema rejects",
    );
    assert.equal(typeof hashOfRecord(record), "string");
  }
  verifyChain(read.records);

  // Write side, with the model in the fields it actually controls.
  const lines = [];
  const ledger = await openLedger({
    path: LEDGER_PATH,
    clock,
    write: async (_path, line) => {
      lines.push(line);
    },
  });

  for (const entry of appendsFrom(text)) {
    const before = ledger.head();
    let record;
    try {
      record = await ledger.append(entry);
    } catch (error) {
      // Our write never fails, so a seal or a write failure would be the ledger inventing
      // one. Anything else here is the schema refusing an entry, which is it working.
      if (error instanceof Error && error.name.startsWith("Ledger")) {
        throw error;
      }
      const after = ledger.head();
      assert.equal(after.hash, before.hash, "a refused entry moved the chain head");
      assert.equal(after.recordCount, before.recordCount, "a refused entry was recorded anyway");
      continue;
    }

    assert.equal(record.sequence, before.recordCount, "an accepted entry skipped a sequence");
    assert.equal(
      record.previousHash,
      before.recordCount === 0 ? genesisHash : before.hash,
      "an accepted entry does not link to the record before it",
    );
  }

  // What landed is what was appended, and it verifies.
  const readBack = parseLedgerText(lines.join("\n"));
  assert.deepEqual(readBack.problems, [], "the ledger wrote lines it cannot read back");
  assert.deepEqual(readBack.records, ledger.records(), "disk and memory disagree on the chain");

  const verdict = verifyChain(readBack.records);
  assert.ok(verdict.ok, `the chain does not verify: ${JSON.stringify(verdict.problems)}`);
  assert.equal(verdict.head, ledger.head().hash, "the verified head is not the ledger's head");
};
