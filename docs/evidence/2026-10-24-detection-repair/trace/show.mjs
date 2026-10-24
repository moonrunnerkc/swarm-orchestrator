// Prints the payloads of the named ledger sequences, truncating long strings.
// Usage: node show.mjs <session-dir> <maxStringChars> <seq>...
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [dir, max, ...seqs] = process.argv.slice(2);
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const trunc = (v) => typeof v === "string" ? (v.length > Number(max) ? v.slice(0, Number(max)) + `...<+${v.length - Number(max)}>` : v)
  : Array.isArray(v) ? v.map(trunc) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trunc(x)])) : v;
for (const s of seqs) {
  const r = lines.find((x) => String(x.sequence) === s);
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  console.log(`===== #${s} ${r.type} ${new Date(r.timestamp).toISOString()}`);
  console.log(JSON.stringify(trunc(p), null, 1));
}
