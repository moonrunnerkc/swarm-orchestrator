#!/usr/bin/env node
/**
 * What bonding the task oracle costs, over the patches the tool certified.
 *
 * Blocking on a `vacuous` bond refuses patches. Some of those refusals are the tool being right
 * about an oracle it was handed, and some would be the tool being wrong; the difference decides
 * whether it should block at all, and it is arithmetic over what the two passes recorded rather
 * than a judgement anybody makes at reporting time.
 *
 *   node scripts/bond-cost.mjs           # the table
 *   node scripts/bond-cost.mjs --mutants # every vacuous verdict's mutant, for the audit
 *
 * Runs no model, judges nothing and clones nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyAgainstHeldBackOracle } from "../dist/eval/campaign-run.js";
import { tallyFalseGreens } from "../dist/eval/false-green-rate.js";
import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";
import { wilsonInterval } from "../dist/eval/statistics.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const showMutants = process.argv.includes("--mutants");

const named = (one) =>
  one.repository === undefined
    ? `${one.name}/${one.arm}/run-${one.run}`
    : `${one.repository}#${one.pull}`;

function minedRows() {
  const root = prTaskEvidenceRoot(repositoryRoot);
  const { runs } = JSON.parse(readFileSync(join(root, "scored.json"), "utf8"));
  const { tasks } = JSON.parse(readFileSync(join(root, "viable.json"), "utf8"));
  const viable = new Set(tasks.filter((one) => one.viable).map(named));
  return runs.filter((one) => viable.has(named(one)));
}

function handAuthoredRows() {
  return JSON.parse(
    readFileSync(join(repositoryRoot, "docs/evidence/2026-09-06/second-oracle/scored.json"), "utf8"),
  ).runs;
}

const rows = [...minedRows(), ...handAuthoredRows()];

/**
 * What each row's corner is under each regime, re-derived from the fields the row records rather
 * than read off whichever regime happens to be on.
 *
 * Read off the recorded corner instead, this table stops being able to show the thing it exists
 * to show the moment blocking is turned on: the rows already carry the blocking answer, and the
 * report-only column becomes a copy of it. The reasons to refuse are all recorded, so both
 * columns are arithmetic over the same row.
 */
function bothRegimes(row) {
  const sealed = row.sealedOracle ?? row.firstOracle;
  const shared = {
    heldBack: row.heldBackOracle,
    regression: row.regression,
    sealed,
    oracleReach: row.oracleReach,
  };
  const withoutBond =
    row.regression === "pass" && sealed === "accepted" && row.oracleReach !== "unreached";
  // The third regime, re-derived rather than re-run. A mutant carrying any witness other than
  // `not-adjudicated` was accepted on a line the oracle demonstrably ran, which is the whole of
  // what `vacuous` meant before a witness was required of it, so the row's own record answers
  // what the other regime would have said about it.
  const vacuousWithoutAWitness = (row.bondedMutants ?? []).some(
    (one) =>
      one.verdict === "vacuous" ||
      (one.witness !== undefined && one.witness !== "not-adjudicated"),
  );
  return {
    reportOnly: classifyAgainstHeldBackOracle({
      ...shared,
      verifiedWithFirstOracle: withoutBond,
    }),
    blocking: classifyAgainstHeldBackOracle({
      ...shared,
      verifiedWithFirstOracle: withoutBond && row.oracleBond !== "vacuous",
      oracleBond: row.oracleBond,
    }),
    witnessRecorded: classifyAgainstHeldBackOracle({
      ...shared,
      verifiedWithFirstOracle: withoutBond && !vacuousWithoutAWitness,
      oracleBond: vacuousWithoutAWitness ? "vacuous" : row.oracleBond,
    }),
  };
}

const regimes = new Map(rows.map((row) => [row, bothRegimes(row)]));
const isCertified = (corner) => corner === "true-green" || corner === "false-green";
// The denominator the rule was written against: what the tool certified before bonding refused
// anything. It does not move when the switch does, which is what lets the two columns be compared.
const certified = rows.filter((one) => isCertified(regimes.get(one).reportOnly));

const states = ["held", "vacuous", "unshown", "not-bonded"];
const counted = Object.fromEntries(
  states.map((state) => [state, certified.filter((one) => one.oracleBond === state).length]),
);
const unrecorded = certified.filter((one) => !states.includes(one.oracleBond)).length;

console.log(`=== bonding over the ${certified.length} patches the tool certified ===`);
for (const state of states) {
  console.log(`  ${state.padEnd(12)} ${counted[state]}`);
}
if (unrecorded > 0) {
  console.log(`  ${"not-recorded".padEnd(12)} ${unrecorded}  <- judged before bonding existed`);
}

