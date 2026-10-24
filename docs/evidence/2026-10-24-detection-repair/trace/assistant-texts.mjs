// Prints assistant-role transcript text (not tool calls) between two sequences.
// Usage: node assistant-texts.mjs <session-dir> <from> <to>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [dir, from, to] = process.argv.slice(2);
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const r of lines) {
  if (r.type !== "transcript-component" || r.sequence < Number(from) || r.sequence > Number(to)) continue;
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  if (p.kind !== "message" || p.value?.role !== "assistant" || !p.value.text) continue;
  console.log(`#${r.sequence}: ${p.value.text}`);
}
