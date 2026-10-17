#!/usr/bin/env node
/**
 * Coverage audit of the css-select :lang() task after scoring, as the protocol registered: the
 * frozen oracle (the upstream tests) does not exercise singleton subtags, empty language values
 * or xml:lang precedence, which the task text states. Each delivered patch and the maintainer's
 * reference is built from the pinned base and run on a fixed table of cases taken from the task
 * text; the expected answer of each case is quoted from that text. This changes no score.
 *
 *   node audit-css-select.mjs --repo <mirror or url> --work <empty directory> > audit-css-select.json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { repo: { type: "string" }, work: { type: "string" } } });
if (values.repo === undefined || values.work === undefined)
  throw new Error("usage: audit-css-select.mjs --repo <git url or path> --work <empty directory>");
const work = resolve(values.work);
mkdirSync(work, { recursive: true });
if (readdirSync(work).length > 0) throw new Error(`${work} is not empty`);

const base = "cd6625464a17281794a65cb034833c6e2f85856f";
const upstream = "b77508c9fa4523207628f07c5318ac1168a26eeb";
const patches = join(here, "..", "stage-a", "patches");
const variants = {
  reference: { upstream: "src/pseudo-selectors/filters.ts" },
  "swarm-r1": { patch: join(patches, "css-select-feature-lang-r1.swarm.patch") },
  "swarm-r2": { patch: join(patches, "css-select-feature-lang-r2.swarm.patch") },
  "opencode-r1": { patch: join(patches, "css-select-feature-lang-r1.opencode.patch") },
  "opencode-r2": { patch: join(patches, "css-select-feature-lang-r2.opencode.patch") },
};
const sh = (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, stdio: "pipe" }).toString();

// Each case: a document, a selector, the ids it must select, and the sentence of the task text
// that decides it.
const cases = [
  ["inherits", '<div lang="en-US"><p id="a"></p></div><p id="b" lang="fr"></p><p id="c"></p>', "p:lang(en)", ["a"], "matches ... lang=\"en-US\" (and their descendants without their own lang)"],
  ["not-prefix-of-word", '<p id="a" lang="eng"></p><p id="b" lang="en"></p>', "p:lang(en)", ["b"], "but not lang=\"eng\""],
  ["extended", '<p id="a" lang="de-DE"></p><p id="b" lang="de-Latn-DE"></p><p id="c" lang="de-Latn-DE-1996"></p><p id="d" lang="de"></p>', "p:lang(de-DE)", ["a", "b", "c"], ":lang(de-DE) matches \"de-DE\", \"de-Latn-DE\" and \"de-Latn-DE-1996\""],
  ["singleton-stops", '<p id="a" lang="de-x-DE"></p><p id="b" lang="de-Latn-DE"></p>', "p:lang(de-DE)", ["b"], "reaching a one-character (singleton) subtag fails the match"],
  ["wildcard-first", '<p id="a" lang="de-CH"></p><p id="b" lang="fr-CH"></p><p id="c" lang="fr-FR"></p>', "p:lang(\\*-CH)", ["a", "b"], ":lang(\\*-CH) matches \"de-CH\" and \"fr-CH\" but not \"fr-FR\""],
  ["list", '<p id="a" lang="en"></p><p id="b" lang="fr"></p><p id="c" lang="de"></p>', "p:lang(en, fr)", ["a", "b"], ":lang(en, fr) matches either language"],
  ["quotes", '<p id="a" lang="en"></p><p id="b" lang="fr"></p>', "p:lang(\"en\")", ["a"], "surrounding single or double quotes are removed"],
  ["empty-entry", '<p id="a" lang="en"></p><p id="b" lang="fr"></p>', "p:lang(en,,fr)", ["a", "b"], "an empty entry is ignored"],
  ["case", '<p id="a" lang="EN-us"></p>', "p:lang(en-US)", ["a"], "matching is case-insensitive"],
  ["xml-lang-first", '<p id="a" xml:lang="fr" lang="en"></p>', "p:lang(fr)", ["a"], "its own xml:lang attribute if it has one, else its own lang attribute"],
  ["no-language", '<p id="a"></p><p id="b" lang="en"></p>', "p:lang(\"\")", ["a"], "an element with no such attribute ... matches only an empty range"],
  ["no-language-not-en", '<p id="a"></p>', "p:lang(en)", [], "matches only an empty range"],
  ["empty-value", '<div lang="en"><p id="a" lang=""></p></div>', "p:lang(en)", [], "whose nearest value is the empty string (lang=\"\"), matches only an empty range"],
  ["empty-value-empty-range", '<div lang="en"><p id="a" lang=""></p></div>', "p:lang(\"\")", ["a"], "matches only an empty range (such as :lang(\"\"))"],
];

const results = {};
for (const [name, change] of Object.entries(variants)) {
  const directory = join(work, name);
  sh(["git", "clone", "-q", values.repo, directory], work);
  sh(["git", "-c", "advice.detachedHead=false", "checkout", "-q", base], directory);
  if (change.upstream !== undefined) sh(["git", "checkout", upstream, "--", change.upstream], directory);
  if (change.patch !== undefined) sh(["git", "apply", change.patch], directory);
  sh(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], directory);
  sh(["npm", "run", "build"], directory);
  const require = createRequire(join(directory, "package.json"));
  const { parseDocument } = await import(pathToFileURL(require.resolve("htmlparser2")).href);
  const { selectAll } = await import(pathToFileURL(join(directory, "dist", "index.js")).href);
  results[name] = cases.map(([id, html, selector, expected]) => {
    let got;
    try {
      got = selectAll(selector, parseDocument(html)).map((element) => element.attribs.id);
    } catch (cause) {
      got = `threw: ${cause.message}`;
    }
    return { id, got, pass: JSON.stringify(got) === JSON.stringify(expected) };
  });
}

const summary = Object.fromEntries(
  Object.entries(results).map(([name, rows]) => [
    name,
    { cases: rows.length, wrong: rows.filter((row) => !row.pass).map((row) => row.id) },
  ]),
);
writeFileSync(1, `${JSON.stringify({ schema: "swarm-css-select-lang-audit.v1", base, upstream, cases: cases.map(([id, html, selector, expected, basis]) => ({ id, html, selector, expected, basis })), summary, results }, null, 1)}\n`);
