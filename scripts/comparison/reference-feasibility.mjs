/**
 * Whether a task's project checks can pass at all under its reference, read four ways on this
 * host and recorded apart, with no model:
 *
 *   a. the unchanged base with the visible check committed;
 *   b. the reference's source changes only, with the project's own tests as the base has them;
 *   c. the complete reference, its test changes included;
 *   d. the evaluator's hidden overlay (the sealed test files written over the tree) on b and on c.
 *
 * Each row runs the project's test command and, for d, the hidden argv as well, and keeps the
 * exit code and the coverage table where the runner printed one. The point is to say what the
 * validator proved: a complete reference that passes says nothing about whether an agent held
 * to the allowed-change policy could pass, and a source-only reference that fails the coverage
 * rule says that a test is part of the work.
 *
 *   node scripts/comparison/reference-feasibility.mjs --only <task-id> --out <file>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { isTestFile, parsePatch } from "./change-policy.mjs";
import { patchedPaths, sealedFile } from "./checks.mjs";
import { tasks } from "./tasks.mjs";
import { referencePatch } from "./validate.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  resolveFull,
  tail,
  taskEnvironment,
  workRoot,
} from "./workspace.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}

/** The reference without its test files: what an agent's source change alone would be. */
export function sourceOnly(patch) {
  const files = parsePatch(patch);
  const kept = new Set(
    files
      .filter((file) => !isTestFile(file.path) && !isTestFile(file.oldPath))
      .map((file) => file.path),
  );
  const out = [];
  let keep = false;
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) keep = kept.has(header[2]);
    if (keep) out.push(line);
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** The coverage table a tap or nyc run prints, or the last lines where there is none. */
function coverageTable(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^-+\|-+\|/.test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start + 2 && /^-+\|-+\|/.test(line));
  return lines.slice(start, end === -1 ? start + 6 : end + 1).join("\n");
}

async function measure(log, task, base, upstream, patch, overlay, label) {
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `feasibility-${label}-${task.id}-`));
  const checkout = join(scratch, "checkout");
  const row = { label, patchBytes: Buffer.byteLength(patch), overlay, prepared: false };
  try {
    await cloneAtBase(log, task, base, checkout);
    await commitVisibleCheck(log, task, checkout);
    if (!(await applyPatch(log, checkout, patch))) return { ...row, applied: false };
    row.applied = true;
    const prepared = await prepare(log, task, checkout);
    row.prepared = prepared.ok;
    if (!prepared.ok) return { ...row, detail: prepared.detail };
    if (overlay) {
      row.overlaid = [];
      for (const path of task.hidden.testFiles) {
        const shown = await sealedFile(log, task, upstream, path);
        if (shown.exitCode !== 0) return { ...row, detail: `sealed file ${path} missing` };
        mkdirSync(dirname(join(checkout, path)), { recursive: true });
        writeFileSync(join(checkout, path), shown.stdout);
        row.overlaid.push({ path, displaced: patchedPaths(patch).includes(path) });
      }
      for (const argv of task.build) {
        const built = await log.run(argv, {
          cwd: checkout,
          timeoutMs: 900_000,
          env: taskEnvironment(task),
        });
        if (built.exitCode !== 0) return { ...row, detail: `build exited ${built.exitCode}` };
      }
      const hidden = await log.run(task.hidden.argv, {
        cwd: checkout,
        timeoutMs: 1_200_000,
        env: taskEnvironment(task),
      });
      row.hiddenArgv = task.hidden.argv.join(" ");
      row.hiddenExit = hidden.exitCode;
      row.hiddenTail = tail(hidden, 8);
    }
    const project = await log.run(task.projectTest, {
      cwd: checkout,
      timeoutMs: 1_200_000,
      env: taskEnvironment(task),
    });
    row.projectTest = task.projectTest.join(" ");
    row.projectTestExit = project.exitCode;
    const text = `${project.stdout.toString()}\n${project.stderr.toString()}`;
    row.coverage = coverageTable(text);
    row.summary = (text.match(/^# \{ total: .*\}$/m) ?? [null])[0];
    row.tail = tail(project, 12);
    return row;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("reference-feasibility.mjs")) {
  const log = commandLog(join(comparisonRoot, "blobs"));
  const rows = [];
  for (const task of tasks) {
    if (args.has("only") && args.get("only") !== task.id) continue;
    const { base, upstream } = await resolveFull(log, task);
    const complete = await referencePatch(log, task, base, upstream);
    const source = sourceOnly(complete);
    const conditions = [
      ["a-base", "", false],
      ["b-source-only-reference", source, false],
      ["c-complete-reference", complete, false],
      ["d-overlay-on-source-only", source, true],
      ["d-overlay-on-complete", complete, true],
    ];
    for (const [label, patch, overlay] of conditions) {
      const row = await measure(log, task, base, upstream, patch, overlay, label);
      rows.push({ task: task.id, base, upstream, ...row });
      console.log(
        `${label}: project test exit ${row.projectTestExit ?? "n/a"}${overlay ? `, hidden exit ${row.hiddenExit ?? "n/a"}` : ""}${row.summary ? `, ${row.summary}` : ""}`,
      );
      if (row.coverage) console.log(row.coverage);
    }
  }
  const report = {
    schema: "swarm-ordinary-comparison.reference-feasibility.v1",
    measuredAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version },
    rows,
  };
  if (args.has("out")) writeFileSync(args.get("out"), `${JSON.stringify(report, null, 2)}\n`);
}
