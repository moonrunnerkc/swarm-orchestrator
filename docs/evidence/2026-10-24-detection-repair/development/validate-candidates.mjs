/**
 * Each retained candidate of the development set, judged against its original task by the task's
 * own sealed evaluator, apart from the product: the comparison runner's hidden verdict on a fresh
 * clone of the base with the harness lockfile and the candidate applied. Development evidence, run
 * on the evaluator's side only: nothing here reaches a model.
 *
 *   node validate-candidates.mjs --tasks <tasks module> --candidates <dir> --inputs <dir> \
 *     --set <development-set.json> --out <file.json>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { hiddenVerdict } from "../../../../scripts/comparison/checks.mjs";
import { comparisonRoot, resolveFull } from "../../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: {
    tasks: { type: "string" },
    candidates: { type: "string" },
    inputs: { type: "string", multiple: true },
    set: { type: "string" },
    out: { type: "string" },
  },
});
const { tasks } = await import(pathToFileURL(values.tasks).href);
const set = JSON.parse(readFileSync(values.set, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const log = commandLog(join(comparisonRoot, "blobs"));
const results = [];
for (const one of set.cases) {
  const listed = tasks.find((candidate) => candidate.id === one.task);
  // The commits in full, as a study's freeze resolves them.
  const commits = await resolveFull(log, listed);
  const task = { ...listed, baseCommit: commits.base, upstreamCommit: commits.upstream };
  const bytes = readFileSync(join(values.candidates, one.patch));
  if (digest(bytes) !== one.digest) throw new Error(`${one.patch} is not ${one.digest}`);
  const lock = values.inputs
    .map((root) => join(root, one.task, "package-lock.json"))
    .map((path) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    })
    .find((found) => found !== null);
  const started = Date.now();
  const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, bytes.toString(), {
    harnessLock: lock ?? null,
  });
  const result = {
    id: one.id,
    task: one.task,
    patch: one.patch,
    digest: one.digest,
    expected: one.kind,
    verdict: hidden.verdict,
    basis: hidden.basis,
    detail: (hidden.detail ?? "").slice(-3000),
    wallMs: Date.now() - started,
  };
  console.log(`${one.id}: ${hidden.verdict} (${hidden.basis.slice(0, 160)})`);
  results.push(result);
  writeFileSync(values.out, `${JSON.stringify({ results }, null, 2)}\n`);
}
writeFileSync(values.out, `${JSON.stringify({ results }, null, 2)}\n`);
