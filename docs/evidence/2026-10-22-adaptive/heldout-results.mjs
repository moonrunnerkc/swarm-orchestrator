/**
 * The held-out block's registered comparison from its records, with no model: complete delivery
 * per launch, product verdict accuracy, and each Swarm arm's pairs against every other arm, under
 * the registered evaluator and again under the audited fastify rule (`evaluator-audit.mjs`), which
 * is reported beside the registered reading and never replaces it.
 *
 * Complete delivery, as registered: the hidden evaluator passes, the visible check and project
 * tests pass, the project lint passes where it passes on the base, and where the task asks for
 * tests the delivered tests include at least one that fails on the base source and passes on the
 * delivered source (`test-sensitivity.mjs`).
 *
 *   node docs/evidence/2026-10-22-adaptive/heldout-results.mjs <heldout directory>
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
const arms = ["swarm", "swarm-control", "swarm-direct", "opencode"];
const tasks = [
  "p-queue-compat-remove-throw-on-timeout",
  "fastify-refactor-kebab-case-file-names",
  "p-limit-bugfix-limit-function-clear-queue",
  "p-limit-feature-reject-on-clear",
];
const asksForTests = (task) => task !== "fastify-refactor-kebab-case-file-names";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const audit = read(join(directory, "audit", "fastify-rule-audit.json"));
const amendedVerdict = (arm) => audit.rows.find((row) => row.subject === `delivered ${arm}`)?.amended.verdict ?? null;

const launches = [];
for (const task of tasks)
  for (const arm of arms) {
    const record = read(join(directory, "records", `${task}.${arm}.json`));
    const sensitivityPath = join(directory, "sensitivity", `${task}.${arm}.json`);
    const sensitive = existsSync(sensitivityPath)
      ? read(sensitivityPath).commands.reduce((total, command) => total + command.sensitive.length, 0)
      : null;
    const scores = record.scores;
    const lintHolds = !scores.static.applicable || scores.static.baseExit !== 0 || scores.static.passed === true;
    const testsHold = !asksForTests(task) || (sensitive ?? 0) > 0;
    const rest = scores.visible.passed && lintHolds && testsHold;
    const hidden = scores.hidden.verdict === "pass";
    const audited = task === "fastify-refactor-kebab-case-file-names" ? amendedVerdict(arm) === "pass" : hidden;
    launches.push({
      task,
      arm,
      outcome: record.outcome,
      complete: hidden && rest,
      completeAudited: audited && rest,
      hidden: scores.hidden.verdict,
      visible: scores.visible.passed,
      lint: scores.static.applicable ? scores.static.passed : "not applicable",
      sensitiveTests: sensitive,
      productAcceptable: record.invocation.productVerdict?.acceptable ?? null,
      claimed: record.invocation.claimedSuccess,
      wallMs: record.invocation.wallMs,
      tokens: record.invocation.tokens,
      unknownCalls: record.invocation.usage?.unknownCalls ?? null,
      patchBytes: record.finalPatchBytes,
    });
  }

const find = (task, arm) => launches.find((launch) => launch.task === task && launch.arm === arm);
const pairs = (key) =>
  ["swarm", "swarm-control", "swarm-direct"].flatMap((left, index, swarms) =>
    arms
      .filter((right) => right !== left && !swarms.slice(0, index).includes(right))
      .map((right) => {
        const tally = { left, right, wins: 0, losses: 0, ties: 0, incomplete: 0, infrastructure: 0, perTask: {} };
        for (const task of tasks) {
          const a = find(task, left);
          const b = find(task, right);
          let result;
          if (a.outcome !== "scored" || b.outcome !== "scored") result = "infrastructure";
          else if (a[key] === b[key]) result = a[key] ? "tie, both complete" : "tie, neither complete";
          else result = a[key] ? "win" : "loss";
          tally.perTask[task] = result;
          if (result === "win") tally.wins += 1;
          else if (result === "loss") tally.losses += 1;
          else if (result === "infrastructure") tally.infrastructure += 1;
          else tally.ties += 1;
        }
        return tally;
      }),
  );

const swarmLaunches = launches.filter((launch) => launch.arm !== "opencode");
const verdicts = {
  launches: swarmLaunches.length,
  correct: swarmLaunches.filter((launch) => launch.productAcceptable === launch.complete).length,
  falseAccepts: swarmLaunches.filter((launch) => launch.productAcceptable && !launch.complete).map((launch) => `${launch.task} ${launch.arm}`),
  falseRefusals: swarmLaunches.filter((launch) => !launch.productAcceptable && launch.complete).map((launch) => `${launch.task} ${launch.arm}`),
};
const claims = {
  opencodeClaimedComplete: launches.filter((launch) => launch.arm === "opencode" && launch.claimed && launch.complete).length,
  opencodeClaimedIncomplete: launches.filter((launch) => launch.arm === "opencode" && launch.claimed && !launch.complete).map((launch) => launch.task),
};
const totals = Object.fromEntries(
  arms.map((arm) => {
    const own = launches.filter((launch) => launch.arm === arm);
    return [
      arm,
      {
        complete: own.filter((launch) => launch.complete).length,
        completeAudited: own.filter((launch) => launch.completeAudited).length,
        wallMs: own.reduce((total, launch) => total + launch.wallMs, 0),
        tokens: own.reduce((total, launch) => total + launch.tokens, 0),
        unknownCalls: own.reduce((total, launch) => total + (launch.unknownCalls ?? 0), 0),
      },
    ];
  }),
);
console.log(JSON.stringify({ launches, totals, verdicts, claims, pairs: pairs("complete"), pairsAudited: pairs("completeAudited") }, null, 2));
