#!/usr/bin/env node
/**
 * The evaluator's validation of the supplied counterexample before any launch, with no model: the
 * check runs, exactly as the contract states its command, on prepared checkouts of the unchanged
 * base, the base with the retained faulty patch, and the upstream fix. It must fail on the first
 * two and pass on the third, or it is not the counterexample it is said to be.
 *
 *   node validate-counterexample.mjs --out <file>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  applyPatch,
  cloneAtBase,
  comparisonRoot,
  mirrorOf,
  prepare,
  resolveFull,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { counterexamplePath, counterexampleSource } from "./counterexample.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: validate-counterexample.mjs --out <file>");
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const faulty = readFileSync(
  new URL(
    "../../2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
    import.meta.url,
  ),
  "utf8",
);
const upstreamPatch = spawnSync("git", ["diff", base, upstream, "--", "src"], {
  cwd: mirrorOf(task.repository),
  encoding: "utf8",
}).stdout;

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "counterexample-"));
const results = [];
for (const [name, patch, expected] of [
  ["base", "", "fails"],
  ["retained faulty patch", faulty, "fails"],
  ["upstream fix", upstreamPatch, "passes"],
]) {
  const directory = join(scratch, name.replace(/\W+/g, "-"));
  await cloneAtBase(log, task, base, directory);
  if (!(await applyPatch(log, directory, patch))) throw new Error(`${name} does not apply`);
  const prepared = await prepare(log, task, directory);
  if (!prepared.ok) throw new Error(`${name} does not prepare: ${prepared.detail}`);
  mkdirSync(dirname(join(directory, counterexamplePath)), { recursive: true });
  writeFileSync(join(directory, counterexamplePath), counterexampleSource);
  const ran = spawnSync("sh", ["-c", `npm run build && node ${counterexamplePath}`], {
    cwd: directory,
    env: taskEnvironment(task),
    encoding: "utf8",
    timeout: 300_000,
  });
  const observed = ran.status === 0 ? "passes" : "fails";
  results.push({
    checkout: name,
    expected,
    observed,
    exitCode: ran.status,
    // The assertion that refused it, or the pass line.
    excerpt: `${ran.stdout}\n${ran.stderr}`
      .split("\n")
      .filter((line) => /assert|Error|passed|!==|expected|actual/i.test(line))
      .slice(0, 8),
  });
}
const valid = results.every((one) => one.observed === one.expected);
const record = {
  schema: "swarm-supplied-counterexample-validation.v1",
  task: task.id,
  base,
  upstream,
  check: { path: counterexamplePath, command: `npm run build && node ${counterexamplePath}` },
  results,
  valid,
};
writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
process.exit(valid ? 0 : 1);
