// Mine bug-fix commits with tests from a repository and validate each candidate with no model:
// the parent (base) must fail the commit's own test files, the commit must pass `npm test`.
//   node mine.mjs <owner/repo> <work-dir> [max-candidates]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [repository, workDir, maxText] = process.argv.slice(2);
const max = Number(maxText ?? 6);
mkdirSync(workDir, { recursive: true });
const clone = join(workDir, repository.replace("/", "__"));
const run = (argv, cwd, extra = {}) => {
  const ran = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false" },
    ...extra,
  });
  return { status: ran.status, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
};
if (!existsSync(clone)) {
  const cloned = run(["git", "clone", "--quiet", `https://github.com/${repository}`, clone], workDir);
  if (cloned.status !== 0) throw new Error(`clone failed: ${cloned.stderr}`);
}
const log = run(["git", "log", "--no-merges", "--format=%H%x09%s", "-n", "1200"], clone).stdout.trim().split("\n");
const candidates = [];
for (const line of log) {
  const [sha, subject] = line.split("\t");
  if (!/\bfix/i.test(subject) || /\b(deps|dependency|ci|release|docs|typo|lint|chore)\b/i.test(subject)) continue;
  // The harness installs every workspace from the base's own lockfile; a base without one is not launchable.
  if (run(["git", "cat-file", "-e", `${sha}^:package-lock.json`], clone).status !== 0) continue;
  const files = run(["git", "diff", "--name-only", `${sha}^`, sha], clone).stdout.trim().split("\n").filter(Boolean);
  const tests = files.filter((f) => /(^|\/)(test|tests)\/.*\.(m?js|ts)$/.test(f) && !/fixtures?\//.test(f));
  const sources = files.filter((f) => /^(lib|src|bin)\//.test(f) || /^[^/]+\.(m?js|ts)$/.test(f));
  const other = files.filter((f) => !tests.includes(f) && !sources.includes(f) && !/^(CHANGELOG|README)/i.test(f) && !/^package(-lock)?\.json$/.test(f));
  if (tests.length === 0 || sources.length === 0 || sources.length > 3 || other.length > 0) continue;
  const stat = run(["git", "diff", "--shortstat", `${sha}^`, sha, "--", ...sources], clone).stdout.trim();
  candidates.push({ sha, subject, tests, sources, stat });
}
console.log(`${repository}: ${candidates.length} candidate(s) with source and test changes`);
const results = [];
for (const candidate of candidates.slice(0, max)) {
  const tree = join(workDir, `tree-${candidate.sha.slice(0, 9)}`);
  rmSync(tree, { recursive: true, force: true });
  run(["git", "worktree", "prune"], clone);
  const added = run(["git", "worktree", "add", "--detach", "--quiet", tree, `${candidate.sha}^`], clone);
  if (added.status !== 0) {
    results.push({ ...candidate, verdict: "worktree failed", detail: added.stderr.slice(0, 200) });
    continue;
  }
  const row = { ...candidate, base: run(["git", "rev-parse", "HEAD"], tree).stdout.trim() };
  try {
    const manifest = JSON.parse(readFileSync(join(tree, "package.json"), "utf8"));
    row.testScript = manifest.scripts?.test ?? null;
    row.packageManager = manifest.packageManager ?? null;
    const install = run(["npm", "ci", "--ignore-scripts"], tree);
    if (install.status !== 0) {
      row.verdict = "install failed";
      row.detail = install.stderr.slice(-400);
      continue;
    }
    // Overlay the commit's test files on the base and run only them, without coverage.
    for (const path of candidate.tests) {
      const shown = run(["git", "show", `${candidate.sha}:${path}`], clone);
      mkdirSync(dirname(join(tree, path)), { recursive: true });
      writeFileSync(join(tree, path), shown.stdout);
    }
    const runner = /\btap\b/.test(row.testScript ?? "") ? ["npx", "tap", "run", "--disable-coverage", ...candidate.tests] : ["node", "--test", ...candidate.tests];
    const baseHidden = run(runner, tree);
    row.hiddenArgv = runner.join(" ");
    row.baseHiddenExit = baseHidden.status;
    row.baseHiddenTail = `${baseHidden.stdout}\n${baseHidden.stderr}`.trim().split("\n").slice(-6).join("\n");
    // The base's own tests, with coverage, as the project runs them (must pass for a task to be launchable).
    run(["git", "checkout", "--quiet", "--", "."], tree);
    for (const path of candidate.tests) {
      const atBase = run(["git", "cat-file", "-e", `${row.base}:${path}`], clone).status === 0;
      if (!atBase) rmSync(join(tree, path), { force: true });
    }
    const baseProject = run(["npm", "test"], tree);
    row.baseProjectExit = baseProject.status;
    // The commit itself, complete.
    run(["git", "checkout", "--quiet", "--detach", candidate.sha], tree);
    const install2 = run(["npm", "ci", "--ignore-scripts"], tree);
    if (install2.status !== 0) {
      row.verdict = "install at upstream failed";
      continue;
    }
    const upstreamProject = run(["npm", "test"], tree);
    row.upstreamProjectExit = upstreamProject.status;
    row.upstreamTail = `${upstreamProject.stdout}\n${upstreamProject.stderr}`.trim().split("\n").slice(-4).join("\n");
    row.verdict =
      row.baseHiddenExit !== 0 && row.baseProjectExit === 0 && row.upstreamProjectExit === 0 ? "VALID" : "invalid";
  } catch (cause) {
    row.verdict = "error";
    row.detail = String(cause).slice(0, 300);
  } finally {
    results.push(row);
    run(["git", "worktree", "remove", "--force", tree], clone);
    console.log(`${row.verdict ?? "?"} ${candidate.sha.slice(0, 9)} ${candidate.subject} | base hidden ${row.baseHiddenExit} base project ${row.baseProjectExit} upstream ${row.upstreamProjectExit} | ${candidate.sources.join(",")} ${candidate.stat}`);
  }
}
writeFileSync(join(workDir, `${repository.replace("/", "__")}.candidates.json`), `${JSON.stringify(results, null, 2)}\n`);
