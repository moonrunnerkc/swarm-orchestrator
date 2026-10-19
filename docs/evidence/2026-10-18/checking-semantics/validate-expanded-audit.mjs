#!/usr/bin/env node
/**
 * The expanded development audit (expanded-audit.mjs) beside the original development contract
 * (../generated-check-control/development-checks.mjs), run as their commands state them on
 * prepared checkouts of each tree below, with no model. Each tree's result is reported apart, and
 * the frozen evaluator's verdict recorded at the time is carried beside it unchanged: this script
 * never scores with the evaluator and never edits a recorded verdict.
 *
 * | tree | source |
 * | --- | --- |
 * | base | the original defect |
 * | upstream | the upstream fix's change to src |
 * | retained-faulty | the retained faulty candidate (2026-10-16 stage A) |
 * | deletion-launch-1, deletion-launch-2 | 2026-10-17 launches 1 and 2, deletion-based repairs |
 * | space-normalization-launch-4 | 2026-10-18 launch 4's exact final patch |
 * | supplied-repair-launch-1 | 2026-10-18 launch 1's exact final patch (supplied development checks) |
 *
 * Given `--patch`, it runs the same commands on that one delivered patch instead, which is how a
 * live launch's exact final patch is read by the expanded audit beside the frozen evaluator.
 *
 *   node validate-expanded-audit.mjs --out <file> [--patch <final.patch> --name <label>]
 */
import { createHash } from "node:crypto";
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
import { developmentChecks, developmentFiles } from "../generated-check-control/development-checks.mjs";
import { auditChecks, auditFiles } from "./expanded-audit.mjs";

const { values } = parseArgs({
  options: { out: { type: "string" }, patch: { type: "string" }, name: { type: "string" } },
});
if (values.out === undefined) throw new Error("usage: validate-expanded-audit.mjs --out <file>");
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const evidence = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const recorded = (path) => {
  const verdict = JSON.parse(evidence(path));
  return { file: `docs/evidence/${path}`, verdict: verdict.verdict, patchDigest: verdict.patchDigest, basis: verdict.basis };
};
const pack = await unpackArchive(
  new URL("../../2026-10-17/repair-detection-live/packed-derived/launch-streams", import.meta.url).pathname,
);
const packed = (path) => readFileSync(join(pack.directory, path), "utf8");
const listed = [
  { name: "base", patch: "", originalEvaluator: null },
  {
    name: "upstream",
    patch: spawnSync("git", ["diff", "--binary", base, upstream, "--", "src"], {
      cwd: mirrorOf(task.repository),
      encoding: "utf8",
    }).stdout,
    originalEvaluator: { verdict: "reference", note: "the frozen evaluator is built from this change; it was never scored as a delivered patch" },
  },
  {
    name: "retained-faulty",
    patch: evidence("2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch"),
    originalEvaluator: recorded("2026-10-18/generated-check-control/launch-2/final-verdict.json"),
  },
  {
    name: "deletion-launch-1",
    patch: packed("launch-1/final.patch"),
    originalEvaluator: recorded("2026-10-17/repair-detection-live/launch-1/final-verdict.json"),
  },
  {
    name: "deletion-launch-2",
    patch: packed("launch-2/final.patch"),
    originalEvaluator: recorded("2026-10-17/repair-detection-live/launch-2/final-verdict.json"),
  },
  {
    name: "space-normalization-launch-4",
    patch: evidence("2026-10-18/generated-check-control/launch-4/final.patch"),
    originalEvaluator: recorded("2026-10-18/generated-check-control/launch-4/final-verdict.json"),
  },
  {
    name: "supplied-repair-launch-1",
    patch: evidence("2026-10-18/generated-check-control/launch-1/final.patch"),
    originalEvaluator: recorded("2026-10-18/generated-check-control/launch-1/final-verdict.json"),
  },
];
await pack.dispose();
const trees =
  values.patch === undefined
    ? listed
    : [{ name: values.name ?? "delivered", patch: readFileSync(values.patch, "utf8"), originalEvaluator: null }];

const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const files = { [task.visible.path]: task.visible.source, ...developmentFiles(task.taskText), ...auditFiles() };
const commands = [
  { id: "visible-check", group: "original development contract", command: task.visible.command },
  ...developmentChecks.map(({ id, command }) => ({ id, group: "original development contract", command })),
  ...auditChecks.map(({ id, kind, command }) => ({ id, group: `expanded audit (${kind})`, command })),
  { id: "project-suite", group: "project", command: task.projectTest.join(" ") },
];

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "expanded-audit-"));
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
      stdoutTail: (ran.stdout ?? "").split("\n").filter(Boolean).slice(-3).join("\n"),
      stderrTail: (ran.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n"),
    };
  }
  rows.push({
    tree: tree.name,
    patchDigest: tree.patch === "" ? null : digest(tree.patch),
    originalEvaluator: tree.originalEvaluator,
    originalDevelopmentContract:
      ["visible-check", ...developmentChecks.map(({ id }) => id)].every((id) => results[id].passed) ? "passes" : "fails",
    customExtension: results["custom-extension"].passed ? "passes" : "fails",
    relationBound: results["relation-bound"].passed ? "relation holds" : "relation breaks",
    projectSuite: results["project-suite"].passed ? "passes" : "fails",
    results,
  });
}

const result = {
  schema: "swarm-expanded-audit-validation.v1",
  kind: "developer-authored audit on an exposed task, validated with no model; exposed development material, not unseen evaluation",
  product: spawnSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../../../../", import.meta.url).pathname, encoding: "utf8" }).stdout.trim(),
  task: task.id,
  baseCommit: base,
  upstreamCommit: upstream,
  node: process.version,
  checks: commands,
  fileDigests: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, digest(content)])),
  rows,
  scratch,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
console.table(
  rows.map((row) => ({
    tree: row.tree,
    evaluator: row.originalEvaluator?.verdict ?? "-",
    devContract: row.originalDevelopmentContract,
    customExt: row.customExtension,
    relationBound: row.relationBound,
    suite: row.projectSuite,
  })),
);
