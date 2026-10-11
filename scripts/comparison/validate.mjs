/**
 * Deterministic validation of every task before any arm runs, with no model: the base (with the
 * visible check committed) must fail the hidden oracle and the visible check; the upstream
 * reference (the upstream commit's own diff, tests included) must pass both. A task that fails
 * this is removed from the frozen set with the reason recorded, not launched.
 *
 *   node scripts/comparison/validate.mjs --out <file> [--only <task-id>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { hiddenVerdict, visibleVerdict } from "./checks.mjs";
import { taskSchema } from "./schema.mjs";
import { tasks } from "./tasks.mjs";
import { comparisonRoot, mirrorOf, resolveFull } from "./workspace.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}

const log = commandLog(join(comparisonRoot, "blobs"));
const rows = [];
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
    row.base = {
      visible: baseVisible.passed,
      hidden: baseHidden.verdict,
      hiddenBasis: baseHidden.basis,
    };
    row.reference = {
      visible: referenceVisible.passed,
      hidden: referenceHidden.verdict,
      hiddenBasis: referenceHidden.basis,
      visibleDetail: referenceVisible.detail.slice(-4000),
    };
    row.valid =
      baseVisible.passed === false &&
      baseHidden.verdict === "fail" &&
      referenceVisible.passed === true &&
      referenceHidden.verdict === "pass";
  } catch (cause) {
    row.valid = false;
    row.error = String(cause?.stack ?? cause);
  }
  row.wallMs = Date.now() - started;
  rows.push(row);
  console.log(
    `${row.valid ? "VALID  " : "INVALID"} ${task.id} (${Math.round(row.wallMs / 1000)}s)${row.valid ? "" : `: base visible=${row.base?.visible} hidden=${row.base?.hidden} (${row.base?.hiddenBasis ?? ""}); reference visible=${row.reference?.visible} hidden=${row.reference?.hidden} (${row.reference?.hiddenBasis ?? ""}) ${row.error ?? ""}`}`,
  );
}
if (args.has("out"))
  writeFileSync(
    args.get("out"),
    `${JSON.stringify({ schema: "swarm-ordinary-comparison.validation.v1", validatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
