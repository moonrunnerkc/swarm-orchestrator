// Summarizes independent-verification records: per check status, base status and attribution.
// Usage: node indep.mjs <session-dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const r of lines) {
  if (r.type !== "independent-verification") continue;
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  console.log(`#${r.sequence} keys=${Object.keys(p).join(",")}`);
  console.log(`  advice: ${p.advice}`);
  for (const c of p.checks ?? []) console.log(`  check ${c.id}: ${c.status} base=${c.baseTestsStatus ?? "-"} attribution=${c.attribution ?? "-"} baseTestsFiles=${JSON.stringify(c.baseTestsFiles ?? null)} detail=${String(c.detail).slice(0, 200)}`);
  for (const k of Object.keys(p)) if (!["checks", "advice", "checkoutPath", "bondedMutants"].includes(k)) console.log(`  ${k}: ${JSON.stringify(p[k]).slice(0, 400)}`);
}
