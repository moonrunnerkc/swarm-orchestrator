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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  groupByHarness,
  heldBackAgreementRate,
  separateAdversarialRows,
  tallyFalseGreens,
  tallyInadequateOracles,
} from "../dist/eval/false-green-rate.js";
import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";
import { harnessesDifferWhereItMatters } from "../dist/eval/verification-closure.js";

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
  const admitted = runs.filter((one) => viable.has(named(one)));
  // Any row here that was shown its oracle belongs to the other arm whatever file it is in, and
  // is dropped from this one rather than pooled into it.
  const { ordinary } = separateAdversarialRows(admitted);
  return { kept: ordinary, setAside: runs.length - ordinary.length };
}

/**
 * The adversarial arm, read from its own file and reported on its own.
 *
 * Never added to anything above. The model was shown the oracle it would be judged by and asked
 * to satisfy that and leave an adjacent case broken, which is a different sampling process rather
 * than a harder subset of the same one.
 */
function adversarialRows() {
  const path = join(prTaskEvidenceRoot(repositoryRoot), "scored.attack.json");
  if (!existsSync(path)) {
    return [];
  }
  const { runs } = JSON.parse(readFileSync(path, "utf8"));
  return separateAdversarialRows(runs).adversarial;
}

/**
 * Which tool versions judged these rows, and whether that matters.
 *
 * A corpus can span two commits without spanning two tools: a re-judge under one, a handful of
 * later tasks scored under another. Reporting only the newest group said "no rate" over eight rows
 * that happened to be newest while three certified patches sat in the other group. A group with
 * nothing certified contributes no opportunity and can change no rate; two groups both holding
 * certified patches is a rate assembled across tool versions, and that is the case worth stopping
 * for.
 */
function reportHarnessSplit(rows) {
  const groups = groupByHarness(rows);
  if (groups.length <= 1) {
    return;
  }
  console.log(`recorded across ${groups.length} harness commits:`);
  for (const group of groups) {
    console.log(
      `  ${group.harness.slice(0, 9)}  ${group.rows.length} row(s), ` +
        `${group.tally.opportunities} certified, ${group.tally.falseGreens} false green(s)`,
    );
  }
  const withOpportunities = groups.filter((one) => one.tally.opportunities > 0);
  if (withOpportunities.length <= 1) {
    console.log(
      "  only one holds a certified patch, so the others contribute no opportunity and the " +
        "rate above is that group's",
    );
    return;
  }
  // Whether those commits are different tools, which is the question, rather than whether they are
  // different commits, which is not. A documentation commit landing between two corpus stages used
  // to make a rate unquotable; what must not be pooled is rows produced by different verification
  // code. Anything git cannot answer about reads as different, because a comparison nobody could
  // make is not a comparison that passed.
  const differ = harnessesDifferWhereItMatters(
    withOpportunities.map((one) => one.harness),
    (from, to) => {
      try {
        return execFileSync("git", ["diff", "--name-only", `${from}..${to}`], {
          cwd: repositoryRoot,
          encoding: "utf8",
        })
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      } catch (cause) {
        // Said out loud rather than swallowed. This returned null once because the callback itself
        // was broken, and a silent null reads exactly like git declining to answer: the guard
        // failed closed, which was right, and reported a reason that was not the reason.
        console.log(`  (could not compare ${from} with ${to}: ${String(cause).slice(0, 120)})`);
        return null;
      }
    },
  );
  console.log(
    differ
      ? "  more than one holds a certified patch and they differ in what computes a verdict, so " +
          "the rate above spans tool versions: re-judge before quoting it"
      : "  more than one holds a certified patch, and nothing a verdict reads differs between " +
          "them, so the rate above is one tool's",
  );
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
    `refused: ${tally.refusedOnReach} on reach, ${tally.refusedOnBond} on the bond, ` +
      `${tally.refusedOnSealed} on the sealed half; ` +
      `${tally.falseReds} false red(s); ${tally.unjudgeable} unjudgeable`,
  );
  // Gate 3c reports the certify rate split by bond state rather than as one word. A patch
  // certified on an oracle that refused every mutant of the change is a stronger claim than one
  // certified on an oracle nothing could be asked of, and a rate that flattens them describes
  // neither.
  console.log(
    `certified by bond state: ${describeBondSplit(tally.certifiedByBond)}` +
      (tally.falseGreens === 0
        ? ""
        : `; false greens by bond state: ${describeBondSplit(tally.falseGreensByBond)}`),
  );
  return tally;
}

