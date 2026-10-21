/**
 * Deterministic validation of every task before any arm runs, with no model: the base (with the
 * visible check committed) must fail the hidden oracle and the visible check, each actually
 * executed over the base tree rather than refused as an empty patch; the upstream reference (the
 * upstream commit's own diff, tests included) must satisfy the allowed-change policy the arms
 * are held to (change-policy.mjs) and pass both; and the visible check must not fail the
 * project's own lint where that passes without it. A task that fails this is removed from the
 * frozen set with the reason recorded, not launched.
 *
 *   node scripts/comparison/validate.mjs --out <file> [--only <task-id>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { hiddenVerdict, lintVerdict, visibleVerdict } from "./checks.mjs";
import { taskSchema } from "./schema.mjs";
import { tasks } from "./tasks.mjs";
import { comparisonRoot, mirrorOf, resolveFull } from "./workspace.mjs";

/** The reference change: the upstream commit's whole diff against the base, tests included. */
export async function referencePatch(log, task, base, upstream) {
  const reference = await log.run(["git", "diff", "--binary", base, upstream], {
    cwd: mirrorOf(task.repository),
    timeoutMs: 60_000,
  });
  return reference.stdout.toString();
}

/**
 * One task's validation row. `valid` holds only where the base fails both readings with the
 * checks executed, the reference satisfies the policy and passes both, and the visible check
 * does not break the project's lint. A reference that passes the oracle only by a change the
 * policy forbids is recorded as such and the task is not valid: the arms could not have made
 * that change, so the reference would prove nothing about what they are asked to do.
 */
export async function validateTask(log, task) {
  taskSchema.parse(task);
  const started = Date.now();
  const row = { task: task.id, workType: task.workType, repository: task.repository };
  try {
    const { base, upstream } = await resolveFull(log, task);
    row.baseCommit = base;
    row.upstreamCommit = upstream;
    const patch = await referencePatch(log, task, base, upstream);
    row.referenceBytes = Buffer.byteLength(patch);
    const baseVisible = await visibleVerdict(log, task, base, "");
    const baseHidden = await hiddenVerdict(log, task, base, upstream, "", { executeEmpty: true });
    const referenceVisible = await visibleVerdict(log, task, base, patch);
    const referenceHidden = await hiddenVerdict(log, task, base, upstream, patch);
    const lint = await lintVerdict(log, task, base);
    row.lint = lint;
    row.base = {
      visible: baseVisible.passed,
      hidden: baseHidden.verdict,
      hiddenBasis: baseHidden.basis,
      executed: !baseHidden.basis.startsWith("the final tree is the base"),
    };
    row.reference = {
      visible: referenceVisible.passed,
      hidden: referenceHidden.verdict,
      hiddenBasis: referenceHidden.basis,
      policy: referenceHidden.policy ?? null,
      visibleDetail: referenceVisible.detail.slice(-4000),
    };
    row.valid =
      baseVisible.passed === false &&
      baseHidden.verdict === "fail" &&
      row.base.executed &&
      referenceVisible.passed === true &&
      referenceHidden.verdict === "pass" &&
      referenceHidden.policy?.ok === true &&
      lint.ok;
  } catch (cause) {
    row.valid = false;
    row.error = String(cause?.stack ?? cause);
  }
  row.wallMs = Date.now() - started;
  return row;
}

export function describeRow(row) {
  if (row.valid) return `VALID   ${row.task} (${Math.round(row.wallMs / 1000)}s)`;
  return `INVALID ${row.task} (${Math.round(row.wallMs / 1000)}s): base visible=${row.base?.visible} hidden=${row.base?.hidden} (${row.base?.hiddenBasis ?? ""}); reference visible=${row.reference?.visible} hidden=${row.reference?.hidden} (${row.reference?.hiddenBasis ?? ""}); lint ${row.lint?.ok} (${row.lint?.detail?.split("\n")[0] ?? ""}) ${row.error ?? ""}`;
}

if (process.argv[1]?.endsWith("validate.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const word = process.argv[index];
    if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
  }
  const log = commandLog(join(comparisonRoot, "blobs"));
  const rows = [];
  for (const task of tasks) {
    if (args.has("only") && args.get("only") !== task.id) continue;
    const row = await validateTask(log, task);
    rows.push(row);
    console.log(describeRow(row));
  }
  if (args.has("out"))
    writeFileSync(
      args.get("out"),
      `${JSON.stringify({ schema: "swarm-ordinary-comparison.validation.v2", validatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
    );
}
