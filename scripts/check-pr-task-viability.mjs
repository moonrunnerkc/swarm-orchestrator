#!/usr/bin/env node
/**
 * Decides which mined pull requests are usable tasks, by running them rather than by reading them.
 *
 * A mined candidate is only a task if its tests actually specify the feature it added. That is
 * checkable without a person: put the pull request's test file on the unchanged base source and
 * the added cases must fail, because a case that passes before the feature exists is not testing
 * the feature; then take the pull request's source as well and they must pass. A candidate that
 * fails either direction is dropped with the direction named.
 *
 * This is the filter that makes the corpus self-certifying, and it is why no part of building it
 * asks anybody to label anything.
 *
 *   node scripts/check-pr-task-viability.mjs [--limit <n>] [--only <owner/repo>]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;
const workRoot = join(repositoryRoot, "campaign/pr-tasks/work");
const candidatesPath = join(repositoryRoot, "campaign/pr-tasks/candidates.json");
const judgedPath = join(repositoryRoot, "campaign/pr-tasks/viable.json");

const argv = process.argv.slice(2);
const limitAt = argv.indexOf("--limit");
const limit = limitAt === -1 ? Number.POSITIVE_INFINITY : Number(argv[limitAt + 1]);
const onlyAt = argv.indexOf("--only");
const only = onlyAt === -1 ? null : argv[onlyAt + 1];

async function attempt(file, args, options) {
  try {
    const done = await run(file, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return { code: 0, stdout: done.stdout, stderr: done.stderr };
  } catch (cause) {
    return {
      code: typeof cause.code === "number" ? cause.code : 1,
      stdout: `${cause.stdout ?? ""}`,
      stderr: `${cause.stderr ?? cause.message ?? ""}`,
    };
  }
}

/** How this repository runs one test file, read off its devDependencies rather than guessed. */
function runnerFor(checkout, testFile) {
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
  if (dependencies.jest !== undefined) return ["npx", ["jest", "--ci", testFile]];
  if (dependencies.vitest !== undefined) return ["npx", ["vitest", "run", testFile]];
  if (dependencies.mocha !== undefined) return ["npx", ["mocha", testFile]];
  if (dependencies.ava !== undefined) return ["npx", ["ava", testFile]];
  return ["node", ["--test", testFile]];
}

const { candidates } = JSON.parse(readFileSync(candidatesPath, "utf8"));
const judged = existsSync(judgedPath)
  ? JSON.parse(readFileSync(judgedPath, "utf8"))
  : { at: null, tasks: [] };
const alreadyJudged = new Set(judged.tasks.map((one) => `${one.repository}#${one.pull}`));

mkdirSync(workRoot, { recursive: true });
const wanted = candidates.filter(
  (one) =>
    !alreadyJudged.has(`${one.repository}#${one.pull}`) &&
    (only === null || one.repository === only),
);
console.log(`checking ${Math.min(wanted.length, limit)} candidate(s) by running them\n`);

let checked = 0;
for (const candidate of wanted) {
  if (checked >= limit) break;
  checked += 1;
  const checkout = join(workRoot, candidate.repository.replace("/", "__"));
  const label = `${candidate.repository}#${candidate.pull}`;
  const record = { ...candidate, viable: false, why: "" };

  if (!existsSync(checkout)) {
    const cloned = await attempt("git", ["clone", "--quiet", candidate.cloneUrl, checkout], {
      cwd: workRoot,
      timeout: 10 * 60_000,
    });
    if (cloned.code !== 0) {
      record.why = `clone failed: ${cloned.stderr.slice(0, 160)}`;
      judged.tasks.push(record);
      console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
      continue;
    }
  }

  const fetched = await attempt("git", ["fetch", "--quiet", "origin", candidate.mergeCommit], {
    cwd: checkout,
    timeout: 10 * 60_000,
  });
  if (fetched.code !== 0) {
    record.why = "the merge commit is not fetchable (force-pushed or deleted)";
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  const parent = await attempt("git", ["rev-parse", `${candidate.mergeCommit}^1`], { cwd: checkout });
  if (parent.code !== 0) {
    record.why = "the merge commit has no first parent to use as a base";
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }
  const base = parent.stdout.trim();
  record.baseCommit = base;

  await attempt("git", ["checkout", "--quiet", "--force", "--detach", base], { cwd: checkout });
  await attempt("git", ["clean", "-qfd"], { cwd: checkout });

  const installed = await attempt("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: checkout,
    timeout: 15 * 60_000,
  });
  if (installed.code !== 0) {
    record.why = `npm ci failed at the base: ${installed.stderr.slice(-160)}`;
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  const runner = runnerFor(checkout, candidate.testFile);
  if (runner === null) {
    record.why = "no package.json to read a runner from";
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }
  record.runner = [runner[0], ...runner[1]].join(" ");

  // The pull request's tests on the unchanged base source. They have to fail: a case that passes
  // before the feature exists is not a specification of the feature.
  await attempt("git", ["checkout", "--quiet", candidate.mergeCommit, "--", candidate.testFile], {
    cwd: checkout,
  });
  const onBase = await attempt(runner[0], runner[1], { cwd: checkout, timeout: 10 * 60_000 });
  if (onBase.code === 0) {
    record.why = "the added tests already pass on the base source, so they specify nothing new";
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  // The whole merged tree. They have to pass, or the tests are not a reachable target.
  await attempt("git", ["checkout", "--quiet", "--force", "--detach", candidate.mergeCommit], {
    cwd: checkout,
  });
  const onMerge = await attempt(runner[0], runner[1], { cwd: checkout, timeout: 10 * 60_000 });
  if (onMerge.code !== 0) {
    record.why = "the added tests do not pass on the merged tree either, so the target is unclear";
    judged.tasks.push(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  record.viable = true;
  record.why = "fails on the base source, passes on the merged tree";
  judged.tasks.push(record);
  console.log(`  KEEP  ${label.padEnd(42)} ${record.runner}`);
}

judged.at = new Date().toISOString();
writeFileSync(judgedPath, `${JSON.stringify(judged, null, 2)}\n`);
const viable = judged.tasks.filter((one) => one.viable);
console.log(`\n${viable.length} viable of ${judged.tasks.length} judged: ${judgedPath}`);
