/**
 * Validates one held-out task with the comparison's own scorers and no model: the base fails the
 * visible check and (executed, not short-circuited) the hidden evaluator; the upstream reference
 * passes both and the allowed-change policy; every control patch is scored by the same hidden
 * evaluator (and the visible check); the project's lint verdict on the base; and the wall time
 * of the base's install and project tests, read from the scorer's own command log.
 *
 *   node validate-heldout.mjs <task-id> <sealed-subdirectory>
 *
 * Results go to sealed/validation/<task-id>.json and one line of sealed/validation-log.jsonl.
 * Adapted from block 1's script (~/.cache/swarm-heldout-2026-10-22/scripts/) for block 2: the
 * scorers are read from the swarm-progress-2026-10-23 worktree (read-only), and controls carry a
 * kind (faulty, alternative, absence-assertion).
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = "/Users/brad/projects/swarm-progress-2026-10-23/scripts";
const { commandLog } = await import(`${repo}/campaign/exec.mjs`);
const { hiddenVerdict, lintVerdict, visibleVerdict } = await import(`${repo}/comparison/checks.mjs`);
const { referencePatch } = await import(`${repo}/comparison/validate.mjs`);
const { taskSchema } = await import(`${repo}/comparison/schema.mjs`);
const { ensureMirror, resolveFull } = await import(`${repo}/comparison/workspace.mjs`);

const root = "/Users/brad/.cache/swarm-heldout-2026-10-23";
const sealed = join(root, "sealed");
const { tasks } = await import(join(sealed, "heldout-tasks.mjs"));

const [id, directory] = process.argv.slice(2);
const task = tasks.find((one) => one.id === id);
if (task === undefined) throw new Error(`no task ${id}`);
taskSchema.parse(task);
const only = process.argv.includes("--controls-only");

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const log = commandLog(join(sealed, "blobs"));
const started = Date.now();
const stamp = () => `${Math.round((Date.now() - started) / 1000)}s`;
const say = (line) => console.log(`[${stamp()}] ${line}`);

await ensureMirror(log, task);
const { base, upstream } = await resolveFull(log, task);
const reference = await referencePatch(log, task, base, upstream);
const sealedReference = readFileSync(join(sealed, directory, "reference.patch"), "utf8");
const row = {
  task: task.id,
  repository: task.repository,
  workType: task.workType,
  baseCommit: base,
  upstreamCommit: upstream,
  validatedAt: new Date().toISOString(),
  referenceDigest: sha256(reference),
  sealedReferenceMatches: sha256(reference) === sha256(sealedReference),
};

const summarizeVisible = (verdict) => ({
  passed: verdict.passed,
  checkExit: verdict.checkExit,
  projectTestExit: verdict.projectTestExit,
  detail: verdict.detail.slice(-3000),
});
const summarizeHidden = (verdict) => ({
  verdict: verdict.verdict,
  basis: verdict.basis,
  policy: verdict.policy ?? null,
  displaced: verdict.displaced ?? [],
  detail: (verdict.detail ?? "").slice(-3000),
});

if (!only) {
  const mark = log.commands.length;
  const baseVisible = await visibleVerdict(log, task, base, "");
  say(`base visible passed=${baseVisible.passed}`);
  // The base's own install and project-test wall time, from the scorer's log of that run.
  const baseRun = log.commands.slice(mark);
  const installMs = baseRun
    .filter((command) => task.install.some((argv) => argv.join(" ") === command.argv.join(" ")))
    .reduce((sum, command) => sum + command.wallMs, 0);
  const projectTest = baseRun.find((command) => command.argv.join(" ") === task.projectTest.join(" "));
  row.timings = {
    baseInstallMs: installMs,
    baseProjectTestMs: projectTest?.wallMs ?? null,
    baseProjectTestExit: projectTest?.exitCode ?? null,
  };
  const baseHidden = await hiddenVerdict(log, task, base, upstream, "", { executeEmpty: true });
  say(`base hidden ${baseHidden.verdict}: ${baseHidden.basis}`);
  const referenceVisible = await visibleVerdict(log, task, base, reference);
  say(`reference visible passed=${referenceVisible.passed}`);
  const referenceHidden = await hiddenVerdict(log, task, base, upstream, reference);
  say(`reference hidden ${referenceHidden.verdict}: ${referenceHidden.basis}`);
  const lint = await lintVerdict(log, task, base);
  say(`lint ok=${lint.ok} applicable=${lint.applicable}: ${lint.detail.split("\n")[0]}`);
  row.base = {
    visible: summarizeVisible(baseVisible),
    hidden: summarizeHidden(baseHidden),
    executed: !baseHidden.basis.startsWith("the final tree is the base"),
  };
  row.reference = { visible: summarizeVisible(referenceVisible), hidden: summarizeHidden(referenceHidden) };
  row.lint = lint;
}

// Block 2's control kinds, by file name: an alternative correct implementation and an
// absence-assertion control (a correct patch whose own tests mention what was removed) must
// pass; every other control is deliberately faulty and must fail.
const controlKind = (name) =>
  name.startsWith("alternative") ? "alternative" : name.startsWith("absence") ? "absence-assertion" : "faulty";
row.controls = [];
const controlDirectory = join(sealed, directory, "controls");
for (const name of readdirSync(controlDirectory).filter((file) => file.endsWith(".patch")).sort()) {
  const patch = readFileSync(join(controlDirectory, name), "utf8");
  const hidden = await hiddenVerdict(log, task, base, upstream, patch);
  say(`control ${name} hidden ${hidden.verdict}: ${hidden.basis}`);
  const visible = await visibleVerdict(log, task, base, patch);
  say(`control ${name} visible passed=${visible.passed}`);
  row.controls.push({
    name,
    digest: sha256(patch),
    kind: controlKind(name),
    expected: controlKind(name) === "faulty" ? "fail" : "pass",
    hidden: summarizeHidden(hidden),
    visible: summarizeVisible(visible),
  });
}

row.valid = only
  ? null
  : row.base.visible.passed === false &&
    row.base.hidden.verdict === "fail" &&
    row.base.executed &&
    row.reference.visible.passed === true &&
    row.reference.hidden.verdict === "pass" &&
    row.reference.hidden.policy?.ok === true &&
    row.lint.ok;
row.controlsAsExpected = row.controls.every((control) => control.hidden.verdict === control.expected);
row.wallMs = Date.now() - started;
row.commands = log.commands.map(({ argv, cwd, exitCode, signal, wallMs, stdoutDigest, stderrDigest }) => ({
  argv,
  cwd,
  exitCode,
  signal,
  wallMs,
  stdoutDigest,
  stderrDigest,
}));

mkdirSync(join(sealed, "validation"), { recursive: true });
const out = join(sealed, "validation", `${task.id}${only ? ".controls" : ""}.json`);
writeFileSync(out, `${JSON.stringify(row, null, 2)}\n`);
appendFileSync(
  join(sealed, "validation-log.jsonl"),
  `${JSON.stringify({
    task: task.id,
    at: row.validatedAt,
    valid: row.valid,
    controlsAsExpected: row.controlsAsExpected,
    referenceDigest: row.referenceDigest,
    sealedReferenceMatches: row.sealedReferenceMatches,
    hiddenFileDigests: (task.hidden.files ?? []).map((file) => sha256(file.source)),
    base: row.base && { visible: row.base.visible.passed, hidden: row.base.hidden.verdict, basis: row.base.hidden.basis, executed: row.base.executed },
    reference: row.reference && {
      visible: row.reference.visible.passed,
      hidden: row.reference.hidden.verdict,
      policy: row.reference.hidden.policy?.ok ?? null,
    },
    lint: row.lint && { ok: row.lint.ok, applicable: row.lint.applicable, detail: row.lint.detail.split("\n")[0] },
    timings: row.timings,
    controls: row.controls.map((control) => ({
      name: control.name,
      kind: control.kind,
      digest: control.digest,
      expected: control.expected,
      hidden: control.hidden.verdict,
      basis: control.hidden.basis,
      visible: control.visible.passed,
    })),
    wallMs: row.wallMs,
  })}\n`,
);
say(`valid=${row.valid} controlsAsExpected=${row.controlsAsExpected} -> ${out}`);
