// Build a frozen pre-upgrade auditor so the real-PR run has an honest
// side-by-side. The pre-upgrade code is the last pre-oracle release tag;
// we build it in a throwaway git worktree and return the path to its CLI.
// The binary is never committed (only this script is); a consumer
// regenerates it on demand. If the build fails (old deps under a newer
// Node, network), the caller records the pre-upgrade side as unavailable
// rather than faking it.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { repoRoot } from './lib/paths';

const log = getLogger('real-prs:pre-upgrade');

// The last release before the v11 oracle / judge-primary work. This is
// the "pre-upgrade" auditor the report compares against.
export const PRE_UPGRADE_TAG = 'v10.3.0-advisory';

function worktreeDir(): string {
  return path.join(os.tmpdir(), `swarm-pre-upgrade-${PRE_UPGRADE_TAG.replace(/[^a-z0-9.-]/gi, '-')}`);
}

function builtCliPath(dir: string): string {
  return path.join(dir, 'dist', 'src', 'cli.js');
}

/**
 * Ensure a built pre-upgrade CLI exists and return its path, or null if
 * the build could not be produced. Idempotent: a prior successful build
 * is reused.
 */
export function ensurePreUpgradeCli(): string | null {
  const dir = worktreeDir();
  const cli = builtCliPath(dir);
  if (fs.existsSync(cli)) {
    log.info(`reusing pre-upgrade build at ${cli}`);
    return cli;
  }
  const root = repoRoot();
  try {
    if (!fs.existsSync(dir)) {
      log.info(`adding worktree for ${PRE_UPGRADE_TAG} at ${dir}`);
      execFileSync('git', ['worktree', 'add', '--detach', dir, PRE_UPGRADE_TAG], {
        cwd: root,
        stdio: 'inherit',
      });
    }
    log.info('installing pre-upgrade dependencies (npm ci) ...');
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
    log.info('building pre-upgrade ...');
    execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
    if (fs.existsSync(cli)) return cli;
    log.warn('pre-upgrade build completed but CLI not found at expected path');
    return null;
  } catch (err) {
    log.warn(`pre-upgrade build failed: ${(err as Error).message}`);
    return null;
  }
}

export function removePreUpgradeWorktree(): void {
  const dir = worktreeDir();
  if (!fs.existsSync(dir)) return;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot(), stdio: 'inherit' });
  } catch (err) {
    log.warn(`could not remove worktree ${dir}: ${(err as Error).message}`);
  }
}

if (require.main === module) {
  const cli = ensurePreUpgradeCli();
  if (cli === null) {
    log.error('pre-upgrade build unavailable');
    process.exit(1);
  }
  log.info(`pre-upgrade CLI: ${cli}`);
}
