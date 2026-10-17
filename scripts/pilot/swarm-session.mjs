/**
 * What a Swarm run put on its own chain, read back from its session directory for the
 * verification replays: the envelope, the sealed gates, the sealed contract, the last
 * independent verification, and how long the final verification of the exact tree took.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Records of the final verification block: the fresh install, the goal checks and their verdicts. */
const verificationBlock = new Set([
  "dependency-install",
  "goal-check",
  "goal-verification",
  "verification-command",
]);

export function readSession(directory) {
  const records = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const bytesOf = (digest) => readFileSync(join(directory, "blobs", `${digest.slice(7)}.json`));
  const payload = (digest) => JSON.parse(bytesOf(digest).toString("utf8"));
  const find = (type) => records.filter((one) => one.type === type);
  const envelope = find("execution-envelope")[0];
  const sealed = find("gate-set-sealed")[0];
  const goal = find("goal-contract")[0];
  const verification = find("independent-verification").at(-1);
  const sealedPayload = sealed === undefined ? null : payload(sealed.payloadDigest);
  const verificationPayload =
    verification === undefined ? null : payload(verification.payloadDigest);
  const retained = [envelope, sealed, goal, verification].filter(Boolean);
  return {
    envelope: envelope === undefined ? null : payload(envelope.payloadDigest),
    sealedGates:
      sealedPayload === null
        ? []
        : sealedPayload.gates.map((gate) => ({
            id: gate.id,
            command: gate.command ?? null,
            severity: gate.severity ?? null,
          })),
    sealedTestsGate:
      sealedPayload === null
        ? null
        : (sealedPayload.gates.find((gate) => gate.id === "tests")?.command ?? null),
    contractDigest: goal === undefined ? null : payload(goal.payloadDigest).digest,
    lastVerification:
      verificationPayload === null
        ? null
        : {
            record: verification.payloadDigest,
            verified: verificationPayload.verified,
            regression: verificationPayload.regression,
            task: verificationPayload.task,
            unmeasured: verificationPayload.unmeasured,
            refusal: verificationPayload.refusal,
            advice: verificationPayload.advice,
            checks: (verificationPayload.checks ?? []).map((check) => ({
              id: check.id,
              status: check.status,
              detail: check.detail,
            })),
            goalChecks: (verificationPayload.goalAcceptance?.checkResults ?? []).map((check) => ({
              id: check.id,
              status: check.status,
              detail: check.detail,
            })),
          },
    timing: timing(records, verification),
    retainedPayloads: retained.map((one) => ({
      digest: one.payloadDigest,
      bytes: bytesOf(one.payloadDigest),
    })),
  };
}

/**
 * The run's span, the time after its last model call, and the final verification block's
 * duration: from the record before the last verification's install and checks to its verdict.
 */
function timing(records, verification) {
  const first = records[0]?.timestamp ?? null;
  const last = records.at(-1)?.timestamp ?? null;
  const modelCalls = records.filter((one) => one.type === "model-call");
  let finalVerificationMs = null;
  if (verification !== undefined) {
    let index = records.indexOf(verification) - 1;
    while (index > 0 && verificationBlock.has(records[index].type)) index -= 1;
    finalVerificationMs = verification.timestamp - records[index].timestamp;
  }
  return {
    runMs: first === null ? null : last - first,
    afterLastModelCallMs: modelCalls.length === 0 ? null : last - modelCalls.at(-1).timestamp,
    finalVerificationMs,
  };
}
