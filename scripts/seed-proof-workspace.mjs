#!/usr/bin/env node
/**
 * Writes the workspace the weekly evidence run works in.
 *
 * One small node project, committed, with a test that fails as committed because the function
 * under it has a real defect. The task text names that defect. What the run is judged on is
 * never whether the model fixes it: the criterion is that the bundle the run exports verifies
 * with its own verifier, whatever the model did. The seed is committed here rather than typed
 * into a workflow so the test beside it can show the defect is real and the task is solvable,
 * which is what makes a failed run the model's and not the seed's.
 *
 *   node scripts/seed-proof-workspace.mjs <directory>
 *
 * Prints the task to give the run.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const proofTask =
  "clamp in src/clamp.mjs returns the lower bound for a value above the upper bound. " +
  "Fix it so that npm test passes.";

export const seededFiles = {
  "package.json": `${JSON.stringify(
    {
      name: "proof-workspace",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    },
    null,
    2,
  )}\n`,
  "src/clamp.mjs": [
    "export function clamp(value, low, high) {",
    "  if (value < low) {",
    "    return low;",
    "  }",
    "  if (value > high) {",
    "    return low;",
    "  }",
    "  return value;",
    "}",
    "",
  ].join("\n"),
  "test/clamp.test.mjs": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { clamp } from "../src/clamp.mjs";',
    "",
    'test("a value below the range clamps to the lower bound", () => {',
    "  assert.equal(clamp(-1, 0, 10), 0);",
    "});",
    "",
    'test("a value above the range clamps to the upper bound", () => {',
    "  assert.equal(clamp(11, 0, 10), 10);",
    "});",
    "",
    'test("a value inside the range is returned as it is", () => {',
    "  assert.equal(clamp(5, 0, 10), 5);",
    "});",
    "",
  ].join("\n"),
};

/** The one-line change that makes the seeded test pass, kept so a test can show it exists. */
export const knownFix = {
  file: "src/clamp.mjs",
  from: "    return low;\n  }\n  return value;",
  to: "    return high;\n  }\n  return value;",
};

function git(directory, ...args) {
  const identity = ["-c", "user.name=proof", "-c", "user.email=proof@example.invalid"];
  const spawned = spawnSync("git", [...identity, "-c", "commit.gpgsign=false", ...args], {
    cwd: directory,
    encoding: "utf8",
  });
  if (spawned.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${directory}: ${spawned.stderr.trim()}`);
  }
  return spawned.stdout.trim();
}

/** Writes the files, commits them, and returns the base commit the run will be measured against. */
export function seedProofWorkspace(directory) {
  mkdirSync(directory, { recursive: true });
  for (const [path, content] of Object.entries(seededFiles)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(directory, "init", "-q");
  git(directory, "add", "--all");
  git(directory, "commit", "-q", "-m", "seed: a clamp that returns the wrong bound");
  return { directory, baseCommit: git(directory, "rev-parse", "HEAD"), task: proofTask };
}

if (import.meta.filename === process.argv[1]) {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error("usage: node scripts/seed-proof-workspace.mjs <directory>");
    process.exit(2);
  }
  const seeded = seedProofWorkspace(resolve(directory));
  console.error(`seeded ${seeded.directory} at ${seeded.baseCommit}`);
  console.log(seeded.task);
}
