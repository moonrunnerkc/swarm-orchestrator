#!/usr/bin/env node
/**
 * The deadline overshoot number gate 9 asks for, measured rather than typed.
 *
 * The cancellation tree that bounds a run has existed for a while and had no number against it,
 * which is a mechanism rather than a measurement. This runs a real budget against a child that
 * outlives it and times the whole tree: the deadline timer, the abort, the process group being
 * signalled, and the run settling.
 *
 *   node scripts/deadline-overshoot.mjs [--repeats <n>]
 *
 * The same definition the test holds the bound against, so the row and the test cannot drift.
 */
import { measureDeadlineOvershoot, worstOvershoot } from "../dist/eval/deadline-overshoot.js";

const argv = process.argv.slice(2);
const at = argv.indexOf("--repeats");
const repeats = at === -1 ? 5 : Number(argv[at + 1]);
const budgetsMs = [250, 500, 1000, 2000];

const samples = await measureDeadlineOvershoot({ budgetsMs, repeats });
const worst = worstOvershoot(samples);

console.log(`${samples.length} sample(s) over budgets of ${budgetsMs.join("ms, ")}ms\n`);
for (const budgetMs of budgetsMs) {
  const forBudget = samples.filter((one) => one.budgetMs === budgetMs);
  const overshoots = forBudget.map((one) => one.overshootMs);
  const highest = Math.max(...overshoots);
  console.log(
    `${String(budgetMs).padStart(5)}ms budget  overshoot ${overshoots.join(", ").padEnd(20)} ` +
      `worst ${highest}ms, ${((highest / budgetMs) * 100).toFixed(2)}%`,
  );
}

if (worst === null) {
  console.log("\nnothing measured, so there is no overshoot here rather than an overshoot of zero");
  process.exit(1);
}
console.log(
  `\nworst overshoot ${worst.overshootMs}ms on a ${worst.budgetMs}ms budget: ` +
    `${(worst.fraction * 100).toFixed(2)}%, against the 2% gate 9 asks for`,
);
// The percentage is a function of the budget as well as of the tool, so the floor is stated with
// it: an absolute overshoot this size is under 2% of any budget above this.
console.log(
  `a ${worst.overshootMs}ms overshoot is under 2% of any budget above ` +
    `${Math.ceil(worst.overshootMs / 0.02)}ms, which is what the percentage above depends on`,
);
