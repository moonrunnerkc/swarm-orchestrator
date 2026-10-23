/**
 * One patch read by the study runner's own scorers, with no model: the visible check and project
 * tests, the hidden evaluator, and lint on the base and the tree. Used for rebuilt initial
 * candidates, so a repair's gain or damage is read with the same instruments as the delivered tree.
 *
 *   node score-candidate.mjs --manifest <manifest.json> --task <id> --patch <file> --out <json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { hiddenVerdict, staticVerdict, visibleVerdict } from "../../../scripts/comparison/checks.mjs";

const { values } = parseArgs({ options: Object.fromEntries(["manifest", "task", "patch", "out"].map((name) => [name, { type: "string" }])) });
if (existsSync(values.out)) throw new Error(`${values.out} exists; scores are never overwritten`);
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
const patch = readFileSync(values.patch, "utf8");
const log = commandLog(join(values.out, "..", "candidate-blobs"));
const visible = await visibleVerdict(log, task, task.baseCommit, patch);
const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
const statics = await staticVerdict(log, task, task.baseCommit, patch);
const result = {
  task: task.id,
  patchBytes: Buffer.byteLength(patch),
  visible: { passed: visible.passed, checkExit: visible.checkExit, projectTestExit: visible.projectTestExit },
  hidden: { verdict: hidden.verdict, basis: hidden.basis },
  static: { applicable: statics.applicable, passed: statics.passed, introducedFailure: statics.introducedFailure },
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));
