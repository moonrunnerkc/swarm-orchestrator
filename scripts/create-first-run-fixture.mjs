#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "swarm-first-run");
mkdirSync(directory);
writeFileSync(
  join(directory, "package.json"),
  `${JSON.stringify({ name: "swarm-first-run-fixture", private: true, type: "module", scripts: { test: "node --test split.test.mjs" } }, null, 2)}\n`,
);
writeFileSync(
  join(directory, "split.mjs"),
  "export function splitWords(text) { return text.split(/\\s+/); }\n",
);
writeFileSync(
  join(directory, "split.test.mjs"),
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { splitWords } from "./split.mjs";\ntest("splits words", () => assert.deepEqual(splitWords("one two"), ["one", "two"]));\n',
);
writeFileSync(
  join(directory, "TASK.txt"),
  "Add an exported trimmedWords(text) function that trims whitespace before splitting on whitespace. Empty or whitespace-only input must return an empty array. Add tests for all three cases. Preserve splitWords behavior.\n",
);
for (const argv of [
  ["init", "-q"],
  ["add", "."],
  [
    "-c",
    "user.name=Study fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Study baseline",
  ],
])
  execFileSync("git", argv, { cwd: directory, stdio: "pipe" });
execFileSync(process.execPath, ["--test", "split.test.mjs"], { cwd: directory, stdio: "inherit" });
console.log(`study fixture: ${directory}; this setup is not a first-user observation`);
