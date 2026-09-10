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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { heldBackAgreementRate, tallyFalseGreens } from "../dist/eval/false-green-rate.js";
import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;

const named = (one) => `${one.repository}#${one.pull}`;

/**
 * The harness a set of rows agrees on, which is the one the rate is about.
 *
 * A rate assembled from rows two tool versions produced measures neither, which is why every row
 * carries the commit that judged it. Read from the rows rather than from HEAD: the tree moves for
 * reasons that do not change a verdict, a documentation commit among them, and a report that
 * insisted on HEAD would throw away a corpus every time one landed. Rows from any other commit are
 * named and left out rather than folded in.
 */
function newestHarnessAmong(rows) {
  const commits = new Set();
  for (const row of rows) {
    // A row that names no harness predates the rule that every row names one. It cannot be
    // attributed to a tool version, so it cannot be in a rate about one.
    if (row.harness !== undefined) commits.add(row.harness);
  }
  // The newest, not the commonest. A re-judge fills in from the oldest rows forward, so the
  // commonest commit is the one being replaced, and a rate labelled with it describes the tool
  // that is being measured away.
  let newest = null;
  let newestAt = -1;
  for (const commit of commits) {
    let at = -1;
    try {
      at = Number(
        execFileSync("git", ["show", "-s", "--format=%ct", commit], {
          cwd: repositoryRoot,
          encoding: "utf8",
        }).trim(),
      );
    } catch {
      continue;
    }
    if (at > newestAt) {
      newest = commit;
      newestAt = at;
    }
  }
  return newest;
}

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
  const admitted = runs.filter((one) => viable.has(named(one)));
  const harness = newestHarnessAmong(admitted);
  return {
    kept: harness === null ? [] : admitted.filter((one) => one.harness === harness),
    setAside: runs.length - admitted.length,
    otherHarness:
      harness === null
        ? admitted.length
        : admitted.filter((one) => one.harness !== harness).length,
    harness,
  };
}

/**
 * The hand-authored corpus as the second-oracle pass last scored it.
 *
 * Not `2026-09-04/real-repos/rescored.json`, which holds the same eighteen runs under an earlier
 * scoring: reading that one reports corners no current pass produced, which is a published number
 * describing a tool that no longer exists.
 */
function handAuthoredRows() {
  const { runs } = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/evidence/2026-09-06/second-oracle/scored.json"),
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

/**
 * How independent the two halves of a mined split turn out to be, which is this corpus's one
 * weakness against the hand-authored one: both halves come from one author in one sitting. A pair
 * that never disagrees is buying less than it appears to, and only the corpus can say.
 */
function reportAgreement(rows) {
  const agreement = heldBackAgreementRate(rows);
  console.log(
    agreement.rate === null
      ? "halves compared on 0 patches, so nothing here says whether they are independent"
      : `halves agreed on ${agreement.agreed} of ${agreement.compared} patches both judged: ` +
          `${(agreement.rate * 100).toFixed(1)}%`,
  );
}

const mined = minedRows();
report(
  "mined from merged pull requests",
  mined.kept,
  `${mined.setAside === 0 ? "" : `, ${mined.setAside} set aside: the viability filter no longer admits them`}` +
    `${mined.otherHarness === 0 ? "" : `, ${mined.otherHarness} left out: judged by a different harness commit`}` +
    `, judged at ${mined.harness === null ? "no recorded harness" : mined.harness.slice(0, 9)}`,
);
reportAgreement(mined.kept);
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
