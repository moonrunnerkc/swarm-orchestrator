/**
 * Reserved paths for per-step commit-level exclusion (issue #27 / PR 2).
 *
 * Mirrors benchmarks/swe-bench/evaluation-scripts/worktree_reserved_paths.py
 * one-for-one so that commit-time exclusion (TS side) stays in parity with
 * capture-time exclusion (Python side). If you update one, update the other.
 *
 * Three categories tracked separately so audit decisions stay legible:
 *
 *   ORCHESTRATOR_RESERVED_PATHS — paths this codebase writes to during normal
 *   operation. Scraped from src/**\/*.ts. Update when a new code path starts
 *   writing to a new top-level directory inside the worktree.
 *
 *   BUILD_ARTIFACT_RESERVED_PATHS — paths universal build tooling writes
 *   (package managers, compilers, test runners, venv tools). Not
 *   orchestrator-specific; reasonable to exclude from any commit regardless.
 *
 *   FILE_GLOB_EXCLUDES — pure file-glob patterns (not directory prefixes).
 *   Appended separately from the directory dual-form expansion below.
 *
 * The consumer is gitPathspecExcludes(), which is called at the per-step
 * commit site in swarm-orchestrator.ts. See the parity test in
 * test/worktree-reserved-paths.test.ts for the cross-language invariant.
 */

export const ORCHESTRATOR_RESERVED_PATHS: ReadonlyArray<string> = [
  // runDir tree — holds everything orchestrator-scoped:
  //   .context/shared-context.json (per-step manifest)
  //   .locks/ (git serialization locks)
  //   worktrees/step-N/ (per-step isolated worktrees)
  //   steps/step-N/share.md (transcripts)
  //   session-state.json, metrics.json, cost-attribution.json
  //   quality-gates/ (gate output)
  // Excluding "runs" excludes every nested path; no need to list sub-dirs.
  'runs',
  // quick-fix-mode session scratch (src/quick-fix-mode.ts)
  '.quickfix',
  // CLI plan commands write plan-*.json here
  // (src/plan-files.ts)
  'plans',
];

export const BUILD_ARTIFACT_RESERVED_PATHS: ReadonlyArray<string> = [
  // Node
  'node_modules',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  'env',
  // JS build tools
  '.next',
  '.turbo',
  '.cache',
  // Generic build output
  'dist',
  'build',
  // Test coverage
  'coverage',
];

export const FILE_GLOB_EXCLUDES: ReadonlyArray<string> = [
  '**/*.pyc',
  '**/*.pyo',
  '**/*.egg-info',
  '**/*.egg-info/**',
  // .copilot-instructions.md — written to the repo root by prompt-builder.ts
  // and committed before step-1 runs. Orchestrator scaffolding, not agent work.
  // Must be excluded from SWE-bench patches or `git apply` fails in /testbed.
  // Mirrors Python _FILE_GLOB_EXCLUDES entry added in smoke8 post-mortem fix.
  '.copilot-instructions.md',
];

/**
 * Return git pathspec :(exclude) directives covering every reserved path.
 *
 * For each directory entry, emits both the top-level form (`:(exclude)runs`)
 * and a tree glob (`:(exclude)runs/**`). Git requires both when the exclude
 * should match the directory itself AND everything under it; the top-level
 * form alone can miss deeply nested files on some git versions.
 *
 * Emission count: 14 directories × 2 (dual-form) + 4 file globs = 32 args.
 * Matches Python's git_pathspec_excludes() output one-for-one.
 *
 * Consumers pass this list as trailing arguments to `git add` after a
 * positive pathspec (typically `--`). Note: git add for commits does NOT
 * need the `.` positive pathspec that capture uses; `git add -A` already
 * stages the whole tree and the excludes suppress the reserved paths.
 */
export function gitPathspecExcludes(): string[] {
  const directoryExcludes = [
    ...ORCHESTRATOR_RESERVED_PATHS,
    ...BUILD_ARTIFACT_RESERVED_PATHS,
  ].flatMap(dir => [`:(exclude)${dir}`, `:(exclude)${dir}/**`]);

  const globExcludes = FILE_GLOB_EXCLUDES.map(g => `:(exclude)${g}`);

  return [...directoryExcludes, ...globExcludes];
}
