#!/usr/bin/env node
/**
 * What a minimatch tree gives for each behaviour the task `minimatch-bugfix-partial-globstar`
 * asks about, read externally after a launch has delivered: the requested change (the five
 * partial matches with `**` the task says must be true, through `minimatch(path, pattern,
 * { partial: true })` and `Minimatch#match(path, true)`), its negative cases (`b/a` against `a/**`
 * stays false under partial; non-partial matching does not loosen), and preserved behaviour
 * (partial matching without `**`, `makeRe` with `partial: true`, ordinary non-partial matches);
 * rows the task does not state are `observed`, reported and not scored.
 * Evaluation only; nothing here reaches the product or a model, and the hidden oracle's verdict,
 * which the comparison runner records, stays the verdict.
 *
 * Frozen before either launch of [protocol.md](protocol.md): the rows below, and the reference
 * for each, which is what the upstream fix's own tree gives (`--at upstream`). A delivered patch
 * is scored by building the base with the exact patch applied and comparing each row's result
 * with that reference; the base's result is recorded beside it (`--at base`), and a row the base
 * already matches is preserved behaviour or a negative case, not the requested change.
 *
 *   node evaluation-probe.mjs --at upstream|base --out <json>
 *   node evaluation-probe.mjs --patch <final.patch> --reference <json> --out <json>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { tasks } from "../../../../scripts/comparison/tasks.mjs";
import {
  applyPatch,
  cloneAtBase,
  comparisonRoot,
  mirrorOf,
  prepare,
  resolveFull,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";

const partial = { partial: true };
/** Each behaviour, with the code that shows it; `kind` says what the row is for. */
export const behaviours = [
  { id: "requested-globstar-prefix-1", kind: "requested", code: "minimatch('/b/c/d/a', '/**/a/b/c', partial)" },
  { id: "requested-globstar-prefix-2", kind: "requested", code: "minimatch('/b/c/d/a', '/**/a/b/c/**', partial)" },
  { id: "requested-globstar-prefix-3", kind: "requested", code: "minimatch('a', 'a/**', partial)" },
  { id: "requested-globstar-prefix-4", kind: "requested", code: "minimatch('/b/c/d/a', '/**/a/**/b/c/**', partial)" },
  { id: "requested-globstar-prefix-5", kind: "requested", code: "minimatch('/b/c/d/a', '/**/a/**', partial)" },
  { id: "requested-instance-match", kind: "requested", code: "new Minimatch('/**/a/b/c').match('/b/c/d/a', true)" },
  { id: "negative-not-a-prefix", kind: "negative", code: "minimatch('b/a', 'a/**', partial)" },
  { id: "negative-non-partial-stays-false", kind: "negative", code: "minimatch('/b/c/d/a', '/**/a/b/c')" },
  { id: "negative-non-partial-globstar-tail", kind: "negative", code: "minimatch('/b/c/d/a', '/**/a/**/b/c/**')" },
  { id: "negative-wrong-prefix-after-globstar", kind: "negative", code: "minimatch('/b/c/d/x', '/**/a/b/c', partial) && minimatch('/x/y', 'a/**', partial)" },
  { id: "preserved-partial-without-globstar-true", kind: "preserved", code: "minimatch('/a/b', '/*/b/x/y/z', partial)" },
  { id: "preserved-partial-without-globstar-false", kind: "preserved", code: "minimatch('/a/b/c', '/*/b/x/y/z', partial)" },
  { id: "preserved-makere-partial-1", kind: "preserved", code: "makeRe('/*/b/x/y/z', partial).source" },
  { id: "preserved-makere-partial-2", kind: "preserved", code: "makeRe('a/**', partial).source" },
  { id: "preserved-makere-partial-3", kind: "preserved", code: "makeRe('/**/a/b/c', partial).source" },
  { id: "preserved-makere-plain", kind: "preserved", code: "makeRe('/**/a/b/c').source" },
  { id: "preserved-non-partial-globstar-true", kind: "preserved", code: "minimatch('a/b/c', 'a/**') && minimatch('x/a/b/c', '**/a/b/c') && minimatch('/a/b/c', '/**/a/b/c')" },
  { id: "preserved-non-partial-globstar-false", kind: "preserved", code: "minimatch('a', 'a/**/b') || minimatch('a/b', '**/c')" },
  { id: "preserved-non-partial-plain", kind: "preserved", code: "minimatch('a/b/c', 'a/*/c') && !minimatch('a/b/c', 'a/*') && minimatch('.x', '.*') && !minimatch('.x', '*')" },
  // The task says nothing about dot files under partial matching with `**`; these rows are
  // reported, not scored.
  { id: "observed-partial-dot-file-named", kind: "observed", code: "minimatch('.a', '**/.a', partial)" },
  { id: "observed-partial-dot-dir-prefix", kind: "observed", code: "minimatch('.a/b', '**/b', partial)" },
];