/** The bond states in a fixed order, so two runs of this print the same line. */
function describeBondSplit(counts) {
  const order = ["held", "vacuous", "unshown", "not-bonded", "not-recorded"];
  const named = [...order, ...Object.keys(counts).filter((one) => !order.includes(one))]
    .filter((state) => (counts[state] ?? 0) > 0)
    .map((state) => `${counts[state]} ${state}`);
  return named.length === 0 ? "none" : named.join(", ");
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

/**
 * The tasks that were read before the mutation operators were designed, named here because
 * `oracle-bond-operators.md` named them before any of this was measured.
 *
 * `dayjs#3180` and `koa#1946` are the two adversarial false greens, reproduced line by line to
 * establish that the five old operators produced nothing on them. `commander#1671` is the case the
 * original five were chosen knowing about. A result on any of the three shows the check works on a
 * case it was built for and says nothing about whether it generalizes, which is the whole reason
 * gate 3b is not yet a bar.
 */
const readBeforeTheOperatorsWereDesigned = new Set([
  "iamkun/dayjs#3180",
  "koajs/koa#1946",
  "tj/commander.js#1671",
]);

const mined = minedRows();
report(
  "mined from merged pull requests",
  mined.kept,
  mined.setAside === 0
    ? ""
    : `, ${mined.setAside} set aside: the viability filter no longer admits them`,
);
reportAgreement(mined.kept);
reportHarnessSplit(mined.kept);
const hand = handAuthoredRows();
report("hand-authored, two oracles per task", hand);
const both = report("both corpora", [...mined.kept, ...hand]);
// Across both files, not only within the mined one. The published rate is the combined figure, so
// the guard that stops it being assembled out of two tool versions has to read the set it is a
// rate of.
reportHarnessSplit([...mined.kept, ...hand]);

// Gate 3b, the capability question: of the oracles a held-back oracle proved inadequate, how many
// the tool refuses to certify on. The denominator is oracles rather than tasks, so a better model
// does not move it, and it is small because a demonstration of inadequacy is rare. The interval
// says how small.
const inadequate = tallyInadequateOracles([...mined.kept, ...hand]);
console.log("\n=== the oracles a held-back oracle proved inadequate ===");
console.log(
  inadequate.proved === 0
    ? "none proved inadequate, so there is nothing here to refuse on"
    : `${inadequate.refused} of ${inadequate.proved} refused: ${percent(inadequate.point)} ` +
        `95% CI [${percent(inadequate.lower)}, ${percent(inadequate.upper)}]`,
);

// The adversarial arm, last and apart. It is the efficient generator of the denominator gate 3b
// is short of, because proving an oracle inadequate is what it is built to do, and that is
// exactly why its rate is not the tool's rate against a contributor.
const attack = adversarialRows();
if (attack.length > 0) {
  const tally = report("the adversarial arm, shown the oracle it would be judged by", attack);
  reportHarnessSplit(attack);
  // In sample and out of sample, reported apart because a check measured on the cases that shaped
  // it measures the shaping. Three tasks were read before the operators were designed and are
  // named in the pre-registration; every other row is out of sample for them.
  const inSample = attack.filter((one) => readBeforeTheOperatorsWereDesigned.has(named(one)));
  const outOfSample = attack.filter((one) => !readBeforeTheOperatorsWereDesigned.has(named(one)));
  for (const [label, rows] of [
    ["read before the operators were designed", inSample],
    ["out of sample for the operators", outOfSample],
  ]) {
    const split = tallyFalseGreens(rows);
    console.log(
      `  ${label.padEnd(42)} ${rows.length} row(s), ${split.opportunities} certified, ` +
        `${split.falseGreens} false green(s)` +
        (split.point === null
          ? ""
          : `: ${percent(split.point)} [${percent(split.lower)}, ${percent(split.upper)}]`),
    );
  }

  const attackInadequate = tallyInadequateOracles(attack);
  console.log(
    attackInadequate.proved === 0
      ? "no oracle here was proved inadequate"
      : `oracles a held-back oracle proved inadequate: ${attackInadequate.refused} of ` +
          `${attackInadequate.proved} refused: ${percent(attackInadequate.point)} ` +
          `95% CI [${percent(attackInadequate.lower)}, ${percent(attackInadequate.upper)}]`,
  );
  console.log(
    "Not added to anything above, and not comparable with it: a model shown its acceptance test " +
      "is a stronger adversary than a contributor who cannot see it, so this is an upper bound " +
      "on the tool's blindness rather than a rate of anything in the wild.",
  );
  void tally;
}

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
