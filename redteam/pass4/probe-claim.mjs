/**
 * Part C: claim-to-record binding at submission.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));
const { evaluateClaim, claimPayloadSchema } = await import(join(root, "src/evidence/claim.ts"));
const { buildEvidenceDag } = await import(join(root, "src/evidence/dag.ts"));
const { indexCitedRecords } = await import(join(root, "src/evidence/record-index.ts"));
const { openEvidenceSession } = await import(join(root, "src/evidence/session.ts"));
const embedded = await import(join(root, "src/evidence/verifier/verify.mjs"));

const tmp = await mkdtemp(join(tmpdir(), "pass4-c-"));
const evidence = await openEvidenceSession({
  root: tmp,
  sessionId: "claim-bind",
  clock: createTestClock(1),
});

const payload = { gateId: "tests", status: "passed", extra: "honest" };

// 1. honest claim, then later same-digest different kind
const run = await evidence.record({
  type: "gate-run",
  actor: "harness",
  provenance: ["tool-output"],
  payload,
});
const claim = {
  predicate: 'status == "passed"',
  record: run.record.payloadDigest,
  recordKind: "gate-run:tests",
  narrative: "the tests gate passed",
};
const atSubmit = await evidence.submitClaim(claim, "harness");
await evidence.record({
  type: "tool-call",
  actor: "fixture:liar",
  provenance: ["model"],
  payload,
});
const afterIndex = indexCitedRecords(evidence.records(), evidence.payloads());
const lookup = (d) => afterIndex.get(d);
const recorded = claimPayloadSchema.parse(
  evidence
    .payloads()
    .get(evidence.records().find((r) => r.type === "claim")?.payloadDigest ?? ""),
);
const dag = buildEvidenceDag(evidence.records(), evidence.payloads());
console.log(
  JSON.stringify({
    case: "later-collision-stays-verified",
    atSubmit: atSubmit.verdict,
    reevalUnbound: evaluateClaim(claim, lookup).verdict,
    reevalRecorded: evaluateClaim(recorded, lookup).verdict,
    dag: dag.claims[0]?.evaluation.verdict,
    offline: embedded.evaluateClaim(recorded, lookup).verdict,
    boundSequence: recorded.recordSequence,
    carriers: afterIndex.get(run.record.payloadDigest)?.carriers,
  }),
);

// 2. already ambiguous at submission
const twin = { gateId: "tests", status: "passed", toolName: "shell" };
const first = await evidence.record({
  type: "tool-call",
  actor: "fixture",
  provenance: ["model"],
  payload: twin,
});
await evidence.record({
  type: "gate-run",
  actor: "harness",
  provenance: ["tool-output"],
  payload: twin,
});
const ambiguous = await evidence.submitClaim(
  {
    predicate: 'status == "passed"',
    record: first.record.payloadDigest,
    recordKind: "gate-run:tests",
    narrative: "the tests gate passed",
  },
  "fixture:liar",
);
console.log(
  JSON.stringify({
    case: "already-ambiguous",
    verdict: ambiguous.verdict,
    reason: ambiguous.reason,
    detail: ambiguous.detail,
  }),
);

// 3. can a caller-supplied recordSequence survive submitClaim?
const honest = await evidence.record({
  type: "gate-run",
  actor: "harness",
  provenance: ["tool-output"],
  payload: { gateId: "lint", status: "passed", only: "lint" },
});
const injected = await evidence.submitClaim(
  {
    predicate: 'status == "passed"',
    record: honest.record.payloadDigest,
    recordKind: "gate-run:lint",
    recordSequence: 999,
    narrative: "point at nothing",
  },
  "fixture:liar",
);
const injectedRecord = evidence
  .records()
  .filter((r) => r.type === "claim")
  .at(-1);
const injectedPayload = claimPayloadSchema.parse(
  evidence.payloads().get(injectedRecord?.payloadDigest ?? ""),
);
console.log(
  JSON.stringify({
    case: "injected-sequence-overwritten",
    verdict: injected.verdict,
    storedSequence: injectedPayload.recordSequence,
    wanted: 999,
    honestSequence: honest.record.sequence,
  }),
);

// 4. same digest, two same-kind records: bind to first; can we make it point at second?
const sameKind = { gateId: "tests", status: "passed", mark: "same-kind-twice" };
const a = await evidence.record({
  type: "gate-run",
  actor: "harness",
  provenance: ["tool-output"],
  payload: sameKind,
});
const b = await evidence.record({
  type: "gate-run",
  actor: "harness",
  provenance: ["tool-output"],
  payload: sameKind,
});
const sameKindClaim = await evidence.submitClaim(
  {
    predicate: 'status == "passed"',
    record: a.record.payloadDigest,
    recordKind: "gate-run:tests",
    narrative: "which sequence",
  },
  "harness",
);
const sameKindRecorded = claimPayloadSchema.parse(
  evidence
    .payloads()
    .get(evidence.records().filter((r) => r.type === "claim").at(-1)?.payloadDigest ?? ""),
);
console.log(
  JSON.stringify({
    case: "same-kind-two-carriers",
    verdict: sameKindClaim.verdict,
    bound: sameKindRecorded.recordSequence,
    first: a.record.sequence,
    second: b.record.sequence,
  }),
);

// 5. parity of indexCitedRecords with a v13-looking extra field on the record
const twinDigest = first.record.payloadDigest;
const records = [
  { sequence: 0, type: "tool-call", payloadDigest: twinDigest, v13: { extra: true } },
  { sequence: 1, type: "gate-run", payloadDigest: twinDigest },
];
const payloads = new Map([[twinDigest, twin]]);
const mine = indexCitedRecords(records, payloads);
const theirs = embedded.indexCitedRecords(records, payloads);
console.log(
  JSON.stringify({
    case: "index-parity-v13-field-ignored",
    mine: mine.get(twinDigest)?.carriers,
    theirs: theirs.get(twinDigest)?.carriers,
    keysEqual: JSON.stringify([...mine.keys()]) === JSON.stringify([...theirs.keys()]),
  }),
);

// 6. evaluateClaim vs embedded with recordSequence undefined after collision
console.log(
  JSON.stringify({
    case: "undefined-sequence-after-collision",
    impl: evaluateClaim(claim, lookup),
    embedded: embedded.evaluateClaim(claim, lookup),
  }),
);

await rm(tmp, { recursive: true, force: true });
