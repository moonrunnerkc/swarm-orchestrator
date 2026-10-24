// Prints each ledger record with its type and a truncated payload, or one record in full.
// Usage: node dump-ledger.mjs <session-dir> [--seq N] [--width W] [--type T]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const args = process.argv.slice(3);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const seq = opt("--seq");
const width = Number(opt("--width") ?? 240);
const type = opt("--type");
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const payload = (r) => {
  const hex = r.payloadDigest.replace("sha256:", "");
  for (const p of [join(dir, "blobs", `${hex}.json`), join(dir, "blobs", hex)]) if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  return null;
};
for (const r of lines) {
  if (seq !== undefined && String(r.sequence) !== seq) continue;
  if (type && r.type !== type) continue;
  const p = payload(r);
  if (seq !== undefined) { console.log(JSON.stringify({ ...r, payload: p }, null, 2)); continue; }
  console.log(`${r.sequence}\t${r.type}\t${new Date(r.timestamp).toISOString().slice(11, 19)}\t${JSON.stringify(p).slice(0, width)}`);
}
