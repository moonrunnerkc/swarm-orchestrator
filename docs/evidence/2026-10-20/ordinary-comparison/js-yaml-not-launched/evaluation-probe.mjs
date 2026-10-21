#!/usr/bin/env node
/**
 * What a js-yaml tree gives for each behaviour the task `js-yaml-bugfix-timestamp-early-years`
 * asks about, read externally after a launch has delivered: the requested change (years 0000 to
 * 0099 under the YAML 1.1 schema resolve to Dates whose UTC year is the literal year, date-only
 * and full timestamps, and the task's own two-item example), its negative cases (a calendar-
 * invalid early date stays a string, and raises "cannot resolve" when tagged !!timestamp
 * explicitly), and preserved behaviour (years 0100 and later, a modern full timestamp, a modern
 * invalid date, the default schema, dump of a modern Date). Evaluation only; nothing here reaches
 * the product or a model, and the hidden oracle's verdict, which the comparison runner records,
 * stays the verdict.
 *
 * Frozen before either launch of [protocol.md](protocol.md): the inputs below, and the reference
 * for each, which is what the upstream fix's own tree gives (`--at upstream`). A delivered patch
 * is scored by building the base with the exact patch applied and comparing each row's result
 * with that reference; the base's result is recorded beside it (`--at base`), and a row the base
 * already matches is preserved behaviour, not the requested change.
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

/** Each behaviour, with the code that shows it; `kind` says what the row is for. */
export const behaviours = [
  { id: "requested-date-only-year-1", kind: "requested", code: "load('0001-01-01', y11)" },
  { id: "requested-full-year-50", kind: "requested", code: "load('0050-06-15T12:30:00Z', y11)" },
  { id: "requested-task-example", kind: "requested", code: "load('- 0001-01-01\\n- 0050-06-15T12:30:00Z', y11)" },
  { id: "requested-date-only-year-99", kind: "requested", code: "load('0099-12-31', y11)" },
  {
    id: "requested-roundtrip-year-50",
    kind: "requested",
    code: "load(dump(utc(50, 5, 15, 12, 30), y11), y11)",
  },
  { id: "negative-invalid-day-year-1", kind: "negative", code: "load('0001-02-29', y11)" },
  { id: "negative-explicit-tag-invalid", kind: "negative", code: "load('!!timestamp 0001-02-29', y11)" },
  { id: "negative-invalid-month-year-50", kind: "negative", code: "load('0050-13-01', y11)" },
  { id: "preserved-year-100", kind: "preserved", code: "load('0100-01-01', y11)" },
  { id: "preserved-year-1999-full", kind: "preserved", code: "load('1999-12-31T23:59:59.5-05:00', y11)" },
  { id: "preserved-yaml11-example", kind: "preserved", code: "load('2001-12-14t21:59:43.10-05:00', y11)" },
  { id: "preserved-modern-invalid", kind: "preserved", code: "load('2023-02-29', y11)" },
  { id: "preserved-modern-leap", kind: "preserved", code: "load('2024-02-29', y11)" },
  { id: "preserved-default-schema-early", kind: "preserved", code: "load('0050-06-15')" },
  { id: "preserved-default-schema-modern", kind: "preserved", code: "load('2020-01-02')" },
  { id: "preserved-dump-modern", kind: "preserved", code: "dump(utc(2020, 0, 2, 3, 4, 5), y11)" },
  { id: "preserved-roundtrip-modern", kind: "preserved", code: "load(dump(utc(2020, 0, 2, 3, 4, 5), y11), y11)" },
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
const task = tasks.find((one) => one.id === "js-yaml-bugfix-timestamp-early-years");
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
  "import { load as rawLoad, dump as rawDump, YAML11_SCHEMA } from 'js-yaml';",
  "const y11 = { schema: YAML11_SCHEMA };",
  "const load = (text, options) => rawLoad(text, options);",
  "const dump = (value, options) => rawDump(value, options);",
  // Date.UTC maps years 0 to 99 onto 1900 to 1999, so an early year is set on the instance.
  "const utc = (year, month, day, hour = 0, minute = 0, second = 0) => {",
  "  const date = new Date(0); date.setUTCFullYear(year, month, day); date.setUTCHours(hour, minute, second, 0); return date; };",
  "const describe = (value) => value instanceof Date",
  "  ? { date: value.toISOString(), utcYear: value.getUTCFullYear() }",
  "  : Array.isArray(value) ? { array: value.map(describe) } : { value: typeof value === 'string' ? value : JSON.stringify(value) };",
  `const codes = ${JSON.stringify(behaviours.map((one) => one.code))};`,
  "const results = codes.map((code) => { try { return describe(new Function('load', 'dump', 'utc', 'y11', `return (${code});`)(load, dump, utc, y11)); } catch (error) { return { error: String(error.message).split('\\n')[0] }; } });",
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
