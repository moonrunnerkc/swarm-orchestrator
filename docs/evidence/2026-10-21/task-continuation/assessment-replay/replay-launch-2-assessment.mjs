// Launch 2's final assessment, recomputed from its own records through the product's assessment
// functions and re-derived by the standalone verifier. No model, no tree, no clock but the
// records' own timestamps.
//
// The session's chain is copied up to the record before the worker assessment (748), opened as a
// session, and the worker assessment is recorded again by `recordRunAssessment` from what the
// chain holds: the settled cycle's gate runs, the base ratchet decision, the bonds, the effective
// task contract, the lifecycle read by the product's own rule, and the recorded `cancelled`
// (false). The final goal checks and the independent verification (records 750 to 755) are
// appended again with their payloads unchanged, and the goal assessment is recorded by
// `recordGoalAssessment` over the independent verification. The replayed chain is then written as
// a bundle (signed by an ephemeral key) and the standalone verifier re-derives both assessments.
//
// `--product` names the checkout whose `src/` is imported, so the same script reads the code
// before and after a change:
//
//   node replay-launch-2-assessment.mjs --session <launch-2 session dir> --out <json> [--product <repo root>]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { session: { type: "string" }, out: { type: "string" }, product: { type: "string" } },
});
if (values.session === undefined || values.out === undefined)
  throw new Error("usage: replay-launch-2-assessment.mjs --session <dir> --out <json> [--product <repo root>]");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const product = resolve(values.product ?? new URL("../../../../../", import.meta.url).pathname);
const load = (path) => import(pathToFileURL(join(product, path)).href);
const { recordGoalAssessment, recordRunAssessment, runLifecycle } = await load(
  "src/evidence/run-assessment.ts",
);
const { openEvidenceSession } = await load("src/evidence/session.ts");
const { canonicalJson, verifyBundle } = await load("src/evidence/verifier/verify.mjs");
const { bundleSourceFromRecorder, exportBundle } = await load("src/evidence/bundle.ts");
const { createEphemeralSigningKey } = await load("src/evidence/signing.ts");

