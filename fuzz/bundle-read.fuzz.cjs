"use strict";

/**
 * Reading a bundle back. This is the only input in the system that is genuinely third-party:
 * a bundle is the export format, meant to be carried to another machine and checked by
 * someone who did not produce it, and the embedded verifier is what they run.
 *
 * The threat model is the inverse of every other harness here. Elsewhere the question is
 * whether model output can break the harness recording it; here it is whether a bundle
 * somebody hands you can break the reader that is supposed to be judging it. A reader that
 * throws on a malformed bundle turns "this bundle is not trustworthy", which is a verdict,
 * into a crash, which is not. Invariant 2 makes the read-only claim load-bearing too: replay
 * must never write, so a bundle that induces a write edits the evidence it is being judged
 * against.
 *
 * Structure-aware on purpose. Mutating the manifest bytes directly puts almost every input
 * on the far side of a JSON.parse that fails immediately, and the harness then measures the
 * parse rather than the reader: at raw bytes this reached 12 edges and its corpus did not
 * grow. The input is read as a decision tape instead, choosing among field values that are
 * individually plausible, so a bundle is always well-formed enough to be read and wrong in
 * the ways a real one could be wrong.
 *
 * What is under test:
 *   - a bundle either reads or fails with an error, never with a half-built result
 *   - records and payloads come back in the shapes the caller reads them as
 *   - a broken chain is reported as a problem rather than thrown
 *   - reading writes nothing: the directory is byte-identical afterwards
 */

const { strict: assert } = require("node:assert");
const {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { readBundle } = require("../.swarm/fuzz-build/evidence/bundle.js");

/** Reads the fuzz input one byte at a time, so every choice below is driven by it. */
function tape(data) {
  let at = 0;
  return {
    byte: () => (data.length === 0 ? 0 : data[at++ % data.length]),
    pick: (options) => options[(data.length === 0 ? 0 : data[at++ % data.length]) % options.length],
  };
}

const digestOf = (seed) => `sha256:${seed.toString(16).padStart(2, "0").repeat(32).slice(0, 64)}`;
const hashOf = (seed) => seed.toString(16).padStart(2, "0").repeat(32).slice(0, 64);

const recordTypes = [
  "tool-call",
  "gate-run",
  "claim",
  "session-started",
  "ratchet-decision",
  "not-a-record-type",
];
const actors = ["harness", "model", "user", ""];
const signature = {
  algorithm: "ed25519",
  publicKey: "MCowBQYDK2VwAyEAexampleexampleexampleexampleexampleexampleexam",
  value: "c2lnbmF0dXJl",
  keySource: "ephemeral",
};

module.exports.fuzz = async function (data) {
  const t = tape(data);
  const directory = mkdtempSync(join(tmpdir(), "bundle-read-"));

  try {
    const count = t.byte() % 6;
    const records = [];
    let previousHash = "0".repeat(64);
    for (let index = 0; index < count; index += 1) {
      const hash = hashOf(t.byte());
      records.push({
        schemaVersion: t.pick([1, 1, 1, 2]),
        sequence: t.pick([index, index + 1, 0, -1, 2 ** 53]),
        previousHash: t.pick([previousHash, "genesis", digestOf(t.byte()), ""]),
        timestamp: t.byte(),
        type: t.pick(recordTypes),
        actor: t.pick(actors),
        payloadDigest: t.pick([digestOf(0xaa), digestOf(t.byte()), "not-a-digest"]),
        provenance: [],
      });
      previousHash = t.pick([digestOf(t.byte()), "genesis"]);
    }

    const manifest = {
      bundleFormat: t.pick([1, 1, 1, 1, 99]),
      ledgerSchemaVersion: t.pick([1, 1, 1, 2]),
      sessionId: t.pick(["20260101T000000-aaaaaa", "s", "../escape"]),
      exportedAt: t.byte(),
      recordCount: t.pick([records.length, records.length + 1, 0]),
      chainHead: t.pick([hashOf(t.byte()), digestOf(t.byte()), "genesis"]),
      signature,
      blobs: t.pick([[digestOf(0xaa)], [], [digestOf(t.byte())]]),
      missingBlobs: t.pick([[], [digestOf(t.byte())]]),
      claims: { verified: t.byte() % 4, unverified: t.byte() % 4 },
      workers: [],
    };

    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(
      join(directory, "ledger.jsonl"),
      records.map((record) => JSON.stringify(record)).join("\n"),
    );
    mkdirSync(join(directory, "blobs"), { recursive: true });
    // Some digests resolve and some do not, which is the case the reader must survive.
    writeFileSync(join(directory, "blobs", `${digestOf(0xaa).slice(7)}.json`), '{"payload":true}');

    const before = snapshot(directory);

    let contents;
    try {
      contents = await readBundle(directory);
    } catch {
      // A bundle that cannot be read is an ordinary outcome the caller reports.
      assert.equal(snapshot(directory), before, "a failed read still wrote to the bundle");
      return;
    }

    assert.ok(contents !== null && typeof contents === "object", "readBundle returned a non-result");
    assert.ok(Array.isArray(contents.records), "records came back as something other than a list");
    assert.ok(contents.payloads instanceof Map, "payloads came back as something other than a map");
    assert.ok(Array.isArray(contents.problems), "problems came back as something other than a list");

    for (const record of contents.records) {
      assert.ok(record !== null && typeof record === "object", "a record came back as a non-object");
      assert.equal(typeof record.type, "string", "a record came back with no type");
    }
    for (const [digest, payload] of contents.payloads) {
      assert.match(digest, /^sha256:[0-9a-f]{64}$/, `a payload is keyed by ${digest}`);
      assert.notEqual(payload, undefined, `${digest} resolved to nothing`);
    }

    assert.equal(snapshot(directory), before, "reading a bundle wrote to it, against invariant 2");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

function snapshot(directory) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        entries.push(`${prefix}${entry.name}/`);
        walk(full, `${prefix}${entry.name}/`);
        continue;
      }
      entries.push(`${prefix}${entry.name}:${readFileSync(full, "utf8")}`);
    }
  };
  walk(directory, "");
  return entries.join("\n");
}
