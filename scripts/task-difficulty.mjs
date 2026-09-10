#!/usr/bin/env node
/**
 * Which task set gate 7 should be run over, measured rather than assumed.
 *
 * The gate asks whether task success is non-inferior to the strongest single-agent baseline. What
 * has blocked it is not the comparison: it is that the golden set does not discriminate. This
 * model solves those twenty cases first-try, so every arm accepts everything and a paired test has
 * nothing to work on.
 *
 *   node scripts/task-difficulty.mjs
 *
 * Reads what the mined pass recorded. Runs no model and judges nothing. It says which set leaves a
 * comparison something to measure, and it is not the comparison.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { separateAdversarialRows } from "../dist/eval/false-green-rate.js";
import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";
import { tallyTaskSuccess } from "../dist/eval/task-difficulty.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const named = (one) => `${one.repository}#${one.pull}`;
const percent = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

const root = prTaskEvidenceRoot(repositoryRoot);
const { runs } = JSON.parse(readFileSync(join(root, "scored.json"), "utf8"));
const { tasks } = JSON.parse(readFileSync(join(root, "viable.json"), "utf8"));
const viable = new Set(tasks.filter((one) => one.viable).map(named));
const { ordinary } = separateAdversarialRows(runs.filter((one) => viable.has(named(one))));

const tally = tallyTaskSuccess(ordinary);
console.log("=== mined pull-request tasks, as the ordinary arm ran them ===");
console.log(
  `${tally.attempted} task(s) judged, ${tally.solved} solved: ${percent(tally.point)}` +
    (tally.point === null ? "" : ` 95% CI [${percent(tally.lower)}, ${percent(tally.upper)}]`),
);
console.log(
  `${tally.producedNoChange} run(s) wrote no patch at all, ${tally.unjudgeable} unjudgeable ` +
    "and out of the denominator, because a task nothing could judge says nothing about the model",
);

// The sensitivity that matters, because an empty patch is only a model failure if the model was
// reachable. These rows were recorded before anything checked that, and an outage on
// 2026-09-10 showed what it costs: two rows written down as the model writing nothing, one of
// which came back a certified success once the endpoint was up. Their latencies say nothing is
// obviously wrong, since a run refused at the socket returns in seconds and none of these did,
// but that is weak evidence and it is reported as weak.
const withoutTheEmpties = tallyTaskSuccess(ordinary.filter((one) => one.producedNoChange !== true));
if (tally.producedNoChange > 0) {
  console.log(
    `\nThose ${tally.producedNoChange} are in the denominator as model failures, and their ` +
      "attribution predates the endpoint probe that now confirms it. Dropping them entirely, " +
      `which is the most generous reading, gives ${withoutTheEmpties.solved} of ` +
      `${withoutTheEmpties.attempted}: ${percent(withoutTheEmpties.point)}` +
      (withoutTheEmpties.point === null
        ? ""
        : ` [${percent(withoutTheEmpties.lower)}, ${percent(withoutTheEmpties.upper)}]`) +
      ". The set discriminates either way, which is what this measures.",
  );
}
console.log(
  tally.discriminates
    ? "The model both succeeds and fails inside this set, so a paired comparison over it has " +
        "variance to work on. That is what gate 7 needs of a set and what the golden set does " +
        "not give: twenty cases this model solves first-try leave every arm tied."
    : "The model does not both succeed and fail inside this set, so no comparison over it can " +
        "measure anything. This is the shape of the problem gate 7 is stuck on.",
);

// Per repository, because a set whose difficulty comes from one project is measuring that project.
const byRepository = new Map();
for (const row of ordinary) {
  const held = byRepository.get(row.repository) ?? [];
  held.push(row);
  byRepository.set(row.repository, held);
}
console.log("\nby repository, so the difficulty is not one project's:");
for (const [repository, rows] of [...byRepository].sort(
  (one, other) => other[1].length - one[1].length,
)) {
  const one = tallyTaskSuccess(rows);
  console.log(
    `  ${repository.padEnd(34)} ${String(one.solved).padStart(2)} of ${String(one.attempted).padStart(2)} solved` +
      `${one.point === null ? "" : `  ${percent(one.point)}`}`,
  );
}

console.log(
  "\nWhat this is not: gate 7. Success here is one arm's, the full harness as the mined pass " +
    "runs it, against an oracle held back from it. The gate needs the same tasks run under the " +
    "single-agent baseline as well, which needs arm selection in the mined pass and a second run " +
    "of every task. Neither is done, and this set is what they should be run over.",
);
