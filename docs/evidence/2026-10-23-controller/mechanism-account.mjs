/**
 * Which of the revision's mechanisms a Swarm launch exercised, and what the worker did next, from
 * its kept session ledger and its study record, with no model:
 *
 * - decisions under either rule (v1 or v2), follow-up looks, reassessments and the action carried
 *   out, with what each cost;
 * - edits the rewrite reading held, whether the same change came back with a reason, and whether
 *   the next landed edit of that file still dropped the call;
 * - batch edits, and edit results that named files where the replaced text still occurs;
 * - shell commands whose measured effect changed the tree, and the references a move left behind;
 * - the requested-tests follow-up, given or not.
 *
 * "Next" is order on the chain only: it says what came after a notice, never that the notice
 * caused it.
 *
 *   node docs/evidence/2026-10-23-controller/mechanism-account.mjs <study-record.json>
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const recordPath = process.argv[2];
const study = JSON.parse(readFileSync(recordPath, "utf8"));
const out = {
  task: study.task,
  sample: study.sample ?? 1,
  arm: study.arm,
  outcome: study.outcome,
  scores: study.scores
    ? {
        visible: study.scores.visible?.passed ?? null,
        hidden: study.scores.hidden?.verdict ?? null,
        staticPassed: study.scores.static?.passed ?? null,
      }
    : null,
  productVerdict: study.invocation?.productVerdict?.acceptable ?? null,
  wallMs: study.invocation?.wallMs ?? null,
  tokens: study.invocation?.tokens ?? null,
};

const ledgerPath = study.evidence === undefined ? null : findLedger(study.evidence);
if (ledgerPath === null) {
  out.session = "no kept session";
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
const blobs = join(dirname(ledgerPath), "blobs");
const records = readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
const payload = (record) => {
  const bytes = readFileSync(join(blobs, `${record.payloadDigest.slice(7)}.json`));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest)
    throw new Error(`payload of record ${record.sequence} differs from its digest`);
  return JSON.parse(bytes);
};

const harnessRules = new Map();
const calls = [];
for (const record of records) {
  const value = payload(record);
  if (record.type === "verification-command" && typeof value.rule === "string") {
    const list = harnessRules.get(value.rule) ?? [];
    list.push({ sequence: record.sequence, ...value });
    harnessRules.set(value.rule, list);
  }
  if (record.type === "tool-call" && value.decision !== "requested")
    calls.push({ sequence: record.sequence, ...value });
}
const landed = (call) => call.decision === "allowed" && (call.toolName === "edit" || call.toolName === "write");
const decisions = [
  ...(harnessRules.get("adaptive-decision-v1") ?? []),
  ...(harnessRules.get("adaptive-decision-v2") ?? []),
].filter((one) => one.phase !== "armed");
out.decisions = decisions.map((one) => {
  const next = calls.find((call) => call.sequence > one.sequence && landed(call) && !String(call.callId).startsWith("harness-decision-"));
  return {
    rule: one.rule,
    phase: one.phase,
    loop: one.loop,
    step: one.step,
    action: one.action,
    chosenBy: one.chosenBy ?? null,
    reason: one.reason ?? null,
    notice: one.notice !== null && one.notice !== undefined,
    carriedOut: one.carriedOut ?? null,
    diagnosis:
      one.diagnosis === undefined
        ? null
        : {
            actionable: one.diagnosis.actionable,
            locations: (one.diagnosis.locations ?? []).map((l) => `${l.path}:${l.line}`),
            action: one.diagnosis.action ?? null,
            answer: String(one.diagnosis.answer ?? "").slice(0, 600),
          },
    spent: one.spent ?? null,
    nextWorkerEdit: next === undefined ? null : { sequence: next.sequence, paths: next.input?.edits?.map((e) => e.path) ?? [next.input?.path] },
  };
});

const held = calls.filter((call) => call.toolName === "edit" && call.decision !== "allowed" && String(call.output ?? call.detail ?? "").includes("Not applied yet"));
out.rewriteHolds = held.map((call) => {
  const path = call.input?.path ?? call.input?.edits?.[0]?.path;
  const resent = calls.find((later) => later.sequence > call.sequence && landed(later) && typeof later.input?.reason === "string" && (later.input?.path ?? later.input?.edits?.[0]?.path) === path);
  const nextEdit = calls.find((later) => later.sequence > call.sequence && landed(later) && (later.input?.path ?? later.input?.edits?.[0]?.path) === path);
  return {
    sequence: call.sequence,
    path,
    named: /calls (.+?), the new code/.exec(String(call.output ?? call.detail ?? ""))?.[1] ?? null,
    resentWithReason: resent === undefined ? null : { sequence: resent.sequence, reason: resent.input.reason.slice(0, 400) },
    nextLandedEditOfFile: nextEdit === undefined ? null : { sequence: nextEdit.sequence, withReason: typeof nextEdit.input?.reason === "string" },
  };
});
out.batchEdits = calls.filter((call) => landed(call) && Array.isArray(call.input?.edits)).map((call) => ({ sequence: call.sequence, edits: call.input.edits.length, files: new Set(call.input.edits.map((e) => e.path)).size }));
out.stillOccursNotes = calls.filter((call) => landed(call) && String(call.output ?? "").includes("still occurs in")).length;
const effects = harnessRules.get("workspace-effect-v1") ?? [];
out.shellEffects = {
  measured: effects.filter((one) => one.unmeasured === null).length,
  unmeasured: effects.filter((one) => one.unmeasured !== null).length,
  changedTree: effects.filter((one) => (one.changeCount ?? 0) > 0).map((one) => ({ sequence: one.sequence, changeCount: one.changeCount, renames: (one.changes ?? []).filter((c) => c.status === "R").length, referencesLeft: (one.references ?? []).length })),
};
out.followUps = (harnessRules.get("outcome-follow-up-v1") ?? []).map((one) => ({ state: one.state, attempt: one.attempt ?? null, accepted: one.accepted ?? null, reason: one.reason ?? null }));
console.log(JSON.stringify(out, null, 2));

function findLedger(directory) {
  if (!existsSync(directory)) return null;
  if (existsSync(join(directory, "ledger.jsonl"))) return join(directory, "ledger.jsonl");
  for (const entry of readdirSync(directory, { recursive: true }))
    if (String(entry).endsWith("ledger.jsonl") && !String(entry).includes("bundle")) return join(directory, String(entry));
  return null;
}
