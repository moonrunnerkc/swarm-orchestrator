// Workspace provisioning for the execution-grounded audit checks. The
// mutation, issue-repro, and coverage modules all need the same thing:
// a real checkout of a repo at a specific commit with its dependencies
// installed, runnable without polluting the host. This module owns the
// clone, the package-manager detection, the install, and the test-runner
// detection. It is deliberately the only place that shells out to `git`
// and to a package manager, so the heavy, failure-prone I/O is in one
// auditable spot.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';

const log = getLogger('audit:execution-grounded:sandbox');

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';
export type TestRunner = 'jest' | 'vitest' | 'mocha' | 'ava' | 'node-test';

/** Lockfile -> package manager. Order matters: a repo can carry more than
 *  one lockfile after a migration; the most specific modern manager wins. */
const LOCKFILES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
];

/** The frozen-lockfile install command for each manager. Frozen so the
 *  checkout we audit is the dependency tree the PR author shipped, not a
 *  re-resolved one. */
const INSTALL_COMMAND: Record<PackageManager, readonly string[]> = {
  npm: ['ci', '--no-audit', '--no-fund'],
  yarn: ['install', '--frozen-lockfile', '--non-interactive'],
  pnpm: ['install', '--frozen-lockfile'],
  bun: ['install', '--frozen-lockfile'],
};

const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const DISK_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export interface ProvisionOptions {
  /** "owner/name" GitHub slug. */
  repo: string;
  /** Commit sha to check out. */
  commit: string;
  /** Parent directory under which the temp workspace is created. */
  baseDir: string;
  /** Shared package-manager cache directory, reused across a run so the
   *  same dependency tarball is not re-downloaded for every PR. */
  cacheDir?: string;
  /** Wall-clock cap for the install step. Defaults to 5 minutes. */
  installTimeoutMs?: number;
  /** Skip `npm install` etc. Used by the deterministic fixture tests where
   *  the dependencies are vendored into the fixture. */
  skipInstall?: boolean;
}

export interface Workspace {
  workspacePath: string;
  packageManager: PackageManager;
  testRunner: TestRunner | null;
  cleanup: () => void;
}

/** Detect the package manager from the lockfiles present at the workspace
 *  root. Defaults to npm when no lockfile is found, because something has
 *  to install the tree and npm is the lowest common denominator. */
export function detectPackageManager(workspacePath: string): PackageManager {
  for (const { file, manager } of LOCKFILES) {
    if (fs.existsSync(path.join(workspacePath, file))) return manager;
  }
  return 'npm';
}

/** Detect the test runner by reading package.json: a devDependency or
 *  dependency on a known runner, or a `node --test` test script. Returns
 *  the highest-signal match, or null when no runner is recognizable. */
