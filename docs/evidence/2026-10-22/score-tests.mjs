#!/usr/bin/env node
/**
 * The regression tests an exact patch adds, read with no model, for the 2026-10-22 tasks: the test
 * files the patch writes are run on the delivered tree and over the base's source with those files
 * overlaid. A patch has meaningful added tests where the files pass on the delivered tree and fail
 * over the base's source, which only a test the base's code does not satisfy can make them do. The
 * runner's own report gives the counts: acorn's runner prints its totals, vitest writes a JSON
 * report with each test's full name, and for vitest the tests the patch added (names the base's
 * version of the file does not have) are named, with which of them fail over the base's source.
 *
 * Each tree is a fresh checkout of the base with the visible check committed, prepared with the
 * task's install argv, as the runner's verdicts prepare theirs. Supplemental to the runner's
 * records, which it never rewrites.
 *
 *   node score-tests.mjs --manifest <stage manifest.json> --task <id> --patch <file> --out <json>
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { isTestFile, parsePatch } from "../../../scripts/comparison/change-policy.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  taskEnvironment,
  workRoot,
} from "../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    task: { type: "string" },
    patch: { type: "string" },
    out: { type: "string" },
  },
});
for (const name of ["manifest", "task", "patch", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
if (task === undefined) throw new Error(`${values.task} is not in the manifest`);
const patch = readFileSync(resolve(values.patch), "utf8");
const log = commandLog(join(comparisonRoot, "blobs"));
const vitest = task.projectTest.join(" ").includes("test:vi");

const testFiles = parsePatch(patch)
  .filter((file) => file.status !== "deleted" && isTestFile(file.path))
  .map((file) => file.path);

async function tree(label, withPatch) {
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `score-tests-${label}-`));
  const checkout = join(scratch, "checkout");
  await cloneAtBase(log, task, task.baseCommit, checkout);
  const base = await commitVisibleCheck(log, task, checkout);
  if (withPatch) await applyPatch(log, checkout, patch);
  const prepared = await prepare(log, task, checkout);
  if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
  return { scratch, checkout, base };
}

/** The test files run in one tree by the task's runner, with the runner's own counts. */
async function run(checkout, scratch) {
  const report = join(scratch, "vitest.json");
  const argv = vitest
    ? ["npx", "vitest", "run", ...testFiles, "--reporter=json", `--outputFile=${report}`]
    : task.projectTest;
  const ran = await log.run(argv, {
    cwd: checkout,
    timeoutMs: 600_000,
    env: { ...process.env, ...taskEnvironment(task), CI: "true" },
  });
  const text = `${ran.stdout}\n${ran.stderr}`;
  const reading = { argv, exitCode: ran.exitCode, outputTail: text.slice(-1500) };
  if (vitest && existsSync(report)) {
    const results = JSON.parse(readFileSync(report, "utf8")).testResults.flatMap((file) =>
      file.assertionResults.map((one) => ({
        file: file.name.replace(`${checkout}/`, ""),
        name: one.fullName,
        status: one.status,
      })),
    );
    return { ...reading, tests: results };
  }
  const totals = /Total: (\d+) tests run in \d+ms; (?:all passed|(\d+) failures)/.exec(text);
  return {
    ...reading,
    totals: totals === null ? null : { run: Number(totals[1]), failures: Number(totals[2] ?? 0) },
  };
}

const record = { task: task.id, patch: values.patch, testFiles };
if (testFiles.length === 0) {
  record.verdict = "no test file written";
} else {
  const delivered = await tree("delivered", true);
  record.delivered = await run(delivered.checkout, delivered.scratch);
  const overBase = await tree("over-base", false);
  for (const path of testFiles) {
    const file = join(delivered.checkout, path);
    if (existsSync(file)) {
      mkdirSync(join(overBase.checkout, path, ".."), { recursive: true });
      writeFileSync(join(overBase.checkout, path), readFileSync(file));
    }
  }
  record.overBase = await run(overBase.checkout, overBase.scratch);
  if (vitest) {
    const atBase = await tree("base", false);
    const baseNames = new Set(
      (await run(atBase.checkout, atBase.scratch)).tests?.map((one) => `${one.file} ${one.name}`) ?? [],
    );
    const added = (record.delivered.tests ?? []).filter((one) => !baseNames.has(`${one.file} ${one.name}`));
    const overBaseStatus = new Map(
      (record.overBase.tests ?? []).map((one) => [`${one.file} ${one.name}`, one.status]),
    );
    record.added = added.map((one) => ({
      ...one,
      overBase: overBaseStatus.get(`${one.file} ${one.name}`) ?? "absent",
    }));
    record.meaningful = record.added.filter(
      (one) => one.status === "passed" && one.overBase === "failed",
    ).length;
    rmSync(atBase.scratch, { recursive: true, force: true });
  } else {
    record.meaningful =
      record.delivered.exitCode === 0 && (record.overBase.totals?.failures ?? 0) > 0
        ? record.overBase.totals.failures
        : 0;
  }
  record.verdict =
    record.delivered.exitCode === 0 && record.overBase.exitCode !== 0 && record.meaningful > 0
      ? "meaningful regression tests: they pass on the delivered tree and fail over the base's source"
      : record.delivered.exitCode !== 0
        ? "the delivered test files do not pass on the delivered tree"
        : "no added test fails over the base's source";
  rmSync(delivered.scratch, { recursive: true, force: true });
  rmSync(overBase.scratch, { recursive: true, force: true });
}
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ task: record.task, testFiles, meaningful: record.meaningful ?? 0, verdict: record.verdict }));
