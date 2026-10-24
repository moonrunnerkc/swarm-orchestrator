// Prints every user-role transcript message (the prompts the harness sent), with its sequence.
// Usage: node user-messages.mjs <session-dir> [maxChars]
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const max = Number(process.argv[3] ?? 3000);
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const r of lines) {
  if (r.type !== "transcript-component") continue;
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  if (p.kind !== "message" || p.value?.role !== "user") continue;
  console.log(`===== #${r.sequence}\n${String(p.value.text).slice(0, max)}`);
}
