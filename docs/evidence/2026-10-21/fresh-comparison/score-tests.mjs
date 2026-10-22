#!/usr/bin/env node
/**
 * The regression tests an exact patch adds, read with no model: for every test file the patch
 * writes, the tests it declares that the base's version of the file did not (by full title), run
 * on the delivered tree and again over the base's source with the delivered file overlaid. A
 * test added by the patch that passes on the delivered tree and fails over the base's source is
 * one that holds the behaviour the task asked for; one that passes on both holds nothing new. A
 * larger count alone establishes nothing, so both counts are reported, with the titles.
 *
 * Each tree is a fresh checkout of the base with the visible check committed, prepared with the
 * task's own install argv, as the runner's verdicts prepare theirs; the delivered tree has the
 * patch applied. Each file runs alone under the task's hidden argv shape (`node bin/mocha.js
 * <file>`) with mocha's JSON reporter written to a file. Supplemental to the runner's records,
 * which it never rewrites.
 *
 *   node score-tests.mjs --manifest <stage manifest.json> --task <id> --patch <file> --label <name> --out <json>
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { isTestFile, parsePatch } from "../../../../scripts/comparison/change-policy.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    task: { type: "string" },
    patch: { type: "string" },
    label: { type: "string" },
    out: { type: "string" },
  },
});
for (const name of ["manifest", "task", "patch", "label", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
if (task === undefined) throw new Error(`${values.task} is not in the manifest`);
const patch = readFileSync(resolve(values.patch), "utf8");
const log = commandLog(join(comparisonRoot, "blobs"));

const testFiles = parsePatch(patch)
  .filter((file) => file.status !== "deleted" && isTestFile(file.path))
  .map((file) => file.path);

async function tree(label, withPatch) {
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `score-tests-${label}-`));
  const checkout = join(scratch, "checkout");
  await cloneAtBase(log, task, task.baseCommit, checkout);
  await commitVisibleCheck(log, task, checkout);
  if (withPatch && !(await applyPatch(log, checkout, patch)))
    throw new Error("the patch does not apply to the base");
  const prepared = await prepare(log, task, checkout);
  if (!prepared.ok) throw new Error(`the tree does not prepare: ${prepared.failed.join(" ")}`);
  return { scratch, checkout };
}

/** One file under mocha alone, its JSON report read from a file so test output cannot mix in. */
async function runFile(checkout, path) {
  const report = join(checkout, ".score-tests-report.json");
  rmSync(report, { force: true });
  const ran = await log.run(
    ["node", "bin/mocha.js", "--reporter", "json", "--reporter-option", `output=${report}`, path],
    { cwd: checkout, timeoutMs: 600_000, env: taskEnvironment(task) },
  );
  if (!existsSync(report))
    return { exitCode: ran.exitCode, titles: null, failed: null, error: ran.stderr.toString().slice(-2000) };
  const parsed = JSON.parse(readFileSync(report, "utf8"));
  rmSync(report, { force: true });
  return {
    exitCode: ran.exitCode,
    stats: parsed.stats,
    titles: parsed.tests.map((test) => test.fullTitle),
    failed: parsed.failures.map((test) => test.fullTitle),
    pending: parsed.pending.map((test) => test.fullTitle),
  };
}

const delivered = await tree(`${values.label}-delivered`, true);
const base = await tree(`${values.label}-base`, false);
const files = [];
try {
  for (const path of testFiles) {
    const baseVersion = join(base.checkout, path);
    const before = existsSync(baseVersion) ? await runFile(base.checkout, path) : null;
    const onDelivered = await runFile(delivered.checkout, path);
    // The delivered file over the base's source, then the base's own file put back.
    const original = existsSync(baseVersion) ? readFileSync(baseVersion) : null;
    mkdirSync(dirname(baseVersion), { recursive: true });
    writeFileSync(baseVersion, readFileSync(join(delivered.checkout, path)));
    const onBaseSource = await runFile(base.checkout, path);
    if (original === null) rmSync(baseVersion);
    else writeFileSync(baseVersion, original);
    const known = new Set(before?.titles ?? []);
    const added = (onDelivered.titles ?? []).filter((title) => !known.has(title));
    files.push({
      path,
      baseTests: before?.titles?.length ?? 0,
      added: added.map((title) => ({
        title,
        passesDelivered:
          onDelivered.titles?.includes(title) === true && !onDelivered.failed?.includes(title),
        failsOnBaseSource: onBaseSource.failed?.includes(title) === true,
        pendingOnBaseSource: onBaseSource.pending?.includes(title) === true,
      })),
      delivered: { exitCode: onDelivered.exitCode, stats: onDelivered.stats ?? null, failed: onDelivered.failed, error: onDelivered.error },
      overBaseSource: { exitCode: onBaseSource.exitCode, stats: onBaseSource.stats ?? null, failed: onBaseSource.failed, error: onBaseSource.error },
    });
  }
} finally {
  rmSync(delivered.scratch, { recursive: true, force: true });
  rmSync(base.scratch, { recursive: true, force: true });
}
const added = files.flatMap((file) => file.added);
const result = {
  task: task.id,
  label: values.label,
  patchBytes: Buffer.byteLength(patch),
  testFiles,
  addedTests: added.length,
  addedPassingDelivered: added.filter((one) => one.passesDelivered).length,
  addedFailingOnBaseSource: added.filter((one) => one.passesDelivered && one.failsOnBaseSource).length,
  files,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    task: result.task,
    label: result.label,
    testFiles,
    addedTests: result.addedTests,
    addedPassingDelivered: result.addedPassingDelivered,
    addedFailingOnBaseSource: result.addedFailingOnBaseSource,
  }),
);
