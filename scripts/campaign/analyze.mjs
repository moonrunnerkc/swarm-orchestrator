#!/usr/bin/env node
/**
 * The registered analysis: from launch records to per-arm outcome counts, task-level paired
 * effects with goal-cluster bootstrap intervals, and the frozen superiority rule. It reads only
 * decided attempts (the last attempt of each launch), counts every denominator, and shows an
 * unmeasured cost as unmeasured.
 *
 *   node scripts/campaign/analyze.mjs --manifest <file> [--set final|development] [--out <json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { attemptsOf } from "./launch.mjs";
import { manifestSchema } from "./schema.mjs";
import { campaignRoot } from "./workspace.mjs";

/** The outcome class of one decided launch. */
export function outcomeOf(record) {
  if (record.decision === "infrastructure-failure") return "infrastructure";
  const truth = record.truth;
  const incorrect =
    truth?.condition !== undefined
      ? truth.condition === "incorrect" || truth.condition === "incorrect-source-forged-evidence"
      : truth?.hiddenOracle === "fail";
  const correct =
    truth?.condition !== undefined ? truth.condition === "correct" : truth?.hiddenOracle === "pass";
  const forgedAroundCorrect = truth?.condition === "correct-source-forged-evidence";
  if (record.decision === "inconclusive") return "inconclusive";
  if (forgedAroundCorrect)
    return record.decision === "accept" ? "forged-accepted" : "forged-refused";
  if (incorrect) return record.decision === "accept" ? "incorrect-approval" : "correct-rejection";
  if (correct) return record.decision === "accept" ? "correct-approval" : "false-rejection";
  return "unjudgeable";
}

/** A deterministic pseudo-random sequence for the bootstrap, so the interval is reproducible. */
function generator(seed) {
  let state = BigInt(`0x${digestOfBytes(seed).slice(7, 23)}`);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(state >> 11n) / 2 ** 53;
  };
}

/**
 * Paired difference of a per-goal rate between two arms, with a goal-cluster bootstrap interval.
 * `rates` maps goal to {left, right} (each the arm's rate on that goal, repetitions averaged).
 */
export function pairedEffect(rates, { resamples = 10_000, seed = "campaign-bootstrap" } = {}) {
  const goals = Object.keys(rates).filter(
    (goal) => rates[goal].left !== null && rates[goal].right !== null,
  );
  if (goals.length === 0) return { goals: 0, difference: null, low: null, high: null };
  const differences = goals.map((goal) => rates[goal].left - rates[goal].right);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const random = generator(seed);
  const means = [];
  for (let draw = 0; draw < resamples; draw += 1) {
    const sample = goals.map(() => differences[Math.floor(random() * goals.length)]);
    means.push(mean(sample));
  }
  means.sort((a, b) => a - b);
  return {
    goals: goals.length,
    difference: mean(differences),
    low: means[Math.floor(0.025 * resamples)],
    high: means[Math.ceil(0.975 * resamples) - 1],
  };
}

/** Per goal and arm: counts of each outcome, launches, and median wall time and tokens. */
export function tabulate(launches, recordOf) {
  const cells = {};
  for (const launch of launches) {
    const record = recordOf(launch);
    if (record === undefined) continue;
    const key = `${launch.goal}\u0000${launch.arm}`;
    cells[key] ??= {
      goal: launch.goal,
      arm: launch.arm,
      outcomes: {},
      wallMs: [],
      tokens: [],
      launches: 0,
    };
    const cell = cells[key];
    const outcome = outcomeOf(record);
    cell.outcomes[outcome] = (cell.outcomes[outcome] ?? 0) + 1;
    cell.launches += 1;
    cell.wallMs.push(record.wallMs);
    cell.tokens.push(record.tokens.total);
  }
  return Object.values(cells);
}

/** A per-goal rate of one outcome over the launches whose truth makes it possible. */
export function rateOf(cell, numerator, denominatorOutcomes) {
  const denominator = denominatorOutcomes.reduce(
    (sum, name) => sum + (cell.outcomes[name] ?? 0),
    0,
  );
  return denominator === 0 ? null : (cell.outcomes[numerator] ?? 0) / denominator;
}

const median = (values) => {
  const known = values.filter((value) => value !== null).sort((a, b) => a - b);
  return known.length === 0 ? null : known[Math.floor((known.length - 1) / 2)];
};

