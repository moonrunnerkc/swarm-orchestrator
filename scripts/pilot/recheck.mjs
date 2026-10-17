/**
 * Retrospective recheck of recorded final patches under the amended oracle, with no model: each
 * published patch of the named task is scored again by `hiddenVerdict` with the amended task
 * definition, and the verdicts go to a separate file beside the amendment. The frozen records,
 * their verdicts and the frozen oracle are not touched.
 *
 *   node scripts/pilot/recheck.mjs --patches <dir> --task <task-id> --out <file>
 *   node scripts/pilot/recheck.mjs --patches <dir> --set <date> --stage A|B --out <file>
 *
 * With `--set`, the frozen oracle of that task set scores every published patch of the stage
 * again: the reproducibility of a stage's verdicts from its published patches alone.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { digestOf } from "../comparison/arms.mjs";
import { hiddenVerdict } from "../comparison/checks.mjs";
import { comparisonRoot, resolveFull } from "../comparison/workspace.mjs";
import { amendedTasks, amendmentDate } from "./amendments.mjs";
import { taskSet } from "./task-sets.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const frozen = args.has("set");
const tasks = frozen
  ? (await taskSet(args.get("set")))
      .stageTasks(args.get("stage"))
      .filter((one) => !args.has("task") || one.id === args.get("task"))
  : amendedTasks.filter((one) => one.id === args.get("task"));
if (tasks.length === 0)
  throw new Error(`no task to recheck for ${args.get("task") ?? "the stage"}`);
const log = commandLog(join(comparisonRoot, "blobs"));
const rows = [];
for (const task of tasks) {
  const { base, upstream } = await resolveFull(log, task);
  for (const name of readdirSync(args.get("patches"))
    .filter((one) => one.startsWith(`${task.id}.`) && one.endsWith(".patch"))
    .sort()) {
    const patch = readFileSync(join(args.get("patches"), name), "utf8");
    const verdict = await hiddenVerdict(log, task, base, upstream, patch);
    rows.push({
      task: task.id,
      baseCommit: base,
      upstreamCommit: upstream,
      patch: name,
      patchDigest: digestOf(patch),
      bytes: Buffer.byteLength(patch),
      verdict: verdict.verdict,
      basis: verdict.basis,
      detail: (verdict.detail ?? "").slice(-1500),
    });
    console.log(`${name}: ${verdict.verdict} (${verdict.basis})`);
  }
}
writeFileSync(
  args.get("out"),
  `${JSON.stringify(
    {
      schema: "swarm-real-task-pilot.recheck.v2",
      recheckedAt: new Date().toISOString(),
      oracle: frozen
        ? `frozen (scripts/pilot/tasks-${args.get("set")}.mjs, stage ${args.get("stage")})`
        : `amended ${amendmentDate} (scripts/pilot/amendments.mjs)`,
      rows,
    },
    null,
    2,
  )}\n`,
);
