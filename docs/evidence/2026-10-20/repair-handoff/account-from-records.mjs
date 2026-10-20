#!/usr/bin/env node
/**
 * The account of the first repair attempt of run 20261020T045117-41e2cc, built by the production
 * account builder from the attempt's recorded conversation, with no model and no live run.
 *
 * The attempt's conversation is reconstructed from the run chain: the transcript components from
 * the brief (R 221) to the last recorded tool message (R 483), each blob checked against its
 * record's digest, then the step-40 assistant turn from its model-call record (R 485) and the
 * step-40 tool outcome from its tool-call record (R 488), neither of which was recorded as a
 * component because no model call followed them inside the attempt. The builder is given exactly
 * what the product's repair path gives it: the messages, the stop reason and the step count. The
 * text it returns is written out; with `--module` pointing at another revision of
 * src/core/loop-account.ts, the same conversation is described by that revision, so the account
 * the treatment adds can be set beside the one the control carries.
 *
 * The reconstruction is checked: the control revision's text must equal, byte for byte, the
 * account the second attempt was actually handed (the brief at R 513), or this exits 2.
 *
 *   node account-from-records.mjs <restored sessions dir> --out <file> [--module <loop-account.ts>] [--check-against-brief]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    module: { type: "string", default: "../../../../src/core/loop-account.ts" },
    "check-against-brief": { type: "boolean", default: false },
  },
});
const [sessions] = positionals;
if (sessions === undefined || values.out === undefined)
  throw new Error("usage: account-from-records.mjs <restored sessions dir> --out <file> [--module <path>]");

const runId = "20261020T045117-41e2cc";
const runDir = join(sessions, runId);
const records = readFileSync(join(runDir, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const payload = (record) => {
  const bytes = readFileSync(join(runDir, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== record.payloadDigest)
    throw new Error(`blob of R ${record.sequence} differs from its record's digest`);
  return JSON.parse(bytes.toString());
};

// The attempt's recorded conversation: R 221 (the brief) to R 483 (the step-39 tool message).
const briefSequence = 221;
const lastComponent = 483;
const stepFortyCall = 485;
const stepFortyOutcome = 488;
const messages = [];
for (const record of records) {
  if (record.type !== "transcript-component") continue;
  if (record.sequence < briefSequence || record.sequence > lastComponent) continue;
  const component = payload(record);
  if (component.kind !== "message") throw new Error(`R ${record.sequence} is not a message`);
  messages.push(component.value);
}
if (messages[0]?.role !== "user" || !messages[0].text.includes("This is attempt 1 of 3"))
  throw new Error("the first component is not the first attempt's brief");
const call = payload(records[stepFortyCall]);
if (records[stepFortyCall].type !== "model-call" || call.response.finishReason !== "tool-calls")
  throw new Error(`R ${stepFortyCall} is not the step-40 model call`);
messages.push({
  role: "assistant",
  text: call.response.text ?? "",
  toolCalls: call.response.toolCalls.map((one) => ({
    callId: one.callId,
    toolName: one.toolName,
    input: one.input,
  })),
});
const outcomeRecord = records[stepFortyOutcome];
const outcome = payload(outcomeRecord);
if (outcomeRecord.type !== "tool-call" || outcome.decision !== "allowed")
  throw new Error(`R ${stepFortyOutcome} is not the step-40 tool outcome`);
if (outcome.callId !== call.response.toolCalls[0]?.callId)
  throw new Error("the step-40 outcome does not answer the step-40 call");
// The chokepoint ends every result with the record it produced: its payload digest and kind.
messages.push({
  role: "tool",
  outcomes: [
    {
      callId: outcome.callId,
      toolName: outcome.toolName,
      failed: false,
      output: `${outcome.output}\n[evidence record ${outcomeRecord.payloadDigest} kind tool-call:${outcome.toolName}]`,
    },
  ],
});
const stopped = payload(records[489]);
if (stopped.stopReason !== "max-steps" || stopped.steps !== 40)
  throw new Error("R 489 is not the attempt's stop");

const modulePath = resolve(import.meta.dirname, values.module);
const { describePriorLoop, priorLoopAccount } = await import(pathToFileURL(modulePath).href);
const account = priorLoopAccount(messages, stopped.stopReason, stopped.steps);
const text = describePriorLoop(account);
writeFileSync(values.out, `${text}\n`);

const summary = {
  module: modulePath,
  messages: messages.length,
  toolMessages: messages.filter((one) => one.role === "tool").length,
  recentShell: (account.recentShell ?? []).map((one) => ({
    call: one.call.slice(0, 80),
    record: one.record,
    beforeLaterEdits: one.beforeLaterEdits,
    firstLine: one.output.split("\n")[1] ?? "",
  })),
};
if (values["check-against-brief"]) {
  const brief = payload(records[513]).value.text;
  const start = brief.indexOf("Account of the previous loop");
  const end = brief.indexOf("\n\nWhat the gates report", start);
  const carried = brief.slice(start, end);
  summary.matchesBriefAtR513 = carried === text;
  if (!summary.matchesBriefAtR513) {
    console.error("the rebuilt account differs from the one the brief at R 513 carried");
    console.error(JSON.stringify({ carried, text }, null, 1));
    process.exit(2);
  }
}
console.log(JSON.stringify(summary, null, 1));
