// Summarizes gate-run, gate-baseline and gate-bond records: attempt, gate, status, detail, attribution.
// Usage: node gates.mjs <session-dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const r of lines) {
  if (!["gate-run", "gate-baseline", "gate-bond"].includes(r.type)) continue;
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  const inh = p.inheritance ? ` inheritance=${p.inheritance.attribution} new=${JSON.stringify(p.inheritance.newFailures)} inherited=${JSON.stringify(p.inheritance.inherited)}` : "";
  const ww = p.workspaceWrites ? ` workspaceWrites=${JSON.stringify(p.workspaceWrites)}` : "";
  const m = p.measures && Object.keys(p.measures).length ? ` measures=${JSON.stringify(p.measures)}` : "";
  const bond = r.type === "gate-bond" ? ` bond=${JSON.stringify(p.bond?.description ?? null)} verdict=${p.verdict ?? p.status ?? ""}` : "";
  console.log(`#${r.sequence} ${r.type} a${p.attempt ?? "-"} ${p.gateId} ${p.status ?? ""} [${p.requirement ?? ""}] cmd=${p.command ?? "-"} :: ${String(p.detail).slice(0, 220)}${inh}${ww}${m}${bond}`);
}
