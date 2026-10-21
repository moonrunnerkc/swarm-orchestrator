// Read a Swarm session chain: the file set, every tool denial or failure, each gate cycle's
// blocking results, each independent verification's applied-patch digest, the ratchet
// decisions, the stop reasons and the final workspace diff.
//   node trace.mjs <session-directory>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const session = process.argv[2];
const ledger = readFileSync(join(session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const payload = (record) => {
  const path = join(session, "blobs", `${record.payloadDigest.slice(7)}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const short = (text, n = 160) => (text.length > n ? `${text.slice(0, n)}...` : text);
for (const record of ledger) {
  const p = payload(record);
  if (p === null) continue;
  const at = new Date(record.timestamp).toISOString().slice(11, 19);
  switch (record.type) {
    case "file-set-declared":
    case "file-set-amended":
      console.log(`${record.sequence} ${at} ${record.type}: ${JSON.stringify(p.files)}${p.added?.length ? ` added ${JSON.stringify(p.added)}` : ""}${p.reason ? ` (${short(p.reason, 120)})` : ""}`);
      break;
    case "tool-call":
      if (p.decision !== "allowed")
        console.log(`${record.sequence} ${at} tool ${p.toolName} ${p.decision}${p.denial ? ` (${p.denial})` : ""}: ${short(p.detail ?? "", 200)} | input ${short(JSON.stringify(p.input), 160)}`);
      else if (p.toolName === "write" || p.toolName === "edit")
        console.log(`${record.sequence} ${at} ${p.toolName} ${p.input?.path ?? ""}`);
      else if (p.toolName === "shell")
        console.log(`${record.sequence} ${at} shell: ${short(p.input?.command ?? "", 120)} -> exit ${p.facts?.exitCode}`);
      break;
    case "gate-run":
      if (p.status === "failed" || p.gateId === "tests")
        console.log(`${record.sequence} ${at} gate ${p.gateId} attempt ${p.attempt}: ${p.status} ${short(p.detail ?? "", 140)}`);
      break;
    case "independent-verification":
      console.log(`${record.sequence} ${at} independent-verification: applied ${p.appliedPatchDigest} regression ${p.regression ?? p.verdict ?? ""} ${short(p.advice ?? "", 100)}`);
      break;
    case "ratchet-decision":
      console.log(`${record.sequence} ${at} ratchet attempt ${p.attempt} (${p.scope}): accepted ${p.accepted} ${short(p.detail, 160)} measures after ${JSON.stringify(p.measures?.after)}`);
      break;
    case "escalation":
      console.log(`${record.sequence} ${at} escalation: ${p.gateId} attempts ${p.attemptsUsed}/${p.cap} ${short(p.reason ?? "", 120)}`);
      break;
    case "session-stopped":
      console.log(`${record.sequence} ${at} session-stopped: ${p.stopReason} steps ${p.steps} tokens ${p.tokensUsed}`);
      break;
    case "workspace-diff":
      console.log(`${record.sequence} ${at} workspace-diff ${p.rawPatchDigest} ${p.characters} chars; files: ${[...p.patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1]).join(", ")}`);
      break;
    case "run-assessment":
    case "claim":
    case "goal-verification":
      console.log(`${record.sequence} ${at} ${record.type}: ${short(JSON.stringify(p), 220)}`);
      break;
    default:
      break;
  }
}