export function detectTestRunner(workspacePath: string): TestRunner | null {
  const pkgPath = path.join(workspacePath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg: {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
  } catch (err) {
    log.debug(`unparseable package.json at ${pkgPath}: ${String(err)}`);
    return null;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  // Priority order: a repo that depends on vitest and also transitively on
  // jest is a vitest repo; check the modern/explicit runners first.
  if ('vitest' in deps) return 'vitest';
  if ('jest' in deps || 'ts-jest' in deps) return 'jest';
  if ('mocha' in deps) return 'mocha';
  if ('ava' in deps) return 'ava';
  const testScript = pkg.scripts?.test ?? '';
  if (/\bnode\b[^\n]*--test/.test(testScript)) return 'node-test';
  // A test script that names a runner even without the dep listed at the
  // root (common in monorepos where the runner is hoisted).
  if (/\bvitest\b/.test(testScript)) return 'vitest';
  if (/\bjest\b/.test(testScript)) return 'jest';
  if (/\bmocha\b/.test(testScript)) return 'mocha';
  if (/\bava\b/.test(testScript)) return 'ava';
  return null;
}

function gitFetchCheckout(repo: string, commit: string, dir: string, depth: number): void {
  const url = `https://github.com/${repo}.git`;
  const run = (args: string[], timeoutMs: number): void => {
    execFileSync('git', args, {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: timeoutMs,
      encoding: 'utf8',
    });
  };
  try {
    run(['init', '-q'], 30_000);
    run(['remote', 'add', 'origin', url], 30_000);
    // GitHub enables allowReachableSHA1InWant, so fetching a merged PR head
    // (reachable from a ref) by sha works at shallow depth.
    run(['fetch', '--depth', String(depth), '--quiet', 'origin', commit], 4 * 60 * 1000);
    run(['checkout', '--quiet', commit], 60_000);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    throw new SwarmError(`git checkout of ${repo}@${commit.slice(0, 10)} failed`, 'sandbox-clone-failed', {
      remediation:
        'The commit may be unreachable at shallow depth (force-pushed or GC-ed), or the repo is private. ' +
        'Skip this PR or fetch the full history.',
      cause: stderr.length > 0 ? new Error(stderr.trim()) : err,
    });
  }
}

function runInstall(
  manager: PackageManager,
  dir: string,
  cacheDir: string | undefined,
  timeoutMs: number,
): void {
  const args = [...INSTALL_COMMAND[manager]];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (cacheDir !== undefined) {
    fs.mkdirSync(cacheDir, { recursive: true });
    // Each manager reads its cache location from a different env var.
    if (manager === 'npm') env.npm_config_cache = cacheDir;
    if (manager === 'yarn') env.YARN_CACHE_FOLDER = cacheDir;
    if (manager === 'pnpm') env.PNPM_HOME = cacheDir;
    if (manager === 'bun') env.BUN_INSTALL_CACHE_DIR = cacheDir;
  }
  try {
    execFileSync(manager, args, {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: timeoutMs,
      encoding: 'utf8',
      env,
    });
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    const timedOut = err instanceof Error && 'signal' in err && (err as { signal: unknown }).signal === 'SIGTERM';
    throw new SwarmError(
      `dependency install (${manager} ${args.join(' ')}) failed in ${dir}`,
      'sandbox-install-failed',
      {
        remediation: timedOut
          ? `Install exceeded ${Math.round(timeoutMs / 1000)}s. Raise installTimeoutMs or exclude this repo.`
          : 'The repo may need a non-frozen install, a native toolchain, or a different package manager. ' +
            'Record it as yellow (with a documented config patch) or red (excluded) in stryker-viability.json.',
        cause: stderr.length > 0 ? new Error(stderr.trim().slice(-2000)) : err,
      },
    );
  }
}

function directorySizeBytes(dir: string): number {
  try {
    const out = execFileSync('du', ['-sk', dir], { encoding: 'utf8', timeout: 60_000 });
    const kb = Number.parseInt(out.trim().split(/\s+/)[0] ?? '0', 10);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

/**
 * Provision a single workspace: shallow-clone `repo` at `commit`, install
 * dependencies with the detected package manager, and report the detected
 * test runner. The returned `cleanup` removes the workspace; callers must
 * invoke it (a `finally` is the idiom).
 */
export function provisionWorkspace(opts: ProvisionOptions): Workspace {
  const { repo, commit, baseDir, cacheDir } = opts;
  fs.mkdirSync(baseDir, { recursive: true });
  const slug = repo.replace(/[^a-zA-Z0-9]+/g, '-');
  const workspacePath = fs.mkdtempSync(path.join(baseDir, `eg-${slug}-${commit.slice(0, 8)}-`));
  const cleanup = (): void => {
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch (err) {
      log.warn(`failed to clean up workspace ${workspacePath}: ${String(err)}`);
    }
  };
  try {
    log.info(`provisioning ${repo}@${commit.slice(0, 10)} -> ${workspacePath}`);
    gitFetchCheckout(repo, commit, workspacePath, 1);
    const packageManager = detectPackageManager(workspacePath);
    if (opts.skipInstall !== true) {
      runInstall(packageManager, workspacePath, cacheDir, opts.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);
      const size = directorySizeBytes(workspacePath);
      if (size > DISK_CAP_BYTES) {
        log.warn(
          `workspace ${workspacePath} is ${(size / 1e9).toFixed(2)}GB, over the ${DISK_CAP_BYTES / 1e9}GB soft cap`,
        );
      }
    }
    const testRunner = detectTestRunner(workspacePath);
    return { workspacePath, packageManager, testRunner, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export interface ProvisionPROptions {
  repo: string;
  prNumber: number;
  prHeadSha: string;
  /** Pre-PR base commit. When absent the first parent of the head commit is
   *  used, which is the pre-change state for a squash- or rebase-merged PR. */
  prBaseSha?: string;
  baseDir: string;
  cacheDir?: string;
  installTimeoutMs?: number;
}

export interface PRWorkspaces {
  pre: Workspace;
  post: Workspace;
  cleanup: () => void;
}

/**
 * Provision both the pre-PR and post-PR states of a PR. Mutation testing
 * and issue-repro both need the two states (the post state to mutate, the
 * pre state to confirm a repro reproduced before the fix). The two
 * workspaces share a package-manager cache so the second install is mostly
 * a cache hit.
 */
export function provisionPRWorkspaces(opts: ProvisionPROptions): PRWorkspaces {
  const cacheDir = opts.cacheDir ?? path.join(opts.baseDir, '.pm-cache');
  const post = provisionWorkspace({
    repo: opts.repo,
    commit: opts.prHeadSha,
    baseDir: opts.baseDir,
    cacheDir,
    ...(opts.installTimeoutMs !== undefined ? { installTimeoutMs: opts.installTimeoutMs } : {}),
  });
  // Resolve the base commit. With an explicit base we fetch it directly;
  // otherwise the post workspace already has the head, and its first parent
  // is the pre-PR state — resolve the parent sha from that checkout.
  let baseCommit = opts.prBaseSha;
  if (baseCommit === undefined) {
    try {
      baseCommit = execFileSync('git', ['rev-parse', `${opts.prHeadSha}^`], {
        cwd: post.workspacePath,
        encoding: 'utf8',
        timeout: 30_000,
      }).trim();
    } catch (err) {
      post.cleanup();
      throw new SwarmError(
        `could not resolve the base commit (parent of ${opts.prHeadSha.slice(0, 10)})`,
        'sandbox-base-unresolved',
        {
          remediation: 'Pass prBaseSha explicitly, or exclude this PR; the head commit has no fetchable parent.',
          cause: err,
        },
      );
    }
  }
  let pre: Workspace;
  try {
    pre = provisionWorkspace({
      repo: opts.repo,
      commit: baseCommit,
      baseDir: opts.baseDir,
      cacheDir,
      ...(opts.installTimeoutMs !== undefined ? { installTimeoutMs: opts.installTimeoutMs } : {}),
    });
  } catch (err) {
    post.cleanup();
    throw err;
  }
  return {
    pre,
    post,
    cleanup: () => {
      pre.cleanup();
      post.cleanup();
    },
  };
}
