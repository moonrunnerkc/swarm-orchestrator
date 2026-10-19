#!/usr/bin/env node
/**
 * What one replay's product recorded, read off its own chain: the sealed contract's digest, each
 * attempt's generated-check results and parts, the ratchet's decision, each rolled-back candidate
 * kept in evidence, the harness's own stop, the delivered patch, the result line's status, and
 * whether each repair's brief named the rolled-back candidate and which cases it called held.
 * Nothing here judges correctness; the delivered patch is scored apart.
 *
 *   node analyze-replay.mjs --replay <replay-o1 out> --out <file> [--patch-out <final.patch>]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadLedger } from "./candidates.mjs";

const { values } = parseArgs({
  options: { replay: { type: "string" }, out: { type: "string" }, "patch-out": { type: "string" } },
});
if (values.replay === undefined || values.out === undefined)
  throw new Error("usage: analyze-replay.mjs --replay <dir> --out <file> [--patch-out <file>]");
const run = JSON.parse(readFileSync(join(values.replay, "run.json"), "utf8"));
const sessions = join(run.home, ".swarm", "sessions");
const worker = readdirSync(sessions).find((one) => !one.endsWith("-plan"));
const records = loadLedger(join(sessions, worker, "ledger.jsonl"), join(sessions, worker, "blobs"));
// A file's git blob id, to compare with the reconstructed candidates' ids.
const blobOf = (text) =>
  text === null
    ? null
    : createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
const of = (type) => records.filter((one) => one.type === type);

const contract = of("goal-contract")[0]?.payload;
const sealedDigest = of("gate-run")
  .find((one) => one.payload.gateId === "task-diagnostics")
  ?.payload.title.replace("generated checks of sealed goal ", "");
const attempts = of("gate-run")
  .filter((one) => one.payload.gateId === "task-diagnostics")
  .map((one) => {
    const reading = JSON.parse(one.payload.stdout);
    return {
      attempt: one.payload.attempt,
      generatedChecks: Object.fromEntries(
        reading.findings.filter((finding) => finding.id !== "visible-check").map((finding) => [finding.id, finding.status]),
      ),
      suppliedCheck: reading.findings.find((finding) => finding.id === "visible-check")?.status,
      parts: reading.parts ?? null,
      unrepairable: reading.measures?.unrepairable === 1,
      heldLines: one.payload.stderr.split("\n").filter((line) => line.includes(" is held:")),
    };
  });
const ratchets = of("ratchet-decision").map((one) => ({
  scope: one.payload.scope,
  attempt: one.payload.attempt,
  accepted: one.payload.accepted,
  detail: one.payload.detail,
}));
const rejected = records
  .filter((one) => one.payload?.rule === "rejected-candidate-v1")
  .map((one) => ({
    type: one.type,
    attempt: one.payload.attempt,
    ratchetRecord: one.payload.ratchetRecord,
    files: (one.payload.files ?? []).map((file) => file.path),
    srcMimeBlob: blobOf((one.payload.files ?? []).find((file) => file.path === "src/Mime.ts")?.contents ?? null),
  }));
const harnessStops = of("session-stopped")
  .filter((one) => typeof one.payload.inputTokens !== "number")
  .map((one) => one.payload);
const escalation = of("escalation")[0]?.payload ?? null;
const diff = of("workspace-diff").at(-1)?.payload ?? null;
const resultLine = run.exitCode === undefined ? null : readFileSync(join(values.replay, "stdout.txt"), "utf8")
  .split("\n")
  .filter((line) => line.startsWith("{") && line.includes('"schema"'))
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((one) => one?.schema?.startsWith("swarm.result"))
  .at(-1);
const transcript = JSON.parse(readFileSync(join(values.replay, "transcript.json"), "utf8"));
const briefs = transcript
  .filter((one) => one.role === "worker" && one.first && one.stage > 0)
  .map((one) => ({
    attempt: one.stage,
    namesRolledBack: /Attempt \d+ was rolled back/.test(one.brief ?? ""),
    rolledBackLine: (one.brief ?? "").split("\n").find((line) => /^Attempt \d+ was rolled back/.test(line)) ?? null,
    brokeLine: (one.brief ?? "").split("\n").find((line) => line.startsWith("Gates it fixed:")) ?? null,
    heldInBrief: (one.brief ?? "").split("\n").filter((line) => line.includes(" is held:")).length,
    diffInBrief: ((one.brief ?? "").match(/index a28323b\.\.([0-9a-f]+)/) ?? [])[1] ?? null,
  }));
if (values["patch-out"] !== undefined && diff !== null) writeFileSync(resolve(values["patch-out"]), diff.patch);
const summary = {
  schema: "swarm-o1-replay-analysis.v1",
  kind: run.kind,
  swarmCli: run.swarmCli,
  exitCode: run.exitCode,
  plannerTurnsServed: run.plannerTurnsServed,
  sealedContractDigest: sealedDigest,
  matchesRecordedContract: sealedDigest === run.recordedContractDigest,
  admitted: contract?.contract?.checks?.filter((one) => one.author === "model").map((one) => one.id),
  attempts,
  ratchets,
  rejectedCandidatesKept: rejected,
  harnessStops,
  escalation: escalation === null ? null : { attemptsUsed: escalation.attemptsUsed, cap: escalation.cap, gateId: escalation.gateId },
  delivered: diff === null ? null : { rawPatchDigest: diff.rawPatchDigest, blob: (diff.patch.match(/index a28323b\.\.([0-9a-f]+)/) ?? [])[1] ?? null },
  outcome: resultLine?.outcome?.status ?? null,
  repairAttempts: resultLine?.outcome?.interventions?.repairAttempts ?? null,
  briefs,
};
writeFileSync(resolve(values.out), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, briefs: summary.briefs.map(({ brokeLine, ...rest }) => rest) }, null, 1));
