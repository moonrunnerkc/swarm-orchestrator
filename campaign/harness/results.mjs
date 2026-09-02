/**
 * What a run left behind, read from its bundle and from the tree it left, never from what
 * the run printed. The executed flag is the calibration report's rule applied here: a run
 * executed where the model answered at least once, a turn carrying text or a tool call, and
 * a run that never got an answer is recorded as not executed rather than as a failure of the
 * model. Nothing here reads the run's exit code as a result.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readBundle(bundleDirectory) {
  const ledgerPath = join(bundleDirectory, "ledger.jsonl");
  const manifestPath = join(bundleDirectory, "manifest.json");
  if (!existsSync(ledgerPath) || !existsSync(manifestPath)) {
    return null;
  }
  const records = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const payload = (record) => {
    const path = join(bundleDirectory, "blobs", `${record.payloadDigest.replace("sha256:", "")}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  };
  return { records, manifest, payload };
}

function answered(response) {
  return (response?.text ?? "").trim().length > 0 || (response?.toolCalls ?? []).length > 0;
}

export function runFacts(bundle) {
  const modelCalls = bundle.records.filter((record) => record.type === "model-call");
  const answeredTurns = modelCalls.filter((record) => answered(bundle.payload(record)?.response)).length;

  const stops = bundle.records
    .filter((record) => record.type === "session-stopped")
    .map((record) => bundle.payload(record)?.stopReason ?? null);

  const gates = {};
  for (const record of bundle.records.filter((entry) => entry.type === "gate-run")) {
    const run = bundle.payload(record);
    if (run !== null) {
      gates[run.gateId] = { status: run.status, severity: run.severity, attempt: run.attempt, detail: run.detail };
    }
  }

  const ratchet = bundle.records
    .filter((record) => record.type === "ratchet-decision")
    .map((record) => bundle.payload(record))
    .filter((decision) => decision !== null);

  const escalations = bundle.records
    .filter((record) => record.type === "escalation")
    .map((record) => bundle.payload(record))
    .filter((escalation) => escalation !== null)
    .map((escalation) => ({ gateId: escalation.gateId, attemptsUsed: escalation.attemptsUsed, cap: escalation.cap }));

  const blockingFailed = Object.entries(gates)
    .filter(([, gate]) => gate.severity === "blocking" && gate.status === "failed")
    .map(([id]) => id);

  return {
    records: bundle.records.length,
    modelCalls: modelCalls.length,
    answeredTurns,
    executed: answeredTurns > 0,
    stopReasons: stops,
    gates,
    blockingFailed,
    ratchetDecisions: ratchet.map((decision) => ({ attempt: decision.attempt, accepted: decision.accepted, abstained: (decision.abstentions ?? []).map((entry) => entry.measure) })),
    ratchetRejections: ratchet.filter((decision) => decision.accepted === false).length,
    escalations,
    settledGreen: escalations.length === 0 && blockingFailed.length === 0 && Object.keys(gates).length > 0,
    claims: bundle.manifest.claims,
    signedWith: bundle.manifest.signature?.keySource ?? null,
  };
}

/** Under an environment this harness built, so nothing in the caller's shell decides what node loads. */
export function verifyBundle(bundleDirectory) {
  const kept = {};
  for (const name of ["PATH", "HOME", "TMPDIR"]) {
    if (process.env[name] !== undefined) {
      kept[name] = process.env[name];
    }
  }
  const spawned = spawnSync(process.execPath, [join(bundleDirectory, "verify.mjs"), bundleDirectory], {
    encoding: "utf8",
    env: kept,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { exitCode: spawned.status ?? 1, output: `${spawned.stdout}${spawned.stderr}` };
}

/**
 * What became of the seeded defect, from facts the harness measured after the run: whether
 * the suite passes on the tree the run left, whether the files holding the failing tests are
 * byte-identical to the seeded commit, and whether the seeded line reads as it did before
 * the seed. A green suite with the test files edited is named as such rather than counted
 * as a fix, because a suite that passes after its tests were changed proved nothing about
 * the defect.
 */
export function judgeFix({ suiteOutcome, testFilesChanged, seedLineRestored }) {
  if (suiteOutcome !== "passed") {
    return "not-fixed";
  }
  if (testFilesChanged.length > 0) {
    return "green-with-test-edits";
  }
  return seedLineRestored ? "fixed-by-restoring-the-line" : "fixed-another-way";
}
