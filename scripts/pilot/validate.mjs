/**
 * Deterministic validation of the pilot's tasks before any arm runs, with no model, using the
 * comparison's own scorer (`scripts/comparison/checks.mjs`) so that what is validated is what
 * will score:
 *
 * - the base with the visible check committed fails the visible check and the hidden oracle;
 * - the upstream reference (its diff, tests included) passes both;
 * - the visible check does not fail the project's lint where lint passes without it;
 * - one deliberately wrong or partial implementation per task is rejected by the hidden oracle,
 *   which shows the oracle detects a relevant mistake and not merely the absence of a change.
 *
 *   node scripts/pilot/validate.mjs --out <file> [--only <task-id>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { hiddenVerdict, lintVerdict, visibleVerdict } from "../comparison/checks.mjs";
import { taskSchema } from "../comparison/schema.mjs";
import { comparisonRoot, mirrorOf, resolveFull } from "../comparison/workspace.mjs";
import { stageTasks, wrongPatches } from "./tasks.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}

const log = commandLog(join(comparisonRoot, "blobs"));
const rows = [];
const tasks = stageTasks("A");
const repeated = stageTasks("B");
for (const task of tasks) {
  if (args.has("only") && args.get("only") !== task.id) continue;
  taskSchema.parse(task);
  const started = Date.now();
  const row = { task: task.id, workType: task.workType, repository: task.repository };
  try {
    const { base, upstream } = await resolveFull(log, task);
    row.baseCommit = base;
    row.upstreamCommit = upstream;
    const reference = await log.run(["git", "diff", "--binary", base, upstream], {
      cwd: mirrorOf(task.repository),
      timeoutMs: 60_000,
    });
    const patch = reference.stdout.toString();
    row.referenceBytes = Buffer.byteLength(patch);
    const baseVisible = await visibleVerdict(log, task, base, "");
    const baseHidden = await hiddenVerdict(log, task, base, upstream, "");
    const referenceVisible = await visibleVerdict(log, task, base, patch);
    const referenceHidden = await hiddenVerdict(log, task, base, upstream, patch);
    const lint = await lintVerdict(log, task, base);
    const wrong = wrongPatches[task.id];
    const wrongVisible = wrong ? await visibleVerdict(log, task, base, wrong) : null;
    const wrongHidden = wrong ? await hiddenVerdict(log, task, base, upstream, wrong) : null;
    row.lint = lint;
    row.base = {
      visible: baseVisible.passed,
      hidden: baseHidden.verdict,
      hiddenBasis: baseHidden.basis,
      visibleDetail: baseVisible.detail.slice(-1500),
    };
    row.reference = {
      visible: referenceVisible.passed,
      hidden: referenceHidden.verdict,
      hiddenBasis: referenceHidden.basis,
      visibleDetail: referenceVisible.detail.slice(-1500),
    };
    row.wrongImplementation =
      wrong === undefined
        ? null
        : {
            bytes: Buffer.byteLength(wrong),
            visible: wrongVisible.passed,
            hidden: wrongHidden.verdict,
            hiddenBasis: wrongHidden.basis,
            hiddenDetail: (wrongHidden.detail ?? "").slice(-1500),
          };
    // The repetition is the same task under another id, or stage B measures something else.
    const twin = repeated.find((one) => one.id === `${task.id}-rep`);
    row.repetition =
      twin === undefined
        ? "not repeated in stage B"
        : JSON.stringify({ ...twin, id: task.id }) === JSON.stringify(task)
          ? "stage B repeats this task unchanged"
          : "MISMATCH: the stage B twin differs beyond its id";
    row.valid =
      baseVisible.passed === false &&
      baseHidden.verdict === "fail" &&
      referenceVisible.passed === true &&
      referenceHidden.verdict === "pass" &&
      lint.ok &&
      wrong !== undefined &&
      wrongHidden.verdict === "fail" &&
      !row.repetition.startsWith("MISMATCH");
  } catch (cause) {
    row.valid = false;
    row.error = String(cause?.stack ?? cause);
  }
  row.wallMs = Date.now() - started;
  rows.push(row);
  console.log(
    `${row.valid ? "VALID  " : "INVALID"} ${task.id} (${Math.round(row.wallMs / 1000)}s): base visible=${row.base?.visible} hidden=${row.base?.hidden}; reference visible=${row.reference?.visible} hidden=${row.reference?.hidden}; wrong visible=${row.wrongImplementation?.visible} hidden=${row.wrongImplementation?.hidden} (${row.wrongImplementation?.hiddenBasis ?? "no wrong patch"}); lint ${row.lint?.ok} (${row.lint?.detail?.split("\n")[0] ?? ""}); ${row.repetition ?? ""} ${row.error ?? ""}`,
  );
}
if (args.has("out"))
  writeFileSync(
    args.get("out"),
    `${JSON.stringify({ schema: "swarm-real-task-pilot.validation.v1", validatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
process.exitCode = rows.every((row) => row.valid) ? 0 : 1;
