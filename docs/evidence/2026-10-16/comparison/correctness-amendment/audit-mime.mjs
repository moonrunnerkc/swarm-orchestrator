#!/usr/bin/env node
/**
 * Post hoc correctness audit of the two retained mime patches of the 2026-10-16 comparison,
 * through the pinned repository's ordinary API. It is not a scored instrument and changes no
 * recorded score.
 *
 * For each variant (the base, the upstream maintainer commit, Swarm's patch, OpenCode's patch) it
 * clones the repository at the pinned base, applies the variant, installs and builds the package
 * offline, and calls the built `getType` on a fixed case table. The expected value is a second
 * reading of the task text written without regular expressions: the last segment follows the
 * last `/` or `\`, the extension follows the last `.` of that segment, and every other character,
 * line terminators included, is ordinary. The upstream commit must agree with that reading on
 * every case, or the reading is wrong and the run says so.
 *
 *   node audit-mime.mjs --repo <git url or mirror path> --work <empty scratch directory>
 *     [--npm <npm binary>] [--npm-cache <directory>] [--candidate <name>=<patch file> ...]
 *     > audit-mime.json
 *
 * `--candidate` adds a patch beside the two retained ones, under its own name, for a later
 * launch's delivered change.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    work: { type: "string" },
    npm: { type: "string", default: "npm" },
    "npm-cache": { type: "string" },
    candidate: { type: "string", multiple: true, default: [] },
  },
});
if (values.repo === undefined || values.work === undefined)
  throw new Error("usage: audit-mime.mjs --repo <git url or path> --work <empty directory>");
const work = resolve(values.work);
mkdirSync(work, { recursive: true });
if (readdirSync(work).length > 0) throw new Error(`${work} is not empty`);

const baseCommit = "953ae3ebc59c387064f3760b73085eff6760a7f6";
const upstreamCommit = "d7871f3bac120df5e4776e7c395b39d0d8e7b562";
const patches = join(here, "..", "stage-a", "patches");
const variants = {
  base: null,
  reference: { upstream: "src/Mime.ts" },
  swarm: { patch: join(patches, "mime-bugfix-gettype-line-terminators.swarm.patch") },
  opencode: { patch: join(patches, "mime-bugfix-gettype-line-terminators.opencode.patch") },
};

for (const entry of values.candidate) {
  const [name, path] = entry.split("=");
  if (!/^[a-z][a-z0-9-]*$/.test(name ?? "") || path === undefined || name in variants)
    throw new Error(`--candidate takes <new name>=<patch file>, not ${entry}`);
  variants[name] = { patch: resolve(path) };
}

const sh = (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, stdio: "pipe" }).toString();
const npmFlags = values["npm-cache"] === undefined ? [] : ["--cache", values["npm-cache"], "--offline"];

for (const [name, change] of Object.entries(variants)) {
  const directory = join(work, name);
  sh(["git", "clone", "-q", "--no-checkout", values.repo, directory], work);
  sh(["git", "-c", "advice.detachedHead=false", "checkout", "-q", baseCommit], directory);
  if (change?.upstream !== undefined) sh(["git", "checkout", upstreamCommit, "--", change.upstream], directory);
  if (change?.patch !== undefined) sh(["git", "apply", change.patch], directory);
  sh([values.npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", ...npmFlags], directory);
  sh([values.npm, "run", "build"], directory);
}

const load = async (name) =>
  (await import(pathToFileURL(join(work, name, "dist", "src", "index.js")).href)).default;
const built = Object.fromEntries(
  await Promise.all(Object.keys(variants).map(async (name) => [name, await load(name)])),
);

/** The task's rule, by index arithmetic; the type table is read through the base build. */
function expectedType(path) {
  if (typeof path !== "string") return null;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const last = path.slice(cut + 1).toLowerCase();
  const dot = last.lastIndexOf(".");
  const ext = dot === -1 ? last : last.slice(dot + 1);
  const hasPath = last.length < path.length;
  const hasDot = ext.length < last.length - 1;
  if (!hasDot && hasPath) return null;
  // A string with no separator and no dot is looked up unchanged by every variant's getType.
  return built.base.getType(ext);
}