const { values } = parseArgs({
  options: {
    at: { type: "string" },
    patch: { type: "string" },
    reference: { type: "string" },
    out: { type: "string" },
  },
});
if (values.out === undefined || (values.at === undefined) === (values.patch === undefined))
  throw new Error("usage: evaluation-probe.mjs (--at upstream|base | --patch <file> --reference <json>) --out <json>");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const task = tasks.find((one) => one.id === "minimatch-bugfix-partial-globstar");
if (task === undefined) throw new Error("the task is not in the comparison's task set");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const scratch = mkdtempSync(join(workRoot, "evaluation-probe-"));
const tree = join(scratch, "tree");
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

let patchDigest = null;
if (values.at === "upstream") {
  const cloned = spawnSync("git", ["clone", "--quiet", `file://${mirrorOf(task.repository)}`, tree]);
  if (cloned.status !== 0) throw new Error("the upstream clone failed");
  spawnSync("git", ["checkout", "--quiet", upstream], { cwd: tree });
} else {
  await cloneAtBase(log, task, base, tree);
  if (values.patch !== undefined) {
    const patch = readFileSync(resolve(values.patch), "utf8");
    patchDigest = digest(patch);
    if (!(await applyPatch(log, tree, patch))) throw new Error("the patch does not apply to the base");
  }
}
const prepared = await prepare(log, task, tree);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
for (const argv of task.build) {
  const built = spawnSync(argv[0], argv.slice(1), { cwd: tree, env: taskEnvironment(task), encoding: "utf8" });
  if (built.status !== 0) throw new Error(`the build failed: ${built.stderr}`);
}
const probe = [
  "import { minimatch, Minimatch, makeRe } from './dist/esm/index.js';",
  "const partial = { partial: true };",
  "const describe = (value) => typeof value === 'boolean' || typeof value === 'string' ? { value } : { value: JSON.stringify(value) };",
  `const codes = ${JSON.stringify(behaviours.map((one) => one.code))};`,
  "const results = codes.map((code) => { try { return describe(new Function('minimatch', 'Minimatch', 'makeRe', 'partial', `return (${code});`)(minimatch, Minimatch, makeRe, partial)); } catch (error) { return { error: String(error.message).split('\\n')[0] }; } });",
  "console.log(JSON.stringify(results));",
].join("\n");
const ran = spawnSync("node", ["--input-type=module", "-e", probe], { cwd: tree, encoding: "utf8" });
if (ran.status !== 0) throw new Error(`the probe failed: ${ran.stderr}`);
const results = JSON.parse(ran.stdout);
const reference = values.reference === undefined ? null : JSON.parse(readFileSync(resolve(values.reference), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const result = {
  tree: values.at ?? "base with the patch",
  commit: values.at === "upstream" ? upstream : base,
  patchDigest,
  ...(reference === null ? {} : { referenceDigest: digest(readFileSync(resolve(values.reference))) }),
  behaviours: behaviours.map((one, index) => {
    const expected = reference?.behaviours.find((known) => known.id === one.id)?.result;
    return {
      ...one,
      result: results[index],
      ...(reference === null ? {} : { matchesUpstream: same(results[index], expected) }),
    };
  }),
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
for (const row of result.behaviours)
  console.log(`${row.matchesUpstream === undefined ? "" : row.matchesUpstream ? "match " : "DIFF  "}${row.id}: ${JSON.stringify(row.result)}`);
