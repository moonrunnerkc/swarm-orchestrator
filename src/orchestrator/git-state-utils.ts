import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';

const logger = getLogger('orchestrator');

/**
 * Clean up leftover git state from crashed runs: abort pending merges,
 * reset staged/unmerged index entries, and restore working tree files.
 * Prevents cascading failures when binary files (e.g. .pyc, .db) from
 * a previous merge conflict block branch creation or verification commits.
 *
 * @param workingDir - repository root where the git operations run
 */
export function sanitizeGitState(workingDir: string): void {
  const opts = { cwd: workingDir, stdio: 'pipe' as const, encoding: 'utf8' as const };

  try {
    execSync('git merge --abort', opts);
    logger.info('  [cleanup] Aborted in-progress merge from previous run');
  } catch { /* no merge in progress; expected */ }

  // Check for unmerged or staged entries that would block new operations
  try {
    const status = execSync('git status --porcelain', opts).trim();
    const hasUnmerged = status.split('\n').some(line => line.startsWith('U') || line.startsWith('AA') || line.startsWith('DD'));
    if (hasUnmerged) {
      execSync('git reset HEAD', opts);
      execSync('git checkout -- .', opts);
      logger.info('  [cleanup] Reset unmerged files from previous crashed run');
    }
  } catch { /* status check failed; not critical */ }

  // Prune stale worktrees left by previous crashes
  try {
    execSync('git worktree prune', opts);
  } catch { /* prune failed; not critical */ }
}

/**
 * Detect whether agents introduced new dependencies and install them.
 * Runs after all branches are merged but before quality gates so that
 * `npm test` has access to any newly-added packages.
 *
 * @param workingDir - repository root with package.json and node_modules
 */
export async function installDependenciesIfNeeded(workingDir: string): Promise<void> {
  const pkgPath = path.join(workingDir, 'package.json');
  const nodeModulesPath = path.join(workingDir, 'node_modules');

  if (!fs.existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (Object.keys(allDeps).length === 0) return;

    // Check if any declared dependency is missing from node_modules
    const missing = Object.keys(allDeps).filter(dep => {
      return !fs.existsSync(path.join(nodeModulesPath, dep));
    });

    if (missing.length === 0) return;

    logger.info(`\n📦 Installing ${missing.length} new dependenc${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`);

    // Use the right package manager for the project
    const installCmd = fs.existsSync(path.join(workingDir, 'yarn.lock'))
      ? 'yarn install --frozen-lockfile 2>/dev/null || yarn install'
      : fs.existsSync(path.join(workingDir, 'pnpm-lock.yaml'))
        ? 'pnpm install --no-frozen-lockfile'
        : 'npm install --loglevel=error';

    execSync(installCmd, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    logger.info('  ✅ Dependencies installed');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`  ⚠️  Dependency install failed (quality gates may report test failures): ${msg}`);
  }
}