const terminators = { LF: "\n", CR: "\r", CRLF: "\r\n", LS: "\u2028", PS: "\u2029" };
const controls = { SPACE: " ", TAB: "\t" };
const templates = {
  name: (t) => `LINE${t}FEED.png`,
  "dir+name": (t) => `/path/to/LINE${t}FEED.png`,
  leading: (t) => `${t}.png`,
  multi: (t) => `a${t}b${t}c.png`,
  "dir-holds": (t) => `dir${t}sub/photo.png`,
  "between-exts": (t) => `photo.png${t}.jpg`,
  "dir+between-exts": (t) => `dir/photo.png${t}.jpg`,
  "earlier-ext-spoof": (t) => `evil.html${t}x.png`,
  "inside-ext": (t) => `photo.pn${t}g`,
  trailing: (t) => `photo.png${t}`,
  dotfile: (t) => `/p/.config${t}.json`,
  windows: (t) => `C:\\dir${t}x\\file.txt`,
  "extless-dir": (t) => `/dir/file${t}name`,
};
const ordinary = [
  "report.html", "/path/to/.config.json", ".config.json", "/path/to/file", "file", "txt", ".txt",
  "dir\\file.txt", "dir/file.TXT", "a.b.c.png", "", "/", ".", "photo.", "dir/.png", "C:\\x\\y.jpg",
  "noext/", "trailing.dot.",
];

const cases = [];
for (const [template, make] of Object.entries(templates))
  for (const [label, character] of Object.entries({ ...terminators, ...controls }))
    cases.push({
      id: `${template}:${label}`,
      group: label in controls ? "space-or-tab" : "line-terminator",
      input: make(character),
    });
for (const input of ordinary) cases.push({ id: `ordinary:${JSON.stringify(input)}`, group: "ordinary", input });
for (const input of [null, undefined, 42, {}])
  cases.push({ id: `non-string:${String(input)}`, group: "ordinary", input });

const rows = cases.map((one) => ({
  id: one.id,
  group: one.group,
  input: one.input === undefined ? "undefined" : JSON.stringify(one.input),
  expected: expectedType(one.input),
  got: Object.fromEntries(Object.keys(variants).map((name) => [name, built[name].getType(one.input)])),
}));
const summary = Object.fromEntries(
  Object.keys(variants).map((name) => {
    const wrong = rows.filter((row) => row.got[name] !== row.expected);
    const byGroup = Object.fromEntries(
      ["line-terminator", "space-or-tab", "ordinary"].map((group) => [
        group,
        { cases: rows.filter((row) => row.group === group).length, wrong: wrong.filter((row) => row.group === group).length },
      ]),
    );
    return [name, { cases: rows.length, wrong: wrong.length, byGroup, wrongIds: wrong.map((row) => row.id) }];
  }),
);
const named = ["a\nb\nc.png", "photo.png\n.jpg", "dir/photo.png\u2028.jpg"].map((input) => ({
  input: JSON.stringify(input),
  expected: expectedType(input),
  got: Object.fromEntries(Object.keys(variants).map((name) => [name, built[name].getType(input)])),
}));

// The frozen hidden oracle: the upstream commit's own test file, run against each variant.
const oracle = {};
const hidden = sh(["git", "show", `${upstreamCommit}:test/mime.test.js`], join(work, "base"));
for (const name of Object.keys(variants)) {
  const file = join(work, name, "test", "mime.hidden.test.js");
  writeFileSync(file, hidden);
  try {
    sh(["node", "--test", "test/mime.hidden.test.js"], join(work, name));
    oracle[name] = "pass";
  } catch {
    oracle[name] = "fail";
  }
}

const result = {
  schema: "swarm-mime-correctness-audit.v1",
  baseCommit,
  upstreamCommit,
  patches: Object.fromEntries(
    Object.entries(variants)
      .filter(([, change]) => change?.patch !== undefined)
      .map(([name, change]) => [
        name,
        `sha256:${createHash("sha256").update(readFileSync(change.patch)).digest("hex")}`,
      ]),
  ),
  readingAgreesWithUpstream: summary.reference.wrong === 0,
  frozenHiddenOracle: oracle,
  named,
  summary,
  rows,
};
process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
