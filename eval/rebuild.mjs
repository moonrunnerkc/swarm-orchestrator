/**
 * Measures the tree the verifier-first rebuild started from and the tree at HEAD the way the
 * caps count them: non-test TypeScript lines under src/, runtime dependencies and subcommands,
 * read from git, plus the wall time of each tree's own `npm test` after `npm ci` in a scratch
 * worktree. Writes eval/results/rebuild-<time>.json, which docs/results.md reports.
 *
 *   node eval/rebuild.mjs [--before <commit>] [--after <commit>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });

/** The parent of the commit that started the rebuild. */
function rebuildBase() {
  const cut = git("log", "--format=%H", "--grep=^Cut the repository down to the verifier", "-1");
  return git("rev-parse", "--short", `${cut.trim()}^`).trim();
}

function lineCount(text) {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** What the caps measure, read from the commit itself rather than a checkout. */
export function staticMeasures(commit) {
  const files = git("ls-tree", "-r", "--name-only", commit, "--", "src")
    .split("\n")
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
  let lines = 0;
  for (const path of files) lines += lineCount(git("show", `${commit}:${path}`));
  const manifest = JSON.parse(git("show", `${commit}:package.json`));
  const definitions = git("show", `${commit}:src/cli-command-definitions.ts`);
  return {
    commit,
    srcNonTestLines: lines,
    runtimeDependencies: Object.keys(manifest.dependencies ?? {}).length,
    subcommands: (definitions.match(/^ {4}name: "/gm) ?? []).length,
  };
}

/** `npm ci`, then the wall time of `npm test`, in a detached worktree of the commit. */
function testSuite(commit) {
  const dir = mkdtempSync(join(tmpdir(), "swarm-rebuild-"));
  const tree = join(dir, "tree");
  try {
    git("worktree", "add", "--detach", "--quiet", tree, commit);
    const installed = spawnSync("npm", ["ci", "--silent"], { cwd: tree, encoding: "utf8" });
    if (installed.status !== 0) return { seconds: null, exitCode: null, note: "npm ci failed" };
    const started = process.hrtime.bigint();
    const ran = spawnSync("npm", ["test", "--silent"], { cwd: tree, encoding: "utf8" });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const summary = `${ran.stdout}${ran.stderr}`.match(/Tests\s+([^\n]+)/)?.[1]?.trim() ?? null;
    return { seconds: Math.round(seconds * 10) / 10, exitCode: ran.status, summary };
  } finally {
    git("worktree", "remove", "--force", tree);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: { before: { type: "string" }, after: { type: "string" } },
  });
  const before = values.before ?? rebuildBase();
  const after = values.after ?? git("rev-parse", "--short", "HEAD").trim();
  const generatedAt = new Date().toISOString();
  const result = {
    generatedAt,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    before: { ...staticMeasures(before), testSuite: testSuite(before) },
    after: { ...staticMeasures(after), testSuite: testSuite(after) },
  };
  const file = join(root, "eval", "results", `rebuild-${generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\nwrote ${file}\n`);
}
