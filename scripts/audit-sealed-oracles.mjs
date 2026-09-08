#!/usr/bin/env node
/**
 * Checks that each task's sealed half actually fails on the base source.
 *
 * A sealed half that passes on the base accepts a patch that changes nothing, so the tool's
 * `task: accepted` establishes nothing and the task is not an opportunity to catch a false green.
 * winston#2181 was published as a false green and withdrawn for exactly this.
 *
 * The viability filter requires the whole added test file to fail on the base. It does not require
 * it of each half, and the halves are what the oracles run.
 *
 *   node scripts/audit-sealed-oracles.mjs [--certified-only]
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { oracleCommand } from "../dist/eval/oracle-filter.js";
import { prTaskEvidenceRoot, prTaskWorkingRoot } from "../dist/eval/pr-task-paths.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;
const workingRoot = prTaskWorkingRoot(homedir());
const taskRoot = prTaskEvidenceRoot(repositoryRoot);
const certifiedOnly = process.argv.includes("--certified-only");

const attempt = async (file, args, options = {}) => {
  try {
    const done = await run(file, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return { code: 0, stdout: done.stdout };
  } catch (cause) {
    return { code: typeof cause.code === "number" ? cause.code : 1, stdout: `${cause.stdout ?? ""}` };
  }
};

const runnerKind = (r) =>
  r.includes("jest") ? "jest" : r.includes("vitest") ? "vitest" : r.includes("mocha") ? "mocha"
  : r.includes("ava") ? "ava" : "node";

const viable = JSON.parse(readFileSync(join(taskRoot, "viable.json"), "utf8")).tasks.filter((t) => t.viable);
const scored = JSON.parse(readFileSync(join(taskRoot, "scored.json"), "utf8")).runs;
const certified = new Set(scored.filter((r) => r.verified).map((r) => `${r.repository}#${r.pull}`));
const wanted = certifiedOnly ? viable.filter((t) => certified.has(`${t.repository}#${t.pull}`)) : viable;

console.log(`auditing ${wanted.length} task(s): does the sealed half fail on the base source?\n`);

const vacuous = [];
for (const task of wanted) {
  const checkout = join(workingRoot, "work", task.repository.replace("/", "__"));
  const stored = join(workingRoot, "oracles",
    `${task.repository.replace("/", "__")}-${task.pull}-${task.testFile.split("/").pop()}`);

  await attempt("git", ["checkout", "--quiet", "--force", "--detach", task.baseCommit], { cwd: checkout });
  await attempt("git", ["clean", "-qfd"], { cwd: checkout });

  const zone = task.timezone === undefined ? {} : { TZ: task.timezone };
  const command = oracleCommand({
    storedTestFile: stored,
    destination: task.testFile,
    runner: runnerKind(task.runner),
    runnerArgv: task.runner.split(" "),
    titles: task.sealedCases,
  });
  const onBase = await attempt("sh", ["-c", command], {
    cwd: checkout,
    timeout: 10 * 60_000,
    env: { ...process.env, ...zone },
  });

  const label = `${task.repository}#${task.pull}`;
  if (onBase.code === 0) {
    vacuous.push(label);
    console.log(`  VACUOUS  ${label.padEnd(40)} sealed half PASSES on base, so it tests nothing`);
  } else {
    console.log(`  ok       ${label.padEnd(40)} sealed half fails on base`);
  }
}

console.log(`\n${vacuous.length} of ${wanted.length} have a vacuous sealed oracle`);
if (vacuous.length > 0) console.log(vacuous.map((v) => `  ${v}`).join("\n"));
