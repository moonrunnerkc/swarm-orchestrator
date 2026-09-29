#!/usr/bin/env node
/**
 * Check one goal package against the campaign's rules, reading its sealed oracle.
 *
 *   node scripts/campaign/check-goal.mjs <goal directory> [--sealed <root>] [--seal]
 *
 * `--seal` writes the sealed oracle's digest into goal.json first; use it only while authoring,
 * before the protocol freezes the goal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { GoalPackageError, loadGoalPackage, sealedDigest } from "./goal-package.mjs";

const args = process.argv.slice(2);
const directory = args.find(
  (arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--sealed",
);
if (directory === undefined) {
  console.error("usage: check-goal.mjs <goal directory> [--sealed <root>] [--seal]");
  process.exit(2);
}
const sealedAt = args.indexOf("--sealed");
const sealedRoot = resolve(
  sealedAt === -1 ? join(homedir(), ".cache/swarm-campaign/sealed") : args[sealedAt + 1],
);
const goalDirectory = resolve(directory);
if (args.includes("--seal")) {
  const goalPath = join(goalDirectory, "goal.json");
  const goal = JSON.parse(readFileSync(goalPath, "utf8"));
  const { digest } = sealedDigest(join(sealedRoot, goal.id ?? basename(goalDirectory)));
  goal.hidden = { digest };
  writeFileSync(goalPath, `${JSON.stringify(goal, null, 2)}\n`);
  console.log(`sealed ${digest}`);
}
try {
  const loaded = loadGoalPackage(goalDirectory, { sealedRoot });
  for (const condition of loaded.goal.conditions) {
    const touched = loaded.immutableTouchedBy(condition.id);
    if (touched.length > 0)
      console.log(`note: ${condition.id} touches immutable paths ${touched.join(", ")}`);
  }
  console.log(
    `ok ${loaded.goal.id} contract ${loaded.contractDigest} hidden ${loaded.goal.hidden.digest}`,
  );
} catch (cause) {
  if (!(cause instanceof GoalPackageError)) throw cause;
  console.error(`not ok: ${cause.message}`);
  process.exit(1);
}
