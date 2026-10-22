#!/usr/bin/env node
/**
 * One Swarm session's account, read off its ledger with no model: how each loop stopped, what it
 * edited, which repairs ran and what the ratchet decided, every independent verification (what
 * started it, how long it took, whether the repository's checks ran), run_check calls, the
 * repair-trace notices and compare_base comparisons, model time (the sum of recorded response
 * times), tokens, and calls of unknown usage.
 *
 *   node session-account.mjs <session dir>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
const records = readFileSync(join(directory, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const blob = (record) => {
  const bytes = readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest)
    throw new Error(`blob of ${record.sequence} differs from its record`);
  return JSON.parse(bytes.toString());
};
const start = records[0].timestamp;
const at = (record) => Math.round((record.timestamp - start) / 100) / 10;
const account = { session: directory.split("/").at(-1), records: records.length, wallSeconds: at(records.at(-1)) };
const calls = records.filter((r) => r.type === "tool-call").map((r) => ({ r, p: blob(r) }));
account.loops = records.filter((r) => r.type === "session-stopped").map((r) => {
  const p = blob(r);
  return { at: at(r), attempt: p.attempt ?? 0, stopReason: p.stopReason, steps: p.steps ?? null, tokens: p.tokensUsed ?? null };
});
account.edits = calls
  .filter(({ p }) => p.decision === "allowed" && ["write", "edit"].includes(p.toolName))
  .map(({ r, p }) => ({ at: at(r), tool: p.toolName, path: p.input?.path }));
account.ratchet = records.filter((r) => r.type === "ratchet-decision").map((r) => {
  const p = blob(r);
  return { attempt: p.attempt, accepted: p.accepted, detail: String(p.detail).slice(0, 160) };
});
// Each verification from the record before it that started it to its own record.
account.verifications = records.filter((r) => r.type === "independent-verification").map((r) => {
  const p = blob(r);
  const opened = records.filter((o) => o.sequence < r.sequence && o.type === "dependency-install").at(-1);
  const trigger = records.filter((o) => o.sequence < r.sequence && o.type === "tool-call").at(-1);
  const triggerTool = trigger === undefined ? null : blob(trigger).toolName;
  return {
    at: at(r),
    seconds: opened === undefined ? null : Math.round((r.timestamp - opened.timestamp) / 100) / 10,
    repositoryChecks: (p.checks ?? []).length,
    regression: p.regression,
    task: p.task,
    verified: p.verified,
    startedBy: triggerTool === "run_check" && r.sequence - trigger.sequence < 12 ? "run_check" : "gate or final",
  };
});
account.verificationSeconds = account.verifications.reduce((sum, v) => sum + (v.seconds ?? 0), 0);
account.runCheck = calls.filter(({ p }) => p.toolName === "run_check" && p.decision === "allowed").map(({ p }) => ({
  program: p.input?.program !== undefined,
  compareBase: p.input?.compare_base === true,
}));
account.traceNotices = records
  .filter((r) => r.type === "verification-command")
  .map(blob)
  .filter((p) => p.rule === "preservation-trace-v1")
  .map((p) => ({ attempt: p.attempt, passingAtBase: p.passingAtBase.map((g) => g.gateId) }));
const models = records.filter((r) => r.type === "model-call").map(blob);
account.modelCalls = models.length;
account.modelSeconds = Math.round(models.reduce((sum, p) => sum + (p.performance?.responseTimeMs ?? 0), 0) / 100) / 10;
account.tokens = models.reduce((sum, p) => sum + (p.inputTokens ?? 0) + (p.outputTokens ?? 0), 0);
account.unknownUsageCalls = models.filter((p) => p.usageStatus !== "reported").length;
const assessment = records.filter((r) => r.type === "run-assessment").map(blob).at(-1);
account.verdict = { acceptable: assessment?.verdict?.acceptable ?? null, reason: String(assessment?.verdict?.reasons?.assessment ?? "").slice(0, 300) };
console.log(JSON.stringify(account, null, 1));