/**
 * What the held-back oracle did with the same mutant, which is what a `vacuous` verdict is worth.
 *
 * A held-back oracle that refuses the same mutant means a user who supplied the whole suite would
 * have got `held`, so the refusal is a product of splitting one suite in two rather than something
 * users meet. One that accepts it too is the refusal a whole-suite user would actually see. Where
 * the held-back oracle never judged the mutant, because it refuses the unmutated patch, there is
 * nothing to compare and that is said rather than guessed at.
 *
 * The third bucket the decision rule names, a mutant that changes nothing, is not decidable here:
 * it is what the audit reads by hand, which is why --mutants prints every one of them.
 */
const vacuous = certified.filter((one) => one.oracleBond === "vacuous");

const split = { "real gap": 0, unconfirmed: 0, "held-back oracle never judged the mutant": 0 };
for (const row of vacuous) {
  const gaps = (row.bondedMutants ?? []).filter((one) => one.verdict === "vacuous");
  for (const gap of gaps) {
    const heldBack = (row.heldBackBondedMutants ?? {})[gap.id];
    if (heldBack === "held") split["real gap"] += 1;
    else if (heldBack === undefined) split["held-back oracle never judged the mutant"] += 1;
    else split.unconfirmed += 1;
  }
}

console.log(`\n=== what the held-back oracle did with the same mutant ===`);
for (const [bucket, count] of Object.entries(split)) {
  console.log(`  ${bucket.padEnd(42)} ${count}`);
}
console.log(
  "  a mutant that changes nothing is not decidable here and is what the audit reads by hand",
);

if (showMutants) {
  console.log(`\n=== every vacuous verdict, for the audit ===`);
  for (const row of vacuous) {
    for (const gap of (row.bondedMutants ?? []).filter((one) => one.verdict === "vacuous")) {
      console.log(
        `  ${named(row)}  ${gap.id}  held-back: ${(row.heldBackBondedMutants ?? {})[gap.id] ?? "never judged the mutant"}`,
      );
      console.log(`      - ${gap.before}`);
      console.log(`      + ${gap.after}`);
    }
  }
}

const percent = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/**
 * The three regimes side by side. Under either blocking one, a certified patch whose bond came
 * back vacuous leaves the certified set, exactly as a reach refusal already does, so both the
 * numerator and the denominator move and the interval widens with them.
 *
 * The third differs from the second in one thing: whether a mutant the oracle ran and accepted has
 * to have been witnessed before it refuses. It is re-derived from what each row recorded about its
 * own mutants rather than from a second pass, so both answers come off the same evidence.
 */
function regime(label, which) {
  const corners = rows.map((row) => ({ corner: regimes.get(row)[which] }));
  const tally = tallyFalseGreens(corners);
  const kept = corners.filter((one) => isCertified(one.corner)).length;
  const rate = wilsonInterval(kept, rows.length);
  console.log(
    `  ${label.padEnd(22)} certified ${String(kept).padStart(2)} of ${rows.length} ` +
      `(${percent(rate.point)} [${percent(rate.lower)}, ${percent(rate.upper)}]), ` +
      `false green(s) ${tally.falseGreens}: ${percent(tally.point)} ` +
      `[${percent(tally.lower)}, ${percent(tally.upper)}]`,
  );
}

console.log(`\n=== certify rate and false-green rate, all three regimes ===`);
regime("report-only", "reportOnly");
regime("witness required", "blocking");
regime("witness recorded", "witnessRecorded");

// Which rows the two blocking regimes disagree about, named rather than left to the difference
// between two counts. That set is the whole of what requiring a witness costs or buys.
const disputed = rows.filter(
  (row) => regimes.get(row).blocking !== regimes.get(row).witnessRecorded,
);
console.log(
  disputed.length === 0
    ? "\nthe two blocking regimes agree on every row, so requiring a witness changes nothing here"
    : `\nthe two blocking regimes disagree on ${disputed.length} row(s), which is the whole of ` +
        "what requiring a witness costs or buys:",
);
for (const row of disputed) {
  const unwitnessed = (row.bondedMutants ?? []).filter((one) => one.witness === "none");
  console.log(
    `  ${named(row).padEnd(24)} witness required -> ${regimes.get(row).blocking}, ` +
      `witness recorded -> ${regimes.get(row).witnessRecorded}`,
  );
  for (const mutant of unwitnessed) {
    console.log(`      ${mutant.id}  no detector witnessed this mutant`);
    console.log(`      - ${mutant.before.trim()}`);
    console.log(`      + ${mutant.after.trim()}`);
  }
}
