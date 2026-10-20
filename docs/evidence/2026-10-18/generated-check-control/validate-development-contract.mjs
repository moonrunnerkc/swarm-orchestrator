#!/usr/bin/env node
/**
 * The development contract's validation before any launch, with no model: each development check
 * and the visible check, run as their commands state them from the repository root, and the
 * project's own suite, on prepared checkouts of five trees. The contract is fit to drive repair
 * only if it tells all five apart as stated:
 *
 * | tree | why it is here | the contract must |
 * | --- | --- | --- |
 * | base | the original defect | fail it |
 * | retained faulty candidate | the injected first candidate | fail it |
 * | 2026-10-17 launch 1's final patch | a deletion-based repair the supplied checks accepted | fail it |
 * | 2026-10-17 launch 2's final patch | the other one | fail it |
 * | upstream fix | a correct implementation | pass it, preserved behaviour and suite included |
 *
 * The two deletion repairs are read from 2026-10-17's launch pack. Nothing here reaches a model.
 * Given `--patch`, it runs the same commands on one delivered patch instead, which no expectation
 * is stated for: what an arm delivered, read by the checks it was given.
 *
 *   node validate-development-contract.mjs --out <file> [--patch <final.patch> --name <label>]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { unpackArchive } from "../../../../scripts/local-campaign/archive.mjs";
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
import { developmentChecks, developmentFiles } from "./development-checks.mjs";

const { values } = parseArgs({
  options: { out: { type: "string" }, patch: { type: "string" }, name: { type: "string" } },
});
if (values.out === undefined) throw new Error("usage: validate-development-contract.mjs --out <file>");
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const evidence = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const pack = await unpackArchive(
  new URL("../../2026-10-17/repair-detection-live/packed-derived/launch-streams", import.meta.url)
    .pathname,
);
const packed = (path) => readFileSync(join(pack.directory, path), "utf8");
const delivered =
  values.patch === undefined
    ? null
    : { name: values.name ?? "delivered", role: "delivered", must: null, patch: readFileSync(values.patch, "utf8") };
const trees = delivered !== null ? [delivered] : [
  { name: "base", role: "original defect", must: "fail", patch: "" },
  {
    name: "retained-faulty",
    role: "injected first candidate",
    must: "fail",
    patch: evidence(
      "2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
    ),
  },
  { name: "deletion-launch-1", role: "deletion-based repair", must: "fail", patch: packed("launch-1/final.patch") },
  { name: "deletion-launch-2", role: "deletion-based repair", must: "fail", patch: packed("launch-2/final.patch") },
  {
    name: "upstream",
    role: "correct implementation",
    must: "pass",
    patch: spawnSync("git", ["diff", "--binary", base, upstream, "--", "src"], {
      cwd: mirrorOf(task.repository),
      encoding: "utf8",
    }).stdout,
  },
];
await pack.dispose();

const files = { [task.visible.path]: task.visible.source, ...developmentFiles(task.taskText) };
const commands = [
  { id: "visible-check", command: task.visible.command },
  ...developmentChecks.map(({ id, command }) => ({ id, command })),
  { id: "project-suite", command: task.projectTest.join(" ") },
];

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "validate-development-"));
const rows = [];
for (const tree of trees) {
  const checkout = join(scratch, tree.name);
  await cloneAtBase(log, task, base, checkout);
  if (tree.patch !== "" && !(await applyPatch(log, checkout, tree.patch)))
    throw new Error(`${tree.name}: the patch does not apply`);
  const prepared = await prepare(log, task, checkout);
  if (!prepared.ok) throw new Error(`${tree.name}: preparation failed: ${prepared.detail}`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true });
    writeFileSync(join(checkout, path), content);
  }
  const results = {};
  for (const { id, command } of commands) {
    const ran = spawnSync("sh", ["-c", command], {
      cwd: checkout,
      env: taskEnvironment(task),
      encoding: "utf8",
      timeout: 300_000,
    });
    results[id] = {
      passed: ran.status === 0,
      exitCode: ran.status,
      stderrTail: (ran.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n"),
    };
  }
  const contractPassed = developmentChecks.every(({ id }) => results[id].passed) && results["visible-check"].passed;
  rows.push({
    tree: tree.name,
    role: tree.role,
    patchDigest: tree.patch === "" ? null : `sha256:${createHashOf(tree.patch)}`,
    must: tree.must,
    contract: contractPassed ? "passes" : "fails",
    met: tree.must === null ? null : (contractPassed ? "pass" : "fail") === tree.must,
    results,
  });
}

function createHashOf(text) {
  return spawnSync("shasum", ["-a", "256"], { input: text, encoding: "utf8" }).stdout.split(" ")[0];
}

const result = {
  schema: "swarm-development-contract-validation.v1",
  kind: "developer-authored checks on an exposed task, validated with no model; engineered coverage, not discovery",
  task: task.id,
  baseCommit: base,
  upstreamCommit: upstream,
  node: process.version,
  checks: commands.map(({ id, command }) => ({ id, command })),
  fileDigests: Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, `sha256:${createHashOf(content)}`]),
  ),
  everyTreeAsStated: delivered === null ? rows.every((row) => row.met) : null,
  rows,
  scratch,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
console.table(
  rows.map((row) => ({
    tree: row.tree,
    must: row.must,
    contract: row.contract,
    met: row.met,
    ...Object.fromEntries(Object.entries(row.results).map(([id, one]) => [id, one.passed ? "pass" : "FAIL"])),
  })),
);
