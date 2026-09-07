#!/usr/bin/env node
/**
 * Mines tasks with two oracles out of merged pull requests.
 *
 * Gate 3 wants zero false greens over hundreds of tasks, and a task needs a base commit, a
 * statement of what to do, an oracle handed to the tool and a second held back from it. Writing
 * four hundred of those by hand is the corpus campaign this avoids. A merged pull request that
 * adds a feature with tests already carries all four: its parent is the base, its title and body
 * are the task, and the test cases it added are a specification its own maintainers wrote, split
 * alternately into the two oracles.
 *
 * This phase is API only and cheap. It proposes candidates; it does not establish that any of
 * them work, which is what check-pr-task-viability.mjs does by running them.
 *
 *   node scripts/mine-pr-tasks.mjs [--repos <n>] [--per-repo <n>] [--out <file>]
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { splitTestCases } from "../dist/eval/test-case-split.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;

const argv = process.argv.slice(2);
const numeric = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : Number(argv[at + 1]);
};
const outAt = argv.indexOf("--out");
const outPath =
  outAt === -1 ? join(repositoryRoot, "campaign/pr-tasks/candidates.json") : argv[outAt + 1];

const isTestPath = (path) =>
  /(^|\/)(__tests__|tests?|spec)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
const isSourcePath = (path) =>
  /\.[cm]?[jt]sx?$/.test(path) && !isTestPath(path) && !/\.d\.ts$/.test(path);

async function gh(path, parameters = {}) {
  const query = Object.entries(parameters)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const { stdout } = await run("gh", ["api", query ? `${path}?${query}` : path], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/**
 * The task text a run is given. Code blocks come out because a body that pastes the patch hands
 * the model the answer, and a task whose text contains its own solution measures nothing.
 */
function taskTextFrom(pull) {
  const body = (pull.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${pull.title.trim()}. ${body}`.trim().slice(0, 1200);
}

/** The lines a diff added, which for a test file is the cases the pull request wrote. */
function addedLines(patch) {
  return (patch ?? "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

const selection = JSON.parse(
  readFileSync(join(repositoryRoot, "campaign/selection/repos.json"), "utf8"),
);
const repositories = (Array.isArray(selection) ? selection : Object.values(selection)[0])
  .filter((one) => one.accepted !== false && /JavaScript|TypeScript/.test(one.language ?? ""))
  .slice(0, numeric("--repos", 12));

console.log(`mining ${repositories.length} repositories, API only\n`);

const candidates = [];
for (const repository of repositories) {
  let pulls = [];
  try {
    pulls = await gh(`repos/${repository.fullName}/pulls`, {
      state: "closed",
      per_page: 100,
      sort: "updated",
      direction: "desc",
    });
  } catch (cause) {
    console.log(`${repository.fullName.padEnd(40)} pulls unavailable: ${String(cause).slice(0, 80)}`);
    continue;
  }

  let found = 0;
  const wanted = numeric("--per-repo", 6);
  for (const pull of pulls) {
    if (found >= wanted) break;
    if (pull.merged_at === null || pull.merge_commit_sha === null) continue;
    if ((pull.body ?? "").trim().length < 40) continue;

    let files = [];
    try {
      files = await gh(`repos/${repository.fullName}/pulls/${pull.number}/files`, { per_page: 100 });
    } catch {
      continue;
    }
    const testFiles = files.filter((file) => isTestPath(file.filename) && file.patch !== undefined);
    const sourceFiles = files.filter((file) => isSourcePath(file.filename));
    if (testFiles.length === 0 || sourceFiles.length === 0) continue;

    const changed = files.reduce((total, file) => total + file.changes, 0);
    if (changed > 400) continue;

    // One test file, so the two oracles are two halves of one specification rather than two
    // files that may not even cover the same thing.
    const [onlyTestFile] = testFiles;
    if (testFiles.length !== 1 || onlyTestFile === undefined) continue;
    const split = splitTestCases(addedLines(onlyTestFile.patch));
    if (!split.splittable) continue;

    candidates.push({
      repository: repository.fullName,
      cloneUrl: repository.cloneUrl,
      pull: pull.number,
      mergeCommit: pull.merge_commit_sha,
      taskText: taskTextFrom(pull),
      testFile: onlyTestFile.filename,
      sourceFiles: sourceFiles.map((file) => file.filename),
      changedLines: changed,
      sealedCases: split.sealed.map((one) => one.title),
      heldBackCases: split.heldBack.map((one) => one.title),
    });
    found += 1;
  }
  console.log(`${repository.fullName.padEnd(40)} ${found} candidate(s)`);
}

writeFileSync(outPath, `${JSON.stringify({ at: new Date().toISOString(), candidates }, null, 2)}\n`);
console.log(`\n${candidates.length} candidate(s) written: ${outPath}`);
console.log("None of these is known to work yet. Run scripts/check-pr-task-viability.mjs next.");
