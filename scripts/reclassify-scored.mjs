#!/usr/bin/env node
/**
 * Re-derives every corner in scored.json from the verdicts already recorded, with no model calls
 * and no test runs.
 *
 * The scoring pass loads the classifier once and holds the whole result set in memory, rewriting
 * the file after each task. So a classifier fix made while it runs reaches neither the results
 * already written nor the ones still to come, and editing the file underneath it is simply
 * overwritten. Both are the same fix applied once, afterwards, from the recorded verdicts.
 *
 *   node scripts/reclassify-scored.mjs [--check]
 *
 * `--check` reports what would change and writes nothing, which is what to run while a pass is
 * still going.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { classifyAgainstHeldBackOracle } from "../dist/eval/campaign-run.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const armAt = process.argv.indexOf("--arm");
const arm = armAt === -1 ? null : process.argv[armAt + 1];
const path = join(
  repositoryRoot,
  arm === null ? "campaign/pr-tasks/scored.json" : `campaign/pr-tasks/scored.${arm}.json`,
);
const checkOnly = process.argv.includes("--check");

const scored = JSON.parse(readFileSync(path, "utf8"));
let changed = 0;
for (const run of scored.runs) {
  const corner = classifyAgainstHeldBackOracle({
    verifiedWithFirstOracle: run.verified,
    heldBack: run.heldBackOracle,
    regression: run.regression,
    sealed: run.sealedOracle,
  });
  if (corner !== run.corner) {
    console.log(`  ${run.repository}#${run.pull}: ${run.corner} -> ${corner}`);
    if (!checkOnly) run.corner = corner;
    changed += 1;
  }
}

const counts = {};
for (const run of scored.runs) {
  const key = checkOnly ? run.corner : run.corner;
  counts[key] = (counts[key] ?? 0) + 1;
}

if (checkOnly) {
  console.log(`\n${changed} would change. Nothing written.`);
} else {
  writeFileSync(path, `${JSON.stringify(scored, null, 2)}\n`);
  console.log(`\n${changed} reclassified. ${JSON.stringify(counts)}`);
}
