#!/usr/bin/env node
/**
 * What a marked tree gives for each behaviour the task asks about, read externally after a launch
 * has delivered: the task's mixed-case scheme example, FTP and the other schemes it says stay as
 * they are, the www rule and email autolinks. Evaluation only; nothing here reaches the product or
 * a model, and the hidden oracle's verdict, which the comparison runner records, stays the verdict.
 *
 * Frozen before either launch of [protocol.md](protocol.md): the inputs below, and the reference
 * HTML for each, which is what the upstream fix's own tree gives (`--at upstream`). A delivered
 * patch is scored by building the base with the exact patch applied and comparing each input's
 * HTML with that reference; the base's HTML is recorded beside it.
 *
 *   node behaviour-probe.mjs --at upstream|base --out <json>
 *   node behaviour-probe.mjs --patch <final.patch> --reference <json> --out <json>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
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

/** Each behaviour the task names, with the input that shows it. */
export const behaviours = [
  { id: "example-mixed-case-scheme", input: "(See hTtPS://example.com/fhqwhgads.)" },
  { id: "ftp-bare", input: "ftp://example.com/file" },
  { id: "ftp-in-text", input: "Get it at ftp://files.example.com/a.txt today." },
  { id: "http-in-text", input: "Read http://example.com/page now." },
  { id: "https-upper-start", input: "HTTP://FOO.COM" },
  { id: "www-lower", input: "www.example.com" },
  { id: "www-mixed", input: "Www.example.com" },
  { id: "www-upper", input: "WWW.example.com" },
  { id: "email", input: "foo@bar.baz" },
  { id: "angle-mixed-case-scheme", input: "<hTtPS://example.com/>" },
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
  throw new Error("usage: behaviour-probe.mjs (--at upstream|base | --patch <file> --reference <json>) --out <json>");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const here = import.meta.dirname;
const manifest = JSON.parse(readFileSync(join(here, "manifest-ordinary.json"), "utf8"));
const task = manifest.tasks[0];
const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const scratch = mkdtempSync(join(workRoot, "behaviour-probe-"));
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
  "import { marked } from './lib/marked.esm.js';",
  `const inputs = ${JSON.stringify(behaviours.map((one) => one.input))};`,
  "console.log(JSON.stringify(inputs.map((input) => marked.parse(input, { gfm: true }))));",
].join("\n");
const ran = spawnSync("node", ["--input-type=module", "-e", probe], { cwd: tree, encoding: "utf8" });
if (ran.status !== 0) throw new Error(`the probe failed: ${ran.stderr}`);
const html = JSON.parse(ran.stdout);
const reference = values.reference === undefined ? null : JSON.parse(readFileSync(resolve(values.reference), "utf8"));
const result = {
  tree: values.at ?? "base with the patch",
  commit: values.at === "upstream" ? upstream : base,
  patchDigest,
  ...(reference === null ? {} : { referenceDigest: digest(readFileSync(resolve(values.reference))) }),
  behaviours: behaviours.map((one, index) => {
    const expected = reference?.behaviours.find((known) => known.id === one.id)?.html;
    return {
      ...one,
      html: html[index],
      ...(reference === null ? {} : { matchesUpstream: html[index] === expected }),
    };
  }),
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.behaviours.map((one) => [one.id, one.matchesUpstream ?? one.html])));
