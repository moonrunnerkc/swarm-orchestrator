// Every model call of a launch's chain, counted from its records: the usage each reported, and
// each call whose usage is unknown with what its record carries about it (cancelled, the request
// bound the product would charge a continuation, how long it was in flight, the size of the last
// prompt the server measured before it). No model.
//
//   node usage-account.mjs <session dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (directory === undefined) throw new Error("usage: usage-account.mjs <session dir>");
const records = readFileSync(join(directory, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const payload = (digest) =>
  JSON.parse(readFileSync(join(directory, "blobs", `${digest.slice(7)}.json`), "utf8"));
let inputTokens = 0;
let outputTokens = 0;
let calls = 0;
let lastReported = null;
const unknown = [];
for (const record of records) {
  if (record.type !== "model-call") continue;
  const call = payload(record.payloadDigest);
  calls += 1;
  inputTokens += call.inputTokens ?? 0;
  outputTokens += call.outputTokens ?? 0;
  if (call.usageStatus !== "unknown") {
    lastReported = { sequence: record.sequence, step: call.step, inputTokens: call.inputTokens };
    continue;
  }
  const started = records.find(
    (one) => one.type === "model-call-started" && one.payloadDigest === call.startedRecord,
  );
  unknown.push({
    sequence: record.sequence,
    step: call.step,
    cancelled: call.cancelled,
    response: call.response,
    requestBound: call.requestBound ?? null,
    startedAt: started === undefined ? null : new Date(started.timestamp).toISOString(),
    endedAt: new Date(record.timestamp).toISOString(),
    inFlightMs: started === undefined ? null : record.timestamp - started.timestamp,
    lastPromptMeasuredBefore: lastReported,
  });
}
const reported = inputTokens + outputTokens;
const bound = unknown.reduce((sum, one) => sum + (one.requestBound?.reservedTokens ?? Number.NaN), 0);
process.stdout.write(
  `${JSON.stringify(
    {
      calls,
      reportedCalls: calls - unknown.length,
      inputTokens,
      outputTokens,
      reportedTokens: reported,
      unknown,
      reading:
        unknown.length === 0
          ? "every call reported its usage; the total is the reported total"
          : `the reported total is a lower bound; with each unknown call charged at its recorded request bound it is at most ${reported + bound}`,
    },
    null,
    2,
  )}\n`,
);
