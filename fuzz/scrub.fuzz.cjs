"use strict";

/**
 * The secret detector, which invariant 9 makes one detector serving three sites: the
 * write-time scrub, the export-time scan, and the secret-scan gate. "So the three cannot
 * drift apart" is the claim, and it is checkable rather than aspirational: whatever the
 * write-time scrub leaves behind is exactly what the export scan is about to read.
 *
 * This is the boundary where a bug is least recoverable. The ledger is append-only, so a
 * credential that gets past this function cannot be taken back out of it, and the blob
 * directory it lands in is what a bundle export copies to another machine.
 *
 * What is under test:
 *   - no input makes the detector throw, whatever it is
 *   - scrubbing is idempotent, so an export scan cannot refuse a bundle because write-time
 *     scrubbing worked
 *   - the export scan finds nothing in what the write-time scrub produced, which is the
 *     three-sites claim stated as a property
 *   - the gate blocks on a subset of what the scan reports, never on more
 *   - the structural path leaves no residual either, and does not mutate what it walked
 *
 * Deliberately not asserted: that a value under a credential-bearing name is always
 * redacted. It is not, below eight characters, and that gap is a finding recorded against
 * the module rather than a property this harness should drown in.
 */

const { strict: assert } = require("node:assert");

const {
  findBlockingSecrets,
  findKnownSecrets,
  scrubJson,
  scrubText,
} = require("../.swarm/fuzz-build/evidence/scrub.js");

/**
 * `scrubJson` walks an arbitrary parsed payload and rebuilds it, so a key from that payload
 * reaching a prototype is a real shape here rather than a hypothetical one. Checked
 * explicitly as well as by Jazzer's detector: the detector catches pollution of any builtin,
 * this pins the one this traversal could cause, and either one alone is a single point of
 * failure for the same claim.
 */
const pristinePrototypeKeys = Object.getOwnPropertyNames(Object.prototype).sort().join(",");

function assertPrototypeIntact(where) {
  assert.equal(
    Object.getOwnPropertyNames(Object.prototype).sort().join(","),
    pristinePrototypeKeys,
    `${where} reached Object.prototype`,
  );
}

module.exports.fuzz = function (data) {
  const text = data.toString("utf8");

  const once = scrubText(text);
  assert.equal(typeof once.value, "string", "scrubText returned a non-string");

  const twice = scrubText(once.value);
  assert.equal(
    twice.value,
    once.value,
    "scrubbing twice differs from scrubbing once, so an export scan can refuse a bundle " +
      "precisely because write-time scrubbing worked",
  );

  const residual = findKnownSecrets(once.value);
  assert.deepEqual(
    residual,
    [],
    `the export scan still reports ${JSON.stringify(residual)} in what the write-time ` +
      "scrub produced, so the two sites disagree about the same content",
  );

  const known = findKnownSecrets(text);
  for (const blocking of findBlockingSecrets(text)) {
    assert.ok(
      known.includes(blocking),
      `the gate blocks on ${blocking}, which the export scan does not report`,
    );
  }

  // Where the content is JSON, every site walks it as JSON, so the structural path carries
  // the same two properties. Anything that is not JSON is the line scanner's business and
  // was covered above.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (parsed === null || typeof parsed !== "object") {
    return;
  }

  const before = JSON.stringify(parsed);
  const walked = scrubJson(parsed);
  assert.equal(JSON.stringify(parsed), before, "scrubJson mutated the payload it walked");
  assertPrototypeIntact("scrubbing a payload");

  const structuralResidual = findKnownSecrets(JSON.stringify(walked.value));
  assert.deepEqual(
    structuralResidual,
    [],
    `the export scan still reports ${JSON.stringify(structuralResidual)} in a scrubbed payload`,
  );
};