const session = resolve(values.session);
const original = readFileSync(join(session, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const blobOf = (digest) =>
  JSON.parse(readFileSync(join(session, "blobs", `${digest.replace("sha256:", "")}.json`), "utf8"));
const bySequence = (sequence) => {
  const entry = original.find((one) => one.sequence === sequence);
  if (entry === undefined) throw new Error(`record ${sequence} is not in the session`);
  return entry;
};
const workerRecord = bySequence(749);
const goalRecord = bySequence(756);
if (workerRecord.type !== "run-assessment" || goalRecord.type !== "run-assessment")
  throw new Error("records 749 and 756 are not the launch's two run assessments");

// The chain up to 748, as a session the product opens and appends to.
const root = mkdtempSync(join(tmpdir(), "launch-2-assessment-"));
const sessionId = "replay-launch-2-assessment";
const directory = join(root, sessionId);
mkdirSync(directory, { recursive: true });
cpSync(join(session, "blobs"), join(directory, "blobs"), { recursive: true });
writeFileSync(
  join(directory, "ledger.jsonl"),
  `${original
    .filter((one) => one.sequence < workerRecord.sequence)
    .map((one) => JSON.stringify(one))
    .join("\n")}\n`,
);
let now = workerRecord.timestamp;
const clock = {
  now: () => now,
  sleep: () => Promise.resolve(),
};
const evidence = await openEvidenceSession({ root, sessionId, clock });
const payloads = evidence.payloads();
const records = evidence.records();

// What the gates engine handed the assessment, read off the chain as the verifier reads it: the
// settled cycle is the last retry the ratchet accepted.
const settledAttempt = Math.max(
  0,
  ...records
    .filter((one) => one.type === "ratchet-decision")
    .map((one) => payloads.get(one.payloadDigest))
    .filter((one) => one?.scope === "retry" && one.accepted === true && typeof one.attempt === "number")
    .map((one) => one.attempt),
);
const latest = new Map();
for (const entry of records.filter((one) => one.type === "gate-run")) {
  const run = payloads.get(entry.payloadDigest);
  if (run.attempt === settledAttempt) latest.set(run.gateId, { ...run, record: entry.payloadDigest });
}
const runs = [...latest.values()];
const baseDecision = records.findLast(
  (one) => one.type === "ratchet-decision" && payloads.get(one.payloadDigest)?.scope === "base",
);
const contract = records
  .map((one) => (one.type === "task-contract" ? payloads.get(one.payloadDigest) : undefined))
  .find((one) => one?.phase === "effective");
const gates = {
  outcome: {
    settled: records.some((one) => one.type === "escalation") ? "escalated" : "green",
    baseComparison: {
      decision: { accepted: payloads.get(baseDecision.payloadDigest).accepted },
      ratchetRecord: baseDecision.payloadDigest,
    },
    finalCycle: {
      runs,
      measures: Object.assign({}, ...runs.map((run) => run.measures ?? {})),
      blockingFailures: runs.filter((run) => run.severity === "blocking" && run.status === "failed"),
      advisoryFailures: runs.filter((run) => run.severity === "advisory" && run.status === "failed"),
    },
  },
  bonds: records
    .filter((one) => one.type === "gate-bond")
    .map((one) => payloads.get(one.payloadDigest))
    .map((bond) => ({ gateId: bond.gateId, severity: bond.severity, verdict: bond.verdict })),
};
const recordedWorker = blobOf(workerRecord.payloadDigest);
const lifecycle = runLifecycle(evidence);
const worker = await recordRunAssessment(
  evidence,
  gates,
  lifecycle,
  recordedWorker.verdict.executionTrust,
  recordedWorker.inputs.cancelled,
  contract,
);
const workerPayload = evidence.payloads().get(evidence.records().at(-1).payloadDigest);

// The final goal checks and the independent verification, as recorded, at their own times.
for (let sequence = workerRecord.sequence + 1; sequence < goalRecord.sequence; sequence += 1) {
  const entry = bySequence(sequence);
  now = entry.timestamp;
  const appended = await evidence.record({
    type: entry.type,
    actor: entry.actor,
    provenance: entry.provenance,
    payload: blobOf(entry.payloadDigest),
  });
  if (appended.record.payloadDigest !== entry.payloadDigest)
    throw new Error(`record ${sequence} did not keep its payload digest when appended again`);
}
now = goalRecord.timestamp;
const verification = bySequence(755);
const goal = await recordGoalAssessment(evidence, verification.payloadDigest);
const goalPayload = evidence.payloads().get(evidence.records().at(-1).payloadDigest);

// The standalone verifier over the replayed chain, and over the launch's own chain, each exported
// as a bundle signed by an ephemeral key: only the assessment re-derivations are read from its
// report.
const asBundle = async (recorder, name) => {
  const target = join(root, name);
  await exportBundle({
    source: bundleSourceFromRecorder(recorder),
    destination: target,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const lines = [];
  verifyBundle(target, (line) => lines.push(line));
  return lines.filter((line) => /run assessment \d+ re-derived/.test(line));
};
const launchRoot = mkdtempSync(join(tmpdir(), "launch-2-recorded-"));
cpSync(session, join(launchRoot, "launch-2"), { recursive: true });
const launch = await openEvidenceSession({ root: launchRoot, sessionId: "launch-2", clock });

const result = {
  product,
  sourceRecords: {
    deadline: blobOf(bySequence(10).payloadDigest),
    lifecycleStop: { sequence: 715, timestamp: new Date(bySequence(715).timestamp).toISOString() },
    independentVerification: {
      sequence: 755,
      timestamp: new Date(verification.timestamp).toISOString(),
    },
  },
  lifecycle,
  recorded: {
    worker: recordedWorker,
    goal: blobOf(goalRecord.payloadDigest),
  },
  replayed: {
    worker: workerPayload,
    goal: goalPayload,
    acceptable: { worker: worker.acceptable, goal: goal.acceptable },
  },
  sameAsRecorded: {
    worker: canonicalJson(workerPayload) === canonicalJson(recordedWorker),
    goalVerdict: canonicalJson(goalPayload.verdict) === canonicalJson(blobOf(goalRecord.payloadDigest).verdict),
  },
  verifier: {
    launchChain: await asBundle(launch, "launch-2-recorded"),
    replayedChain: await asBundle(evidence, "launch-2-replayed"),
  },
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `worker acceptable ${worker.acceptable} (${worker.reasons.assessment}); goal acceptable ${goal.acceptable}; ` +
    `same as recorded: worker ${result.sameAsRecorded.worker}, goal verdict ${result.sameAsRecorded.goalVerdict}\n` +
    `${[...result.verifier.launchChain, ...result.verifier.replayedChain].join("\n")}\n`,
);