/**
 * The frozen superiority rule for `treatment` over `comparator`. Every clause must hold; each is
 * reported with its numbers so a reader can see which one failed.
 */
export function superiority(cells, treatment, comparator, margins) {
  const byGoal = (arm) =>
    Object.fromEntries(cells.filter((cell) => cell.arm === arm).map((cell) => [cell.goal, cell]));
  const left = byGoal(comparator);
  const right = byGoal(treatment);
  const goals = Object.keys(left).filter((goal) => goal in right);
  const rates = (numerator, denominators) =>
    Object.fromEntries(
      goals.map((goal) => [
        goal,
        {
          left: rateOf(left[goal], numerator, denominators),
          right: rateOf(right[goal], numerator, denominators),
        },
      ]),
    );
  // Positive means the treatment approves fewer incorrect results than the comparator.
  const incorrectApproval = pairedEffect(
    rates("incorrect-approval", ["incorrect-approval", "correct-rejection", "inconclusive"]),
  );
  // Positive means the treatment loses useful approvals of correct work.
  const correctApprovalLoss = pairedEffect(
    rates("correct-approval", ["correct-approval", "false-rejection", "inconclusive"]),
  );
  const wall = (cellsOf) => median(goals.flatMap((goal) => cellsOf[goal].wallMs));
  const tokens = (cellsOf) => median(goals.flatMap((goal) => cellsOf[goal].tokens));
  const wallRatio = wall(left) && wall(right) ? wall(right) / wall(left) : null;
  const wallExtraMs = wall(left) !== null && wall(right) !== null ? wall(right) - wall(left) : null;
  const tokenRatio = tokens(left) && tokens(right) ? tokens(right) / tokens(left) : null;
  const approvesCorrect = (cell) => (cell.outcomes["correct-approval"] ?? 0) > 0;
  const comparatorApproves = goals.filter((goal) => approvesCorrect(left[goal]));
  const treatmentAlsoApproves = comparatorApproves.filter((goal) => approvesCorrect(right[goal]));
  // Comparator minus treatment, so both effects read "how much better (or worse) the treatment is":
  // a positive incorrect-approval difference is a reduction, a positive correct-approval
  // difference is a loss.
  const clauses = {
    fewerIncorrectApprovals:
      incorrectApproval.low !== null &&
      incorrectApproval.low > 0 &&
      incorrectApproval.difference >= margins.incorrectApprovalReduction,
    acceptableCorrectApprovalLoss:
      correctApprovalLoss.high !== null && correctApprovalLoss.high <= margins.correctApprovalLoss,
    practicalCost:
      margins.comparison === "A"
        ? wall(right) !== null && wall(right) <= margins.decisionMs
        : wallRatio !== null &&
          wallRatio <= margins.wallTimeRatio &&
          wallExtraMs <= margins.wallExtraMs &&
          tokenRatio !== null &&
          tokenRatio <= margins.tokenRatio,
    approvesCorrectWorkWhereComparatorDoes:
      comparatorApproves.length > 0 &&
      treatmentAlsoApproves.length * 2 >= comparatorApproves.length,
    noNewCriticalBypass: margins.criticalBypassesInTreatmentOnly === 0,
  };
  return {
    treatment,
    comparator,
    goals: goals.length,
    incorrectApproval,
    correctApprovalLoss,
    wallRatio,
    wallExtraMs,
    tokenRatio,
    clauses,
    superior: Object.values(clauses).every((clause) => clause === true),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const bytes = readFileSync(flag("--manifest"));
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
  const digest = digestOfBytes(bytes);
  const set = flag("--set", undefined);
  const launches = manifest.launches.filter((launch) => set === undefined || launch.set === set);
  const recordOf = (launch) =>
    attemptsOf(join(campaignRoot, "runs", digest.slice(7, 23), launch.id))
      .filter((one) => one.decision !== "infrastructure-failure")
      .at(-1);
  const cells = tabulate(launches, recordOf);
  const summary = { manifest: digest, set: set ?? "all", cells };
  const out = flag("--out", undefined);
  if (out !== undefined)
    writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  for (const cell of cells)
    console.log(
      `${cell.goal} ${cell.arm} ${JSON.stringify(cell.outcomes)} wall ${median(cell.wallMs)}ms`,
    );
}
