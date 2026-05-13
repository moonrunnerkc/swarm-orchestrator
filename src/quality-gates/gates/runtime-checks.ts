import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GateResult, GateIssue } from '../types';

export interface RuntimeChecksConfig {
  enabled: boolean;
  /** Number of retry attempts for each check (0 = no retries) */
  retries: number;
  /** Run `npm test` or equivalent */
  runTests: boolean;
  /** Run `npx eslint .` if eslint config exists */
  runLint: boolean;
  /** Run `npm audit --audit-level=moderate` */
  runAudit: boolean;
  /** Timeout per command in ms (default 120000) */
  timeoutMs: number;
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  command: string;
}

/**
 * Execute a shell command with retry support.
 * Returns success/failure with captured output. Does not throw.
 */
function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  retries: number
): CommandResult {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stdout = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }
      });
      return { success: true, stdout, stderr: '', command };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        return {
          success: false,
          stdout: String(execErr.stdout || ''),
          stderr: String(execErr.stderr || ''),
          command
        };
      }
      // Brief pause before retry (1s, 2s)
      const delay = (attempt + 1) * 1000;
      execSync(`sleep ${delay / 1000}`, { stdio: 'pipe' });
    }
  }
  // Unreachable, but TypeScript needs it
  return { success: false, stdout: '', stderr: '', command };
}

/**
 * Detect whether the project has a test script in package.json.
 */
function hasScript(projectRoot: string, scriptName: string): boolean {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const script = pkg.scripts?.[scriptName];
    // Treat missing or stub scripts as absent
    return !!script && !script.includes('no test specified');
  } catch {
    return false;
  }
}

/**
 * Detect whether eslint config exists in the project.
 */
function hasEslintConfig(projectRoot: string): boolean {
  const candidates = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts'
  ];
  for (const name of candidates) {
    if (fs.existsSync(path.join(projectRoot, name))) return true;
  }
  // Check package.json eslintConfig field
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.eslintConfig) return true;
    } catch { /* ignore parse errors */ }
  }
  return false;
}

/**
 * Build the test command, appending ignore patterns for orchestrator
 * artifact directories. Without this, recursive test runners discover
 * duplicate test files inside runs/worktrees and fail on missing deps
 * or port collisions.
 */
export function buildTestCommand(projectRoot: string): string {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const testScript: string = pkg.scripts?.test || '';
    const isJest = testScript.includes('jest') || !!pkg.jest;
    if (isJest) {
      return 'npm test -- --testPathIgnorePatterns=runs/ --testPathIgnorePatterns=coverage/';
    }
    // Node.js built-in test runner discovers files recursively from cwd.
    // When the project has conventional test directories, scope discovery
    // to those directories so orchestrator artifacts are excluded.
    // Cannot use `npm test -- dir/` because npm rewrites the arg list
    // into `node dir/` (dropping --test). Use the runner directly.
    if (testScript.includes('node --test') && !testScript.includes('tests/') && !testScript.includes('test/')) {
      const testDirs: string[] = [];
      if (fs.existsSync(path.join(projectRoot, 'tests'))) testDirs.push("'tests/**/*.test.js'");
      if (fs.existsSync(path.join(projectRoot, 'test'))) testDirs.push("'test/**/*.test.js'");
      if (testDirs.length > 0) {
        return `node --test ${testDirs.join(' ')}`;
      }
    }
  } catch { /* fall through to plain npm test */ }
  return 'npm test';
}

/**
 * Hardcoded ignore list. Covers orchestrator artifact dirs (runs, plans,
 * proof, .quickfix), conventional build output (dist, build, coverage,
 * .next, .turbo, .cache), and dependency dirs (node_modules). The merge
 * with {@link readGitignoreTopLevelDirs} extends this with whatever the
 * project itself has marked unbuildable, so user scratch dirs and locally
 * cloned subrepos do not get linted as project source.
 */
const BUILTIN_LINT_IGNORE_DIRS: readonly string[] = [
  'dist', 'build', 'coverage', 'runs', 'plans',
  '.next', '.turbo', '.cache', 'proof', '.quickfix', 'node_modules',
];

/**
 * Read top-level directory entries from `.gitignore` so the lint scope
 * tracks what the project itself considers non-source. Without this,
 * a user who clones a sandbox repo into `comparison-runs/` or any other
 * gitignored scratch dir gets ESLint errors for code they do not own —
 * exactly the failure surfaced during the 2026-05 ow comparison run,
 * where two errors in the cloned upstream sources blocked the gate
 * with no actionable fix path.
 *
 * Parser scope is intentionally narrow:
 *   - Top-level (no slashes mid-path) directory or glob entries only.
 *   - Strips leading/trailing slashes, comments, blank lines, and
 *     negation lines (`!foo`) which would shrink the ignore set
 *     incorrectly without a fuller .gitignore evaluator.
 *
 * This matches how the rest of the gate already treats the ignore
 * list — a flat set of top-level prefixes fed to `--ignore-pattern`.
 *
 * @param projectRoot - Repo root to read `.gitignore` from.
 * @returns Top-level directory names (no trailing slashes), or [].
 */
