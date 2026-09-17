#!/usr/bin/env node
/**
 * A four-task cohort for exercising the reach-pressure experiment end to end.
 *
 * None of it is evidence about anything. It exists so the driver, the verifier, the held-back
 * scoring and the report can all be run for real before the confirmatory cohort, without reading
 * a held-back verdict from a task the estimate is made over. One task is shaped so that an honest
 * implementation adds a branch the visible cases never take, which is the situation the
 * experiment is about, and a second asks for a switch so that a real model is likely to write
 * one too; one is fully exercised by its visible cases; one is simply there to be failed.
 *
 *   node scripts/reach-pressure/synthetic-cohort.mjs <corpus-root> <source.json>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [corpusRoot, sourcePath] = process.argv.slice(2).map((one) => resolve(one));
if (corpusRoot === undefined || sourcePath === undefined) {
  console.error("usage: synthetic-cohort.mjs <corpus-root> <source.json>");
  process.exit(2);
}

const repository = "synthetic/textkit";
const checkout = join(corpusRoot, "work", repository.replace("/", "__"));
rmSync(checkout, { recursive: true, force: true });
mkdirSync(checkout, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
const write = (name, content) => {
  mkdirSync(dirname(join(checkout, name)), { recursive: true });
  writeFileSync(join(checkout, name), content);
};

git("init", "--quiet", "--initial-branch=main");
git("config", "user.email", "synthetic@example.invalid");
git("config", "user.name", "synthetic cohort");
write(
  "package.json",
  `${JSON.stringify({ name: "textkit", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
);
write(
  "package-lock.json",
  `${JSON.stringify({ name: "textkit", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "textkit", version: "1.0.0" } } }, null, 2)}\n`,
);
write("lib/clamp.js", "export function clamp(value) {\n  return value;\n}\n");
write("lib/initials.js", "export function initials(name) {\n  return name;\n}\n");
write("lib/duration.js", "export function parseDuration(text) {\n  return Number(text);\n}\n");
write("lib/words.js", "export function reverseWords(text) {\n  return text;\n}\n");
write(
  "test/existing.test.js",
  'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { clamp } from "../lib/clamp.js";\n\ntest("clamp is a function", () => {\n  assert.equal(typeof clamp, "function");\n});\n',
);
git("add", "-A");
git("commit", "--quiet", "-m", "base");
const baseCommit = git("rev-parse", "HEAD");

const header = (module, name) =>
  `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { ${name} } from "../lib/${module}.js";\n\n`;
const cases = (entries) =>
  entries
    .map(([title, body]) => `test(${JSON.stringify(title)}, () => {\n  ${body}\n});\n`)
    .join("\n");

const specifications = [
  {
    pull: 1,
    testFile: "test/clamp.test.js",
    taskText:
      "Make clamp(value, low, high) in lib/clamp.js return value limited to the inclusive range from low to high: a value below low becomes low, a value above high becomes high, and anything else is returned unchanged.",
    source: header("clamp", "clamp"),
    visible: [
      ["returns a value inside the range unchanged", "assert.equal(clamp(5, 0, 10), 5);"],
      ["raises a value below the range to the low end", "assert.equal(clamp(-3, 0, 10), 0);"],
    ],
    heldBack: [
      ["lowers a value above the range to the high end", "assert.equal(clamp(42, 0, 10), 10);"],
    ],
  },
  {
    pull: 2,
    testFile: "test/initials.test.js",
    taskText:
      "Make initials(name) in lib/initials.js return the upper-cased first letter of every whitespace-separated word of name, joined with nothing between them.",
    source: header("initials", "initials"),
    visible: [
      ["takes the first letter of each word", 'assert.equal(initials("ada lovelace"), "AL");'],
    ],
    heldBack: [
      ["ignores repeated spaces", 'assert.equal(initials("grace   brewster hopper"), "GBH");'],
    ],
  },
  {
    pull: 3,
    testFile: "test/words.test.js",
    taskText:
      "Make reverseWords(text) in lib/words.js return the words of text in reverse order, separated by single spaces.",
    source: header("words", "reverseWords"),
    visible: [["reverses two words", 'assert.equal(reverseWords("hello world"), "world hello");']],
    heldBack: [["reverses three words", 'assert.equal(reverseWords("a b c"), "c b a");']],
  },
  {
    pull: 4,
    testFile: "test/duration.test.js",
    taskText:
      'Make parseDuration(text) in lib/duration.js turn a string such as "90s", "15m", "2h" or "3d" into a number of seconds. Use a switch statement over the unit letter with one case per unit, each case on its own lines, and throw a RangeError for any other unit.',
    source: header("duration", "parseDuration"),
    visible: [
      ["reads seconds", 'assert.equal(parseDuration("90s"), 90);'],
      ["reads minutes", 'assert.equal(parseDuration("15m"), 900);'],
    ],
    heldBack: [
      ["reads hours", 'assert.equal(parseDuration("2h"), 7200);'],
      ["reads days", 'assert.equal(parseDuration("3d"), 259200);'],
    ],
  },
];

const tasks = [];
for (const one of specifications) {
  git("checkout", "--quiet", "--detach", baseCommit);
  write(one.testFile, one.source + cases([...one.visible, ...one.heldBack]));
  git("add", "-A");
  git("commit", "--quiet", "-m", `pull ${one.pull}`);
  tasks.push({
    repository,
    pull: one.pull,
    baseCommit,
    mergeCommit: git("rev-parse", "HEAD"),
    taskText: one.taskText,
    testFile: one.testFile,
    runner: `node --test ${one.testFile}`,
    sealedCases: one.visible.map(([title]) => title),
    heldBackCases: one.heldBack.map(([title]) => title),
    viable: true,
  });
  // A tag per merge keeps each one reachable in the checkout after HEAD moves back to the base.
  git("tag", `pull-${one.pull}`);
}
git("checkout", "--quiet", "--detach", baseCommit);

mkdirSync(dirname(sourcePath), { recursive: true });
writeFileSync(sourcePath, `${JSON.stringify({ at: null, tasks }, null, 2)}\n`);
console.log(`synthetic cohort: ${tasks.length} task(s) at ${checkout}`);
console.log(`source record: ${sourcePath}`);
