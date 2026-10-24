// Lists the decided tool calls (not the "requested" halves) with their input and output heads.
// Usage: node tool-calls.mjs <session-dir> [outWidth]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const ow = Number(process.argv[3] ?? 400);
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const load = (r) => { const p = join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
for (const r of lines) {
  if (r.type !== "tool-call") continue;
  const p = load(r);
  if (p.decision === "requested") continue;
  const inp = { ...p.input };
  for (const k of ["find", "replace", "content"]) if (typeof inp[k] === "string") inp[k] = `<${inp[k].length} chars>`;
  console.log(`#${r.sequence} ${p.toolName} ${p.decision}${p.denial ? "(" + p.denial + ")" : ""} ${JSON.stringify(inp).slice(0, 300)}`);
  console.log(`    -> ${String(p.output ?? p.detail).replace(/\n/g, "\\n").slice(0, ow)}`);
}
