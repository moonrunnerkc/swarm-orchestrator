/**
 * Replays every recorded decision of the adaptive stage's kept sessions through the revised rule
 * (adaptive-decision-v2), with no model. For each decision a session recorded under
 * adaptive-decision-v1, the loop's conversation at that decision is rebuilt from the ledger and
 * the revised working state, signals and choice are computed beside what v1 chose. Transcript
 * messages are content-addressed and linked (`previous`), and every model call names its last
 * one (`tail`), so the conversation is the chain behind the worker's first model call after the
 * decision, cut after the decision's own step and its tool results. That leaves out the
 * diagnosis's own messages, which are recorded before the decision record, and the notice the
 * decision added. Where that request was compacted (fastify's was, after reading 850 kB), the chain
 * behind it is short; the whole conversation is then every recorded message linked, directly or
 * through others, to that chain, in the order recorded, which is what the decision point saw.
 *
 * What this is: the revised decision function applied to the observations those loops had. What
 * it is not: a rerun. No later step depends on it, no diagnosis is answered, and the sessions
 * predate the workspace-effect measurement, so every shell command in them is an unmeasured one.
 *
 *   node docs/evidence/2026-10-23-controller/replay-decisions.mjs <sessions-root> [out.json]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  chooseDecision,
  decisionSignals,
  deriveWorkingState,
} from "../../../src/core/working-state.ts";
import { classifyShellCommand } from "../../../src/tools/shell-observation.ts";

const root = process.argv[2];
const out = process.argv[3];
const ledgers = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "blobs" && entry.name !== "bundle") walk(path);
    else if (entry.name === "ledger.jsonl") ledgers.push(path);
  }
};
walk(root);

const brief = (one) => ({ subject: one.subject, exitCode: one.exitCode, step: one.step });
const rows = [];
for (const ledger of ledgers.sort()) {
  const blobs = join(dirname(ledger), "blobs");
  const records = readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  const payload = (record) => {
    const bytes = readFileSync(join(blobs, `${record.payloadDigest.slice(7)}.json`));
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest)
      throw new Error(`payload of record ${record.sequence} differs from its digest`);
    return JSON.parse(bytes);
  };
  const components = new Map();
  for (const record of records)
    if (record.type === "transcript-component")
      components.set(record.payloadDigest, payload(record));
  const valueOf = (component) =>
    typeof component.value === "string" ? JSON.parse(component.value) : component.value;
  const conversationAt = (tail) => {
    const chain = [];
    for (let at = tail; at !== null && at !== undefined; ) {
      const component = components.get(at);
      if (component === undefined) break;
      chain.unshift(at);
      at = component.previous;
    }
    // Every message linked to the chain, in recorded order: a compacted request's chain skips
    // what compaction dropped, and the decision point saw the conversation whole.
    const linked = new Set(chain);
    const ordered = [];
    for (const [digest, component] of components) {
      if (component.kind !== "message") continue;
      if (linked.has(digest) || (component.previous !== null && linked.has(component.previous))) {
        linked.add(digest);
        ordered.push(valueOf(component));
      }
    }
    return ordered;
  };
  const session = relative(root, dirname(ledger));
  const settle = (value, messages) => {
    // Up to the decision's own step and its tool results; nothing the decision added after it.
    let assistants = 0;
    let cut = messages.length;
    for (const [index, message] of messages.entries()) {
      if (message.role === "assistant") assistants += 1;
      if (assistants === value.step && message.role === "tool") {
        cut = index + 1;
        break;
      }
    }
    const kept = messages.slice(0, cut);
    const state = deriveWorkingState(kept, { classifyShell: classifyShellCommand });
    const signals = decisionSignals(state);
    const revised = chooseDecision(signals);
    rows.push({
      session,
      loop: value.loop,
      step: value.step,
      recordedV1: { chosen: value.chosen, rule: value.chosenBy, action: value.action },
      replayedV2: { chosen: revised.kind, rule: revised.rule },
      changed: revised.kind !== value.chosen,
      replayedSteps: kept.filter((message) => message.role === "assistant").length,
      signals: {
        landedEdits: signals.landedEdits,
        openFailures: signals.openFailures.map(brief),
        staleFailures: signals.staleFailures.map(brief),
        missingNames: signals.missingNames,
        unmeasuredShell: state.unmeasuredShell,
      },
    });
  };
  let workerSystem = null;
  let armed = false;
  let pending = null;
  for (const record of records) {
    if (record.type === "verification-command") {
      const value = payload(record);
      if (value.rule !== "adaptive-decision-v1") continue;
      if (value.phase === "armed") {
        armed = true;
        workerSystem = null;
      } else if (armed) pending = value;
      continue;
    }
    if (record.type !== "model-call" || !armed) continue;
    const prompt = payload(record).prompt;
    if (workerSystem === null) workerSystem = prompt?.system ?? null;
    if (pending !== null && prompt?.system === workerSystem) {
      settle(pending, conversationAt(prompt.tail));
      pending = null;
      armed = false;
    }
  }
  if (pending !== null)
    rows.push({
      session,
      loop: pending.loop,
      step: pending.step,
      replayedV2: null,
      note: "no worker model call followed the decision, so its conversation is not on the chain",
    });
}
const summary = {
  evidence:
    "replay of recorded messages through adaptive-decision-v2; no model call, no diagnosis content, no later step; shell effects in these sessions were never measured",
  decisions: rows.length,
  changed: rows.filter((row) => row.changed === true).length,
  rows,
};
const text = `${JSON.stringify(summary, null, 2)}\n`;
if (out === undefined) process.stdout.write(text);
else writeFileSync(out, text);
