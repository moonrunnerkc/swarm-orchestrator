/**
 * Copy the launch records into the evidence directory and render the results page from them.
 *
 *   node scripts/comparison/publish.mjs --manifest <file> [--out-dir docs/evidence/2026-10-11/comparison]
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown, summarize } from "./analyze.mjs";
import { digestOf } from "./arms.mjs";
import { comparisonRoot } from "./workspace.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const manifestPath = args.get("manifest");
const outDir = args.get("out-dir") ?? "docs/evidence/2026-10-11/comparison";
const manifestBytes = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestBytes);
const digest = digestOf(manifestBytes);
const runs = join(comparisonRoot, "runs", digest.slice(7, 23));
const records = [];
mkdirSync(join(outDir, "records"), { recursive: true });
for (const name of readdirSync(runs)
  .filter((one) => one.endsWith(".json"))
  .sort()) {
  copyFileSync(join(runs, name), join(outDir, "records", name));
  records.push(JSON.parse(readFileSync(join(runs, name), "utf8")));
}
const summary = summarize(records);
const launched = records.filter((record) => record.infrastructureFailure === null).length;
const lines = [
  "# Results",
  "",
  `Rendered ${new Date().toISOString()} from ${records.length} record(s) of the ${manifest.launches.length} launches the manifest froze (${launched} completed, ${records.length - launched} infrastructure attempt(s)); manifest digest \`${digest}\`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).`,
  "",
  renderMarkdown(summary),
  "",
];
writeFileSync(join(outDir, "results.md"), lines.join("\n"));
console.log(`${records.length} record(s) copied; results.md rendered`);
