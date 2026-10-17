/**
 * Deterministic validation of the pilot's tasks before any arm runs, with no model, using the
 * comparison's own scorer (`scripts/comparison/checks.mjs`) so that what is validated is what
 * will score. Each control is labelled by what it establishes:
 *
 * - the base with the visible check committed fails the visible check, and the hidden oracle,
 *   executed over the base tree rather than short-circuited on an empty patch, fails it;
 * - the reference (its diff, tests included) passes both; under `--amended`, the maintainer's
 *   historical reference is reported separately from the task-compliant reference, since the
 *   amendment records that the two differ;
 * - the visible check does not fail the project's lint where lint passes without it;
 * - each deliberately wrong or partial implementation is rejected by the hidden oracle, with the
 *   basis of the rejection kept, since a rejection for a lockfile left inconsistent does not
 *   establish that a declaration requirement is enforced.
 *
 *   node scripts/pilot/validate.mjs --out <file> [--only <task-id>] [--amended]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { hiddenVerdict, lintVerdict, visibleVerdict } from "../comparison/checks.mjs";
import { taskSchema } from "../comparison/schema.mjs";
import { comparisonRoot, mirrorOf, resolveFull } from "../comparison/workspace.mjs";
import {
  amendedTasks,
  amendedWrongPatches,
  amendmentDate,
  taskCompliantReference,
} from "./amendments.mjs";
import { exactlyDeclaredReference } from "./reference.mjs";
import { taskSet } from "./task-sets.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}

const amended = args.has("amended");
const { stageTasks, wrongPatches, stagePurposes } = await taskSet(args.get("set"));
const log = commandLog(join(comparisonRoot, "blobs"));
const rows = [];
const tasks = amended
  ? amendedTasks
  : [
      ...stageTasks("A"),
      // A set that names its own stages has no calibration stage.
      ...(args.get("set") === undefined || stagePurposes !== undefined
        ? []
        : stageTasks("calibration")),
    ];
// Stage B repeats stage A tasks under other ids; a set that names its own stages has none.
const repeated = stagePurposes === undefined ? stageTasks("B") : [];
const wrong = amended ? amendedWrongPatches : wrongPatches;

const summarize = (visible, hidden) => ({
  visible: visible?.passed ?? null,
  hidden: hidden.verdict,
  hiddenBasis: hidden.basis,
  visibleDetail: (visible?.detail ?? "").slice(-1500),
  hiddenDetail: (hidden.detail ?? "").slice(-1500),
});

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
    const historical = reference.stdout.toString();
    row.referenceBytes = Buffer.byteLength(historical);

    // The base, with the oracle actually executed over it.
    const baseVisible = await visibleVerdict(log, task, base, "");
    const baseHidden = await hiddenVerdict(log, task, base, upstream, "", { executeEmpty: true });
    row.base = {
      ...summarize(baseVisible, baseHidden),
      establishes:
        "the hidden tests and checks were executed over the base tree and the verdict is theirs, not a short-circuit on an empty patch",
    };

    // The reference. Under the amendment the maintainer's own commit and the task-compliant
    // rewrite are both measured and both reported.
    const exactDeclarations = (task.hidden.upgrade ?? []).filter(
      (one) => one.declared !== undefined,
    );
    const compliant = amended
      ? exactDeclarations.length > 0
        ? taskCompliantReference(historical)
        : historical
      : exactDeclarations.reduce(
          (patch, dependency) => exactlyDeclaredReference(patch, dependency),
          historical,
        );
    const referenceVisible = await visibleVerdict(log, task, base, compliant);
    const referenceHidden = await hiddenVerdict(log, task, base, upstream, compliant);
    row.reference = {
      ...summarize(referenceVisible, referenceHidden),
      kind:
        compliant === historical
          ? "the maintainer's historical commit"
          : "task-compliant rewrite of the maintainer's commit",
    };
    if (compliant !== historical) {
      const historicalHidden = await hiddenVerdict(log, task, base, upstream, historical);
      row.historicalReference = {
        ...summarize(null, historicalHidden),
        establishes:
          historicalHidden.verdict === "fail"
            ? "the maintainer's own commit does not satisfy the task's wording under the amended oracle; the discrepancy is recorded, the frozen oracle is unchanged"
            : "the maintainer's own commit satisfies the amended oracle as well",
      };
    }

    const lint = await lintVerdict(log, task, base);
    row.lint = lint;

    const wrongPatch = wrong[task.id];
    const wrongVisible = wrongPatch ? await visibleVerdict(log, task, base, wrongPatch) : null;
    const wrongHidden = wrongPatch
      ? await hiddenVerdict(log, task, base, upstream, wrongPatch)
      : null;
    row.wrongImplementation =
      wrongPatch === undefined
        ? null
        : {
            bytes: Buffer.byteLength(wrongPatch),
            ...summarize(wrongVisible, wrongHidden),
            establishes: `the hidden oracle rejects this implementation for the reason in hiddenBasis and for that reason only`,
          };

    const twin = repeated.find((one) => one.id === `${task.id}-rep`);
    row.repetition =
      twin === undefined
        ? "not repeated in stage B"
        : amended
          ? "stage B's twin is the frozen task, not the amended one"
          : JSON.stringify({ ...twin, id: task.id }) === JSON.stringify(task)
            ? "stage B repeats this task unchanged"
            : "MISMATCH: the stage B twin differs beyond its id";
    row.valid =
      baseVisible.passed === false &&
      baseHidden.verdict === "fail" &&
      referenceVisible.passed === true &&
      referenceHidden.verdict === "pass" &&
      lint.ok &&
      wrongPatch !== undefined &&
      wrongHidden.verdict === "fail" &&
      (row.historicalReference === undefined || row.historicalReference.hidden === "fail") &&
      !row.repetition.startsWith("MISMATCH");
  } catch (cause) {
    row.valid = false;
    row.error = String(cause?.stack ?? cause);
  }
  row.wallMs = Date.now() - started;
  rows.push(row);
  console.log(
    `${row.valid ? "VALID  " : "INVALID"} ${task.id} (${Math.round(row.wallMs / 1000)}s): base visible=${row.base?.visible} hidden=${row.base?.hidden} (${row.base?.hiddenBasis}); reference visible=${row.reference?.visible} hidden=${row.reference?.hidden}${row.historicalReference ? `; historical reference hidden=${row.historicalReference.hidden} (${row.historicalReference.hiddenBasis})` : ""}; wrong visible=${row.wrongImplementation?.visible} hidden=${row.wrongImplementation?.hidden} (${row.wrongImplementation?.hiddenBasis ?? "no wrong patch"}); lint ${row.lint?.ok} (${row.lint?.detail?.split("\n")[0] ?? ""}); ${row.repetition ?? ""} ${row.error ?? ""}`,
  );
}
if (args.has("out"))
  writeFileSync(
    args.get("out"),
    `${JSON.stringify(
      {
        schema: "swarm-real-task-pilot.validation.v2",
        validatedAt: new Date().toISOString(),
        oracle: amended
          ? `amended ${amendmentDate} (scripts/pilot/amendments.mjs)`
          : "frozen (scripts/pilot/tasks.mjs)",
        rows,
      },
      null,
      2,
    )}\n`,
  );
process.exitCode = rows.every((row) => row.valid) ? 0 : 1;
