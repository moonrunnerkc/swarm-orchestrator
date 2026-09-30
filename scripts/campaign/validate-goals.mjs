#!/usr/bin/env node
/**
 * Deterministic validation of every goal package, run before the protocol freezes and repeated
 * as a check that nothing drifted. No arm and no model is involved: for the base, the reference
 * and every condition the hidden oracle, the visible checks (as the plain-CI translation runs
 * them) and the project's own test command are executed in the goal's prepared environment with
 * the network off, and each goal's claims are compared with what executed.
 *
 *   node scripts/campaign/validate-goals.mjs --out <file.json> [--goal <id>]... [--set final|development]
 *
 * Claims checked: the reference passes the hidden oracle and the visible checks; the base fails
 * the hidden oracle unless the goal is a refactor; every condition's source reads as its label
 * says (sourceCorrect true exactly when the oracle passes). The output is rewritten only by a
 * complete run; per-goal results are kept under the campaign cache as they finish.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeAcceptanceMaterial } from "./acceptance-material.mjs";
import { commandLog } from "./exec.mjs";
import { loadGoalPackage } from "./goal-package.mjs";
import { judgeHiddenIn, sealedRoot } from "./truth.mjs";
import {
  applyPatch,
  campaignRoot,
  cloneAtBase,
  containerArgv,
  imageFor,
  prepareDependencies,
  touchesInstallInputs,
} from "./workspace.mjs";

const goalsRoot = join(campaignRoot, "goals");

/** One tree's readings: the hidden oracle, the visible checks and the project's test command. */
async function readTree(log, loaded, prepared, patch, label, scratch) {
  const { goal, contract } = loaded;
  const copy = (name) => {
    const target = join(scratch, `${label}-${name}`);
    // A copy-on-write clone on APFS: a prepared dependency tree per reading costs no disk.
    execFileSync("cp", ["-Rc", prepared, target]);
    return target;
  };
  const trees = { hidden: copy("hidden"), visible: copy("visible"), project: copy("project") };
  for (const tree of Object.values(trees)) {
    if (!(await applyPatch(log, tree, patch, `${label}-patch`))) return { applied: false };
    if (touchesInstallInputs(patch)) {
      const reinstalled = await prepareDependencies(log, goal, tree);
      if (!reinstalled.ok) return { applied: true, install: "failed" };
    }
  }
  const hidden = await judgeHiddenIn(log, goal, trees.hidden);
  mkdirSync(join(trees.visible, ".campaign"), { recursive: true });
  writeAcceptanceMaterial(trees.visible, contract);
  const visible = await log.run(
    containerArgv({
      image: imageFor(goal, contract),
      directory: trees.visible,
      argv: [
        "node",
        ".campaign/visible-runner.mjs",
        ".campaign/contract.json",
        "--json",
        ".campaign/readings.json",
      ],
      network: false,
    }),
    { cwd: trees.visible, timeoutMs: 1_800_000 },
  );
  const readings = existsSync(join(trees.visible, ".campaign/readings.json"))
    ? JSON.parse(readFileSync(join(trees.visible, ".campaign/readings.json"), "utf8"))
    : [];
  const project = await log.run(
    containerArgv({
      image: imageFor(goal, contract),
      directory: trees.project,
      argv: goal.projectTest,
      network: false,
    }),
    { cwd: trees.project, timeoutMs: 1_800_000 },
  );
  for (const tree of Object.values(trees)) rmSync(tree, { recursive: true, force: true });
  return {
    applied: true,
    hidden: hidden.hidden,
    hiddenBasis: hidden.basis,
    visible: visible.exitCode === 0 ? "pass" : "fail",
    visibleChecks: readings.map((reading) => ({ id: reading.id, passed: reading.passed })),
    projectTest: project.exitCode === 0 ? "pass" : "fail",
  };
}

export function claimsOf(goal, rows) {
  const problems = [];
  const reference = rows.find((row) => row.tree === "reference");
  if (reference?.hidden !== "pass") problems.push("the reference does not pass the hidden oracle");
  if (reference?.visible !== "pass")
    problems.push("the reference does not pass the visible checks");
  const base = rows.find((row) => row.tree === "base");
  if (goal.workType !== "refactor" && base?.hidden !== "fail")
    problems.push("the base does not fail the hidden oracle");
  for (const condition of goal.conditions) {
    const row = rows.find((one) => one.tree === `condition:${condition.id}`);
    const expected = condition.sourceCorrect ? "pass" : "fail";
    if (row?.hidden !== expected)
      problems.push(
        `condition ${condition.id} claims ${condition.truth} but the hidden oracle read ${row?.hidden ?? "nothing"}`,
      );
  }
  return problems;
}

async function validateGoal(id) {
  const loaded = loadGoalPackage(join(goalsRoot, id), { sealedRoot });
  const { goal, patches } = loaded;
  const scratch = join(campaignRoot, "work", `validate-${id}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const log = commandLog(join(campaignRoot, "blobs"));
  const prepared = join(scratch, "prepared");
  const started = Date.now();
  await cloneAtBase(log, goal, prepared);
  const install = await prepareDependencies(log, goal, prepared);
  if (!install.ok) return { goal: id, installed: false, problems: ["the base install failed"] };
  const rows = [];
  rows.push({ tree: "base", ...(await readTree(log, loaded, prepared, "", "base", scratch)) });
  rows.push({
    tree: "reference",
    ...(await readTree(log, loaded, prepared, patches.get("reference"), "reference", scratch)),
  });
  const seen = new Map();
  for (const condition of goal.conditions) {
    const patch = patches.get(condition.id);
    const reading =
      seen.get(patch) ?? (await readTree(log, loaded, prepared, patch, condition.id, scratch));
    seen.set(patch, reading);
    rows.push({ tree: `condition:${condition.id}`, ...reading });
  }
  rmSync(scratch, { recursive: true, force: true });
  return {
    goal: id,
    set: goal.set,
    workType: goal.workType,
    contractDigest: loaded.contractDigest,
    hiddenDigest: goal.hidden.digest,
    wallMs: Date.now() - started,
    rows,
    problems: claimsOf(goal, rows),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flagValues = (flag) => args.flatMap((arg, at) => (arg === flag ? [args[at + 1]] : []));
  const out = resolve(flagValues("--out")[0] ?? "validation.json");
  const set = flagValues("--set")[0];
  const named = flagValues("--goal");
  const ids = (named.length > 0 ? named : readdirSync(goalsRoot).sort()).filter((id) => {
    if (set === undefined) return true;
    return JSON.parse(readFileSync(join(goalsRoot, id, "goal.json"), "utf8")).set === set;
  });
  const perGoal = join(campaignRoot, "validation");
  mkdirSync(perGoal, { recursive: true });
  const results = [];
  for (const id of ids) {
    const result = await validateGoal(id);
    writeFileSync(join(perGoal, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${id}: ${result.problems.length === 0 ? "ok" : result.problems.join("; ")}`);
    results.push(result);
  }
  writeFileSync(
    out,
    `${JSON.stringify({ schema: "swarm-campaign.validation.v1", goals: results }, null, 2)}\n`,
  );
  process.exit(results.every((result) => result.problems.length === 0) ? 0 : 1);
}
