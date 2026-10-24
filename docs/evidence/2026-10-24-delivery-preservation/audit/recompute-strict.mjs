// Applies audit-study.mjs's strictComplete and verdictAccuracy rule to an output written before
// the rule required the frozen hidden verdict as well, from the fields the output already records.
// usage: node recompute-strict.mjs results/audit-*.json
import { readFileSync, writeFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  const audit = JSON.parse(readFileSync(file, "utf8"));
  for (const entry of audit.launches) {
    if (entry.strictComplete === undefined) continue;
    entry.strictComplete = entry.strictComplete === true && entry.frozenHidden === "pass";
    entry.verdictAccuracy =
      entry.productAcceptable === null
        ? "no product verdict"
        : entry.productAcceptable === entry.strictComplete
          ? entry.productAcceptable
            ? "correct accept"
            : "correct refusal"
          : entry.productAcceptable
            ? "false accept"
            : "false refusal";
  }
  writeFileSync(file, `${JSON.stringify(audit, null, 2)}\n`);
}
