#!/usr/bin/env node
/**
 * The false-green rate this project publishes, computed from the two corpora rather than typed.
 *
 * The combined figure existed only in prose: each pass printed its own corpus and a person added
 * them up in a sentence. A number nobody can re-derive is the shape of claim this whole project
 * refuses elsewhere, and it is the number in the README.
 *
 *   node scripts/false-green-rate.mjs
 *
 * Reads what the passes recorded. Runs no model, judges nothing, and clones nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { tallyFalseGreens } from "../dist/eval/false-green-rate.js";
import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;

const named = (one) => `${one.repository}#${one.pull}`;

/**
 * Mined rows for tasks the viability filter still admits. A row whose task the filter now rejects
 * is not an opportunity: its halves are known not to both refuse the base, so a verdict on it
 * establishes nothing. The rows stay where they are, because they are what was run.
 */
function minedRows() {
  const root = prTaskEvidenceRoot(repositoryRoot);
  const { runs } = JSON.parse(readFileSync(join(root, "scored.json"), "utf8"));
  const { tasks } = JSON.parse(readFileSync(join(root, "viable.json"), "utf8"));
  const viable = new Set(tasks.filter((one) => one.viable).map(named));
  return {
    kept: runs.filter((one) => viable.has(named(one))),
    setAside: runs.filter((one) => !viable.has(named(one))).length,
  };
}

function handAuthoredRows() {
  const { runs } = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/evidence/2026-09-04/real-repos/rescored.json"),
      "utf8",
    ),
  );
  return runs;
}

const percent = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

function report(label, rows, extra = "") {
  const tally = tallyFalseGreens(rows);
  console.log(`\n=== ${label} ===`);
  console.log(`${rows.length} judgement(s)${extra}`);
  console.log(
    `${tally.opportunities} certified, ${tally.falseGreens} false green(s): ` +
      `${percent(tally.point)}` +
      (tally.point === null
        ? "  (nothing certified, so there is no rate here rather than a rate of zero)"
        : ` 95% CI [${percent(tally.lower)}, ${percent(tally.upper)}]`),
  );
  console.log(
    `refused: ${tally.refusedOnReach} on reach, ${tally.refusedOnSealed} on the sealed half; ` +
      `${tally.falseReds} false red(s); ${tally.unjudgeable} unjudgeable`,
  );
  return tally;
}

const mined = minedRows();
report(
  "mined from merged pull requests",
  mined.kept,
  mined.setAside === 0
    ? ""
    : ` (${mined.setAside} more set aside: the viability filter no longer admits them)`,
);
const hand = handAuthoredRows();
report("hand-authored, two oracles per task", hand);
const both = report("both corpora", [...mined.kept, ...hand]);

// Said out loud, because the denominator moves when the tool does. A check that refuses more makes
// the tool safer and the measurement weaker at once, and a rate printed without that is half a
// finding.
if (both.refusedOnReach > 0) {
  console.log(
    `\n${both.refusedOnReach} patch(es) both oracles accept were refused because the tool's own ` +
      "oracle never ran part of the change. Those are not false greens and they are not passes: " +
      "they left the certified set, so this interval is wider for them.",
  );
}
