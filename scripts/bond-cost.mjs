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
import { existsSync, readFileSync } from "node:fs";
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

/**
 * The adversarial arm, read for the audit and never for a rate.
 *
 * Its rows must not reach any number above: a model shown the oracle it will be judged by is a
 * different sampling process, which is why `separateAdversarialRows` exists. What the audit needs
 * is every refusal the bond produced anywhere, because "zero false refusals" is a claim about the
 * check rather than about one corpus, and a claim resting on a query somebody typed once is the
 * shape this project refuses.
 */
function adversarialRowsForTheAuditOnly() {
  const path = join(prTaskEvidenceRoot(repositoryRoot), "scored.attack.json");
  if (!existsSync(path)) {
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8")).runs;
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

  // Both blocking regimes are re-derived from the row's own mutants rather than from the bond it
  // recorded, and that is not a nicety. Reading the recorded bond makes a column mean whichever
  // regime happened to produce the rows: once the relaxed one shipped, the "witness required"
  // column started reporting the relaxed answer and the table showed two identical columns, which
  // is the failure this file's header warns about one layer up.
  //
  // What each regime needs of a mutant, read the same way whichever regime wrote the row. A
  // mutant the oracle accepted on a line it demonstrably ran is what `vacuous` has always meant,
  // and a relaxed record says so with the verdict while a strict one says so with any witness
  // other than `not-adjudicated`, since only such a mutant is ever adjudicated.
  const mutants = row.bondedMutants ?? [];
  const acceptedOnALineItRan = (one) =>
    one.verdict === "vacuous" ||
    (one.witness !== undefined && one.witness !== "not-adjudicated");
  const witnessed = (one) =>
    one.witness === "coverage" || one.witness === "repository-suite";

  const vacuousWithAWitness = mutants.some(
    (one) => acceptedOnALineItRan(one) && witnessed(one),
  );
  const vacuousWithoutOne = mutants.some(acceptedOnALineItRan);

  const under = (vacuous) =>
    classifyAgainstHeldBackOracle({
      ...shared,
      verifiedWithFirstOracle: withoutBond && !vacuous,
      oracleBond: vacuous ? "vacuous" : row.oracleBond,
    });

  return {
    reportOnly: classifyAgainstHeldBackOracle({
      ...shared,
      verifiedWithFirstOracle: withoutBond,
    }),
    blocking: under(vacuousWithAWitness),
    witnessRecorded: under(vacuousWithoutOne),
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

// Which refusals the audit actually has to read, which is the whole of what recording the witness
// instead of requiring it costs. A refusal a detector witnessed rests on an instrument; one
// carrying `none` rests on the operator alone and is the only shape that can be a false red.
const unwitnessed = vacuous.filter((row) =>
  (row.bondedMutants ?? []).some((one) => one.verdict === "vacuous" && one.witness === "none"),
);
console.log(`\n=== the refusals the audit has to read: ${unwitnessed.length} ===`);
for (const row of unwitnessed) {
  const gap = (row.bondedMutants ?? []).find(
    (one) => one.verdict === "vacuous" && one.witness === "none",
  );
  console.log(
    `  ${named(row)}  ${gap.id}  held-back oracle: ${row.heldBackOracle ?? "not recorded"}`,
  );
  console.log(`      - ${gap.before.trim()}`);
  console.log(`      + ${gap.after.trim()}`);
}
console.log(
  unwitnessed.length === 0
    ? "  nothing to read: every refusal rests on a detector"
    : "  a refusal of a patch a held-back oracle also rejects is not a false red whatever a " +
        "detector saw; the ones to read are those a held-back oracle accepts",
);

/**
 * Every refusal the bond produced anywhere, and whether it cost a certification.
 *
 * A vacuous bond on a row already refused for its regression or its reach adds a second reason and
 * costs nothing, which is a different thing from a refusal the bond alone produced. The claim that
 * matters is about the second kind, and it is one line per row rather than a sentence.
 */
console.log("\n=== every vacuous bond, and what else was already refusing that row ===");
const audited = [
  ...rows.map((row) => ({ row, arm: "ordinary" })),
  ...adversarialRowsForTheAuditOnly().map((row) => ({ row, arm: "adversarial" })),
].filter(({ row }) => row.oracleBond === "vacuous");
let boundAlone = 0;
for (const { row, arm } of audited) {
  const gap = (row.bondedMutants ?? []).find((one) => one.verdict === "vacuous");
  const alsoRefusing = [
    row.regression !== "pass" ? `regression ${row.regression}` : null,
    row.oracleReach === "unreached" ? "reach unreached" : null,
    (row.sealedOracle ?? row.firstOracle) !== "accepted" ? "the sealed half" : null,
  ].filter((one) => one !== null);
  if (alsoRefusing.length === 0) {
    boundAlone += 1;
  }
  console.log(
    `  ${arm.padEnd(12)} ${named(row).padEnd(24)} witness ${(gap?.witness ?? "not-recorded").padEnd(17)} ` +
      `held-back ${(row.heldBackOracle ?? "-").padEnd(9)} ` +
      `${alsoRefusing.length === 0 ? "THE BOND ALONE" : `also: ${alsoRefusing.join(", ")}`}`,
  );
}
console.log(
  `  ${audited.length} vacuous bond(s), ${boundAlone} of them the only reason that row was ` +
    "refused. A refusal of a patch a held-back oracle rejects is the check working; one of a " +
    "patch both oracles accept is what a false red would look like.",
);

if (showMutants) {
  console.log(`\n=== every vacuous verdict, for the audit ===`);
  for (const row of vacuous) {
    for (const gap of (row.bondedMutants ?? []).filter((one) => one.verdict === "vacuous")) {
      console.log(
        `  ${named(row)}  ${gap.id}  witness: ${gap.witness ?? "not-recorded"}  ` +
          `held-back: ${(row.heldBackBondedMutants ?? {})[gap.id] ?? "never judged the mutant"}`,
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
