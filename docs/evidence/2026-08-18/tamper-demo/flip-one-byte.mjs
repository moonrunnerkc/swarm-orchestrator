/**
 * Reproduces the tamper demonstration beside this file.
 *
 * Copies the verified bundle, changes exactly one byte inside one ledger record, and
 * leaves the copy for the verifier to read. The byte is the last digit of record 28's
 * timestamp: a field the record's own hash covers, chosen because nothing about the run
 * changes, which is the point. A tamper does not have to be a lie about a result to be
 * caught, and a reviewer who only compared results would see nothing here.
 *
 *   node flip-one-byte.mjs ../live-frontier /tmp/tampered
 *   node /tmp/tampered/verify.mjs /tmp/tampered
 */
import { cp, readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";

const [source, destination] = argv.slice(2);
if (source === undefined || destination === undefined) {
  console.error("usage: node flip-one-byte.mjs <verified bundle> <destination>");
  exit(2);
}

await cp(source, destination, { recursive: true });

const ledgerPath = `${destination}/ledger.jsonl`;
const lines = (await readFile(ledgerPath)).toString("binary").split("\n");
const target = 27;
const line = lines[target];
const found = /"timestamp":(\d+)/.exec(line);
if (found === null) {
  console.error(`record ${target + 1} carries no timestamp to change`);
  exit(2);
}

const at = found.index + '"timestamp":'.length + found[1].length - 1;
const before = line[at];
const after = before === "8" ? "7" : "8";
lines[target] = line.slice(0, at) + after + line.slice(at + 1);

await writeFile(ledgerPath, Buffer.from(lines.join("\n"), "binary"));
console.log(`record ${target + 1}: one byte, ${before} -> ${after}, in its timestamp`);
console.log(`now run: node ${destination}/verify.mjs ${destination}`);
