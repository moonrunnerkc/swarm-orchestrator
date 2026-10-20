#!/usr/bin/env node
/**
 * What each tree of the repair-handoff pair gives for a URL with no scheme before `://`, read
 * externally after the pair was closed. Both delivered patches spell the `url` rule's scheme as
 * `(?:[fF][tT][pP]|[hH][tT][tT][pP][sS]?)?:\/\/`, the whole alternative optional, so `://host`
 * satisfies the rule with no scheme at all. Evaluation only; nothing here reaches the product or
 * a model, and the pair's oracle, probe and protocol scores stay as recorded.
 *
 * Four trees, each built from a fresh clone: the task base, the base with the control arm's exact
 * delivered patch, the base with the treatment arm's exact delivered patch, and the upstream fix.
 *
 *   node probe.mjs --tree base|upstream --out <json>
 *   node probe.mjs --tree patch --patch <final.patch> --out <json>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../../scripts/campaign/exec.mjs";
import {
  applyPatch,
  cloneAtBase,
  comparisonRoot,
  mirrorOf,
  prepare,
  resolveFull,
  taskEnvironment,
  workRoot,
} from "../../../../../scripts/comparison/workspace.mjs";

/** The two inputs the audit names, then context rows that show the rule's reach. */
export const inputs = [
  { id: "scheme-less-bare", input: "://example.com" },
  { id: "scheme-less-path", input: "://example.com/file" },
  { id: "scheme-less-in-text", input: "See ://example.com/file today." },
  { id: "ftp-bare", input: "ftp://example.com/file" },
  { id: "ftp-mixed-case", input: "Ftp://ftp.example.net/file" },
  { id: "http-bare", input: "http://example.com" },
];

const { values } = parseArgs({
  options: { tree: { type: "string" }, patch: { type: "string" }, out: { type: "string" } },
});
if (values.out === undefined || values.tree === undefined)
  throw new Error("usage: probe.mjs --tree base|upstream|patch [--patch <file>] --out <json>");
if ((values.tree === "patch") !== (values.patch !== undefined))
  throw new Error("--patch goes with --tree patch and nothing else");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const here = import.meta.dirname;
const manifest = JSON.parse(
  readFileSync(join(here, "../../../2026-10-19/requested-example/manifest-ordinary.json"), "utf8"),
);
const task = manifest.tasks[0];
if (task.id !== "marked-bugfix-www-case") throw new Error(`unexpected task ${task.id}`);
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const scratch = mkdtempSync(join(workRoot, "audit-url-scheme-"));
const tree = join(scratch, "tree");
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

let patchDigest = null;
if (values.tree === "upstream") {
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
const urlRule = spawnSync("git", ["grep", "-n", "^  url: edit(", "HEAD", "--", "src/rules.ts"], {
  cwd: tree,
  encoding: "utf8",
}).stdout.trim();
const probe = [
  "import { marked } from './lib/marked.esm.js';",
  `const inputs = ${JSON.stringify(inputs.map((one) => one.input))};`,
  "console.log(JSON.stringify(inputs.map((input) => marked.parse(input, { gfm: true }))));",
].join("\n");
const ran = spawnSync("node", ["--input-type=module", "-e", probe], { cwd: tree, encoding: "utf8" });
if (ran.status !== 0) throw new Error(`the probe failed: ${ran.stderr}`);
const html = JSON.parse(ran.stdout);
const result = {
  tree: values.tree === "patch" ? "base with the patch" : values.tree,
  commit: values.tree === "upstream" ? upstream : base,
  patch: values.patch === undefined ? null : resolve(values.patch).replace(`${resolve(here, "..")}/`, ""),
  patchDigest,
  urlRule,
  results: inputs.map((one, index) => ({ ...one, html: html[index], linked: /<a href=/.test(html[index]) })),
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.tree} ${result.commit}${patchDigest === null ? "" : ` ${patchDigest}`}`);
for (const row of result.results) console.log(`  ${row.linked ? "LINK " : "text "} ${row.id}: ${JSON.stringify(row.html)}`);
