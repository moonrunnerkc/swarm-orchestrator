#!/usr/bin/env node
/**
 * The evaluator's final verdict on one launch's exact final patch, outside the product: the
 * frozen oracle of the task (its hidden tests and project tests) plus the expanded audit of the
 * task's rule, through `hiddenVerdict`, on a fresh checkout of the original base. Nothing here
 * reaches a model or a launch's workspace.
 *
 *   node score.mjs --task mime|tar --patch <final.patch> --out <final-verdict.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { digestOf } from "../../../../scripts/comparison/arms.mjs";
import { hiddenVerdict } from "../../../../scripts/comparison/checks.mjs";
import { comparisonRoot, resolveFull } from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";

const { values } = parseArgs({
  options: { task: { type: "string" }, patch: { type: "string" }, out: { type: "string" } },
});
const ids = { mime: "mime-bugfix-gettype-line-terminators", tar: "tar-bugfix-negative-size" };
const task = tasks.find((one) => one.id === ids[values.task ?? ""]);
if (task === undefined || values.patch === undefined || values.out === undefined)
  throw new Error("usage: score.mjs --task mime|tar --patch <file> --out <file>");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const patch = readFileSync(values.patch, "utf8");
const started = Date.now();
const verdict = await hiddenVerdict(log, task, base, upstream, patch);
const result = {
  schema: "swarm-final-patch-verdict.v1",
  task: task.id,
  patchDigest: digestOf(patch),
  verdict: verdict.verdict,
  basis: verdict.basis,
  detail: (verdict.detail ?? "").slice(-1500),
  evaluationMs: Date.now() - started,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