export function readGitignoreTopLevelDirs(projectRoot: string): string[] {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  let body: string;
  try {
    body = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    return [];
  }
  const entries = new Set<string>();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    // Strip leading `/` so paths are repo-relative.
    const stripped = line.replace(/^\//, '').replace(/\/$/, '');
    // Only accept top-level entries: no slashes mid-path. A nested entry
    // like `src/generated/**` is not safely expressible as a top-level
    // `--ignore-pattern dir/` and would over-match; pass it through
    // ESLint's own .eslintignore loader instead.
    if (stripped === '' || stripped.includes('/')) continue;
    // Defensive: ESLint's --ignore-pattern interprets glob metacharacters.
    // A literal directory name like `dist` is safe; `*.log` is not a
    // directory and would mis-trigger the `dir + '/'` suffix logic.
    if (/[*?[\]]/.test(stripped)) continue;
    entries.add(stripped);
  }
  return [...entries];
}

/**
 * Build the ESLint command, scoping to agent-changed files when a baseline
 * commit is available. Without a baseline, falls back to scanning everything
 * but excludes orchestrator artifact directories AND every top-level entry
 * in the project's `.gitignore` so user scratch dirs and local sub-clones
 * are not linted as project source.
 */
export function buildEslintCommand(
  projectRoot: string,
  baseCommit?: string
): string | null {
  const ignoreDirs = [
    ...BUILTIN_LINT_IGNORE_DIRS,
    ...readGitignoreTopLevelDirs(projectRoot).filter(
      (entry) => !BUILTIN_LINT_IGNORE_DIRS.includes(entry),
    ),
  ];

  if (baseCommit) {
    try {
      const diffOutput = execSync(
        `git diff --name-only --diff-filter=ACMR ${baseCommit} HEAD`,
        { cwd: projectRoot, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      if (!diffOutput) return null;

      const lintableExts = /\.(js|ts|jsx|tsx|mjs|cjs)$/i;
      const changedFiles = diffOutput.split('\n')
        .filter(f => lintableExts.test(f))
        .filter(f => !ignoreDirs.some(d => f.startsWith(d + '/')));

      if (changedFiles.length === 0) return null;

      // Large diffs: fall back to full scan with directory exclusions
      if (changedFiles.length > 100) {
        const ignoreArgs = ignoreDirs.map(d => `--ignore-pattern '${d}/'`).join(' ');
        return `npx eslint . ${ignoreArgs} --max-warnings=0`;
      }

      const fileArgs = changedFiles.map(f => `'${f}'`).join(' ');
      return `npx eslint ${fileArgs} --max-warnings=0`;
    } catch {
      // git diff unavailable; fall through to full scan with ignores
    }
  }

  const ignoreArgs = ignoreDirs.map(d => `--ignore-pattern '${d}/'`).join(' ');
  return `npx eslint . ${ignoreArgs} --max-warnings=0`;
}

/**
 * Runtime quality gate: executes the project's own test suite, linter,
 * and security audit to validate the generated code actually works.
 *
 * Skipped checks (missing test script, no eslint config) are not failures.
 */
export async function run_runtime_checks_gate(
  projectRoot: string,
  config: RuntimeChecksConfig,
  baseCommit?: string
): Promise<GateResult> {
  const start = Date.now();
  const id = 'runtime-checks';
  const title = 'Runtime Checks (tests, lint, audit)';

  if (!config.enabled) {
    return { id, title, status: 'skip', durationMs: 0, issues: [] };
  }

  const issues: GateIssue[] = [];
  const stats: Record<string, number> = { testsRun: 0, lintRun: 0, auditRun: 0 };

  // --- npm test ---
  if (config.runTests) {
    if (hasScript(projectRoot, 'test')) {
      // Orchestrator artifacts (runs/, worktrees) can contain duplicate test
      // files that confuse recursive test runners like Jest. Append ignore
      // patterns so the gate only evaluates the project's own tests.
      const testCmd = buildTestCommand(projectRoot);
      const result = runCommand(testCmd, projectRoot, config.timeoutMs, config.retries);
      stats.testsRun = 1;
      if (!result.success) {
        const excerpt = (result.stderr || result.stdout).split('\n').slice(-15).join('\n').trim();
        issues.push({
          message: '`npm test` failed',
          hint: 'Fix failing tests before merge.',
          excerpt: excerpt.substring(0, 500)
        });
      }
    }
  }

  // --- eslint ---
  if (config.runLint) {
    if (hasEslintConfig(projectRoot)) {
      const eslintCmd = buildEslintCommand(projectRoot, baseCommit);
      if (eslintCmd) {
        const result = runCommand(eslintCmd, projectRoot, config.timeoutMs, config.retries);
        stats.lintRun = 1;
        if (!result.success) {
          const excerpt = (result.stdout || result.stderr).split('\n').slice(0, 20).join('\n').trim();
          issues.push({
            message: '`npx eslint` reported errors on agent-changed files',
            hint: 'Fix lint errors before merge.',
            excerpt: excerpt.substring(0, 500)
          });
        }
      }
    }
  }

  // --- npm audit ---
  if (config.runAudit) {
    // npm audit requires a lockfile; skip for projects with no dependencies
    if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) {
      const result = runCommand(
        'npm audit --audit-level=moderate --omit=dev',
        projectRoot,
        config.timeoutMs,
        config.retries
      );
      stats.auditRun = 1;
      if (!result.success) {
        const excerpt = (result.stdout || result.stderr).split('\n').slice(0, 15).join('\n').trim();
        issues.push({
          message: '`npm audit` found moderate+ vulnerabilities',
          hint: 'Run `npm audit fix` or address manually.',
          excerpt: excerpt.substring(0, 500)
        });
      }
    }
  }

  const durationMs = Date.now() - start;
  const status = issues.length > 0 ? 'fail' : 'pass';

  return { id, title, status, durationMs, issues, stats };
}
