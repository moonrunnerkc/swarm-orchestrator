// Copies a bundle and flips one byte of one record's timestamp, so the demonstration's refusal
// is over a change a person can see: record 28's timestamp, one digit up.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [from, to] = process.argv.slice(2);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
const ledger = join(to, "ledger.jsonl");
const lines = readFileSync(ledger, "utf8").split("\n");
const index = 28;
const record = JSON.parse(lines[index]);
const before = String(record.timestamp);
const changed = lines[index].replace(`"timestamp":${before}`, `"timestamp":${Number(before) + 1}`);
if (changed === lines[index]) throw new Error("the timestamp was not where this script expected it");
lines[index] = changed;
writeFileSync(ledger, lines.join("\n"));
console.log(`record ${index}: timestamp ${before} became ${Number(before) + 1} in ${to}/ledger.jsonl`);
