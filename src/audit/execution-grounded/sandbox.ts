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
import { fixtureRepoUrl } from '../pr-fixture';
import { commandTimeoutMs, execBin, execEnv, execFileGuarded, isGuardedTimeout } from './exec-env';
import { captureInstallFailure, SandboxInstallError } from './install-failure';
import { chooseManifestDir, discoverManifestDirs } from './manifest-discovery';
import { provisionNonNode, type NonNodeEcosystem } from './polyglot-install';

const log = getLogger('audit:execution-grounded:sandbox');

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';
export type TestRunner = 'jest' | 'vitest' | 'mocha' | 'ava' | 'node-test' | 'pytest' | 'go-test';

/** Lockfile -> package manager. Order matters: a repo can carry more than
 *  one lockfile after a migration; the most specific modern manager wins. */
const LOCKFILES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
];

/** The install invocation for each manager. pnpm and yarn run through
 *  corepack so the repo's declared `packageManager` version is used (and so
 *  yarn need not be installed standalone). Frozen/immutable so the checkout we
 *  audit is the dependency tree the PR author shipped, not a re-resolved one.
 *  npm and bun are self-contained. */
function installInvocation(manager: PackageManager): { bin: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return { bin: execBin('npm'), args: ['ci', '--no-audit', '--no-fund'] };
    case 'pnpm':
      return { bin: execBin('corepack'), args: ['pnpm', 'install', '--frozen-lockfile'] };
    case 'yarn':
      // --immutable is Yarn Berry; classic ignores it and treats install as
      // frozen by default when a lockfile is present, so this is safe for both.
      return { bin: execBin('corepack'), args: ['yarn', 'install', '--immutable'] };
    case 'bun':
      return { bin: 'bun', args: ['install', '--frozen-lockfile'] };
  }
}

/** Non-frozen install, tried only when the frozen install fails. A real PR's
 *  committed lockfile can be out of sync with package.json at the exact commit
 *  (a dependency bump landed without a lockfile update, or the PM version
 *  differs), which makes the frozen install refuse rather than resolve. The
 *  non-frozen form lets the PM reconcile the lockfile so the suite can run. */
function fallbackInstallInvocation(manager: PackageManager): { bin: string; args: string[] } {
  switch (manager) {
    case 'npm':
      return { bin: execBin('npm'), args: ['install', '--no-audit', '--no-fund'] };
    case 'pnpm':
      return { bin: execBin('corepack'), args: ['pnpm', 'install', '--no-frozen-lockfile'] };
    case 'yarn':
      // Plain install: classic updates the lockfile; Berry drops immutability.
      return { bin: execBin('corepack'), args: ['yarn', 'install'] };
    case 'bun':
      return { bin: 'bun', args: ['install'] };
  }
}

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
  /** Shallow-fetch depth. Defaults to 1. Use 2 when the caller needs the
   *  commit's parent (to derive a PR's pre-change base from its head). */
  depth?: number;
  /** Run the repo's build script after install. Needed for self-hosting repos
   *  and TypeScript-compiled packages whose tests import built output. */
  runBuild?: boolean;
  /** Wall-clock cap for the build step. Defaults to 10 minutes. */
  buildTimeoutMs?: number;
  /** Repo-relative paths the PR changed. Used only when the clone root carries
   *  no manifest: subdirectory manifest discovery picks the directory that owns
   *  these files. Roots with a manifest never consult it. */
  changedFiles?: readonly string[];
}

export interface Workspace {
  workspacePath: string;
  packageManager: PackageManager;
  testRunner: TestRunner | null;
  /** Repo-relative directory the install ran in: '' for the clone root, or the
   *  subdirectory manifest discovery chose when the root had no manifest. */
  manifestDir: string;
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

/** The lockfile filename actually present at the workspace root, for the
 *  install-failure record. Same precedence as detectPackageManager; null when
 *  no known lockfile exists (the npm-default case). */
export function detectLockfileName(workspacePath: string): string | null {
  for (const { file } of LOCKFILES) {
    if (fs.existsSync(path.join(workspacePath, file))) return file;
  }
  return null;
}

/** The `engines.node` range declared in the root package.json, or null when
 *  undeclared or unreadable. Recorded on install failure so an engines-mismatch
 *  bucket can be checked against the pinned sandbox runtime. */
export function readNodeEngineRange(workspacePath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8')) as {
      engines?: { node?: unknown };
    };
    return typeof pkg.engines?.node === 'string' ? pkg.engines.node : null;
  } catch {
    return null;
  }
}

/** Detect the test runner by reading package.json: a devDependency or
 *  dependency on a known runner, or a `node --test` test script. Returns
 *  the highest-signal match, or null when no runner is recognizable. */
export function detectTestRunner(workspacePath: string): TestRunner | null {
  const pkgPath = path.join(workspacePath, 'package.json');
  if (!fs.existsSync(pkgPath)) return detectNonNodeRunner(workspacePath);
  let pkg: {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    jest?: unknown;
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
  if ('jest' in deps || 'ts-jest' in deps || 'jest-expo' in deps) return 'jest';
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
  // A `jest` config key in package.json is as good a signal as the dep.
  if (pkg.jest !== undefined) return 'jest';
  // Config files, for repos that hoist the runner and keep a thin root
  // package.json (vitest workspace, jest preset packages).
  const has = (f: string): boolean => fs.existsSync(path.join(workspacePath, f));
  if (['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs', 'vitest.workspace.ts', 'vitest.workspace.js'].some(has)) {
    return 'vitest';
  }
  if (['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json'].some(has)) {
    return 'jest';
  }
  // A polyglot repo can carry a package.json with no recognizable Node runner
  // but still be, at root, a Go or Python project with tests.
  return detectNonNodeRunner(workspacePath);
}

/** Python project markers that carry a plausible pytest layout. Root-level
 *  only, matching the corpus viability screen's cheapness. */
const PYTHON_PROJECT_FILES: readonly string[] = [
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
];
const PYTEST_SIGNAL_FILES: readonly string[] = ['pytest.ini', 'tox.ini', 'conftest.py'];

/** Detect a non-Node runner from ecosystem markers at the workspace root:
 *  a Go module (go.mod) runs under `go test`, and a Python project with a
 *  pytest signal (a pytest config, or a `tests`/`test` directory) runs under
 *  pytest. Go is checked first so a repo carrying both resolves to Go, matching
 *  the Node-first precedence above. Returns null when neither is recognizable. */
export function detectNonNodeRunner(workspacePath: string): TestRunner | null {
  const has = (f: string): boolean => fs.existsSync(path.join(workspacePath, f));
  if (has('go.mod')) return 'go-test';
  const isPythonProject = PYTHON_PROJECT_FILES.some(has);
  if (isPythonProject) {
    const hasPytestSignal =
      PYTEST_SIGNAL_FILES.some(has) || has('tests') || has('test');
    if (hasPytestSignal) return 'pytest';
  }
  return null;
}

/**
 * Route a provisioned checkout to its install ecosystem: a package.json marks a
 * Node tree; otherwise a go.mod marks Go and a Python project with a pytest
 * signal marks Python (Go-before-Python, matching detectNonNodeRunner). A tree
 * with no recognizable marker falls back to Node so the npm install path records
 * the honest failure rather than silently skipping.
 *
 * @param workspacePath a checked-out project root.
 * @returns 'node', 'python', or 'go'.
 */
export function provisionEcosystem(workspacePath: string): 'node' | NonNodeEcosystem {
  if (fs.existsSync(path.join(workspacePath, 'package.json'))) return 'node';
  const runner = detectNonNodeRunner(workspacePath);
  if (runner === 'go-test') return 'go';
  if (runner === 'pytest') return 'python';
  return 'node';
}

function gitFetchCheckout(repo: string, commit: string, dir: string, depth: number): void {
  // Local fixture seam (fail-closed: null unless SWARM_PR_FIXTURE_DIR points at a
  // fixture whose repo matches). Lets a planted-cheat fixture clone from a local
  // git repo instead of github.com so the whole --pr path runs offline; production
  // (env unset) uses github.com byte-identically.
  const url = fixtureRepoUrl(repo) ?? `https://github.com/${repo}.git`;
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
    // (reachable from a ref) by sha works at shallow depth. The fetch is the
    // flaky step (large repos, transient network), so retry it once with a
    // generous timeout before giving up.
    let fetched = false;
    for (let attempt = 1; attempt <= 2 && !fetched; attempt += 1) {
      try {
        run(['fetch', '--depth', String(depth), '--quiet', 'origin', commit], 8 * 60 * 1000);
        fetched = true;
      } catch (fetchErr) {
        if (attempt === 2) throw fetchErr;
        log.warn(`fetch of ${repo}@${commit.slice(0, 10)} failed (attempt ${attempt}); retrying`);
      }
    }
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
  explicitTimeoutMs: number | undefined,
): void {
  const timeoutMs = commandTimeoutMs(explicitTimeoutMs);
  // Only npm's download cache is safe to redirect. pnpm/yarn/bun resolve a
  // content-addressed store/cache that a later `add` must agree with; pointing
  // it at a per-run dir desyncs the store and breaks the tool add
  // (ERR_PNPM_UNEXPECTED_STORE). Their default global stores are already
  // shared across runs, so the cache benefit stands without the override.
  const env = execEnv(manager === 'npm' ? cacheDir : undefined);
  // Corepack must not interactively prompt before downloading a pinned PM.
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  // Try the frozen install first (reproducible); on a non-timeout failure,
  // retry once with a non-frozen install so a lockfile that drifted at this
  // commit does not strand the whole PR. A timeout is not retried: it means a
  // slow install, not a lockfile mismatch.
  const attempts = [installInvocation(manager), fallbackInstallInvocation(manager)];
  let lastErr: unknown;
  let lastBin = '';
  let lastArgs: string[] = [];
  for (let i = 0; i < attempts.length; i += 1) {
    const { bin, args } = attempts[i]!;
    lastBin = bin;
    lastArgs = args;
    try {
      // captureStdout: corepack yarn (berry and classic) prints its errors on
      // stdout; without it the failure record's tails are empty and the
      // classifier can only say `other`.
      execFileGuarded(bin, args, { cwd: dir, env, timeoutMs, captureStdout: true });
      if (i > 0) log.info(`install in ${dir} succeeded with the non-frozen fallback`);
      return;
    } catch (err) {
      lastErr = err;
      if (isGuardedTimeout(err) || i === attempts.length - 1) break;
      log.warn(`frozen install failed in ${dir}; retrying without a frozen lockfile`);
    }
  }
  const stderr = lastErr instanceof Error && 'stderr' in lastErr ? String((lastErr as { stderr: unknown }).stderr) : '';
  const stdout = lastErr instanceof Error && 'stdout' in lastErr ? String((lastErr as { stdout: unknown }).stdout) : '';
  const causeText = stderr.trim().length > 0 ? stderr : stdout;
  const timedOut = isGuardedTimeout(lastErr);
  // Measurement only: the evidence capture and classification never change what
  // was run above; message, code, remediation, and cause are unchanged too.
  const installFailure = captureInstallFailure(lastErr, {
    packageManager: manager,
    lockfile: detectLockfileName(dir),
    nodeEngineRange: readNodeEngineRange(dir),
  });
  throw new SandboxInstallError(
    // Real command (`corepack yarn install`), not `manager + args`: the latter
    // printed a misleading "yarn yarn install" that reads as a doubled command.
    `dependency install (${lastBin} ${lastArgs.join(' ')}) failed in ${dir}`,
    {
      remediation: timedOut
        ? `Install exceeded ${Math.round(timeoutMs / 1000)}s. Raise installTimeoutMs or exclude this repo.`
        : 'The repo may need a native toolchain or a different package manager. ' +
          'Record it as yellow (with a documented config patch) or red (excluded) in stryker-viability.json.',
      cause: causeText.trim().length > 0 ? new Error(causeText.trim().slice(-2000)) : lastErr instanceof Error ? lastErr : new Error(String(lastErr)),
      installFailure,
    },
  );
}

/**
 * Add dev tooling (Stryker, a coverage provider) to an already-installed
 * workspace using the workspace's own package manager. `npm install` into a
 * pnpm/yarn workspace root fails on the `workspace:` protocol, so the add has
 * to go through the matching manager. Throws on failure; the caller records
 * the check as skipped.
 */
/** Yarn classic (v1) vs Berry (v2+), detected from the lockfile header. */
function isYarnClassic(dir: string): boolean {
  try {
    const lock = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8').slice(0, 200);
    return lock.includes('yarn lockfile v1');
  } catch {
    return false;
  }
}

export function addDevTools(
  manager: PackageManager,
  dir: string,
  packages: readonly string[],
  opts: { cacheDir?: string; timeoutMs: number },
): void {
  let bin: string;
  let args: string[];
  switch (manager) {
    case 'npm':
      bin = execBin('npm');
      args = ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', ...packages];
      break;
    case 'pnpm':
      // -w adds to the workspace root; --ignore-scripts skips postinstall.
      bin = execBin('corepack');
      args = ['pnpm', 'add', '-w', '-D', '--ignore-scripts', ...packages];
      break;
    case 'yarn': {
      // Yarn classic (v1) refuses a workspace-root add without -W; Yarn Berry
      // does not accept -W. Detect the major from the lockfile header.
      bin = execBin('corepack');
      const classic = isYarnClassic(dir);
      args = classic ? ['yarn', 'add', '-D', '-W', ...packages] : ['yarn', 'add', '-D', ...packages];
      break;
    }
    case 'bun':
      bin = 'bun';
      args = ['add', '-d', ...packages];
      break;
  }
  const env = execEnv(opts.cacheDir);
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  execFileGuarded(bin, args, { cwd: dir, env, timeoutMs: opts.timeoutMs });
}

/** Run the repo's `build` script, best-effort. Self-hosting repos (vite's own
 *  vitest imports vite/dist) and TypeScript-compiled packages need a build
 *  before their tests run. A failure or timeout is logged and swallowed: the
 *  checks may still run, or fail with a recorded reason. */
function buildWorkspace(dir: string, manager: PackageManager, timeoutMs: number): void {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return;
  }
  if (pkg.scripts?.build === undefined) return;
  const env = execEnv();
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  const inv =
    manager === 'npm'
      ? { bin: execBin('npm'), args: ['run', 'build'] }
      : manager === 'bun'
        ? { bin: 'bun', args: ['run', 'build'] }
        : { bin: execBin('corepack'), args: [manager, 'run', 'build'] };
  try {
    log.info(`building ${dir} (${manager} run build)`);
    execFileGuarded(inv.bin, inv.args, { cwd: dir, env, timeoutMs });
  } catch (err) {
    log.warn(`build of ${dir} did not complete cleanly (continuing): ${String(err).slice(-160)}`);
  }
}

/** Kill any process still running out of a workspace: dev servers (next-server),
 *  native-binary build scripts (profiling-node's prune step), jest workers, and
 *  browsers a test launched. These are detached grandchildren that survive the
 *  SIGTERM a check's timeout sends to its direct child, so without this sweep
 *  they accumulate across PRs and starve the host. The mkdtemp workspace path is
 *  unique, so matching processes by it cannot hit anything unrelated.
 *  Best-effort. */
function killWorkspaceProcesses(workspacePath: string): void {
  try {
    execFileSync('pkill', ['-9', '-f', workspacePath], { timeout: 30_000, stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched, which is the common case.
    return;
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

/** A directory is provisionable when it carries a Node manifest or a marker the
 *  polyglot install path acts on (go.mod, or a Python project with a pytest
 *  signal). Mirrors provisionEcosystem: anything else would fall to the npm
 *  path and fail on the missing package.json. */
function isProvisionableManifestDir(absDir: string): boolean {
  return fs.existsSync(path.join(absDir, 'package.json')) || detectNonNodeRunner(absDir) !== null;
}

/** An install-failure record for a failure decided before any installer ran:
 *  no output, no exit code, just the pre-assigned bucket. */
function preInstallFailure(bucket: 'no-manifest-found' | 'no-manifest-for-diff'): SandboxInstallError['installFailure'] {
  return {
    packageManager: 'none',
    exitCode: null,
    timedOut: false,
    stderrTail: '',
    lockfile: null,
    nodeEngineRange: null,
    bucket,
  };
}

/**
 * Resolve the manifest directory for a clone root that has none: discover
 * subdirectory manifests (bounded depth, dependency and vendor trees skipped)
 * and choose the one that owns the PR's changed files. Throws a
 * SandboxInstallError carrying the `no-manifest-found` or `no-manifest-for-diff`
 * bucket when no choice exists, so the failure classifies instead of dying as
 * an npm ENOENT in a manifest-less directory.
 *
 * @param workspacePath the clone root.
 * @param changedFiles repo-relative paths the PR changed.
 * @returns the repo-relative manifest directory to provision in.
 * @throws SandboxInstallError with a pre-assigned bucket on either miss.
 */
export function resolveSubdirManifest(
  workspacePath: string,
  changedFiles: readonly string[] | undefined,
): string {
  const candidates = discoverManifestDirs(workspacePath, isProvisionableManifestDir);
  const resolution = chooseManifestDir(candidates, changedFiles);
  if (resolution.kind === 'no-manifest-found') {
    throw new SandboxInstallError(`no package manifest found at the clone root or in any subdirectory of ${workspacePath}`, {
      remediation:
        'The repo carries no package.json, go.mod, or pytest-capable Python project anywhere the ' +
        'bounded discovery looks; exclude this PR or provision it manually.',
      cause: null,
      installFailure: preInstallFailure('no-manifest-found'),
    });
  }
  if (resolution.kind === 'no-manifest-for-diff') {
    throw new SandboxInstallError(
      `subdirectory manifests exist (${resolution.candidates.join(', ')}) but none owns a file this PR changed`,
      {
        remediation:
          'The PR touches files outside every discovered package, so no install target is ' +
          'meaningful for it; exclude this PR from execution-grounded checks.',
        cause: null,
        installFailure: preInstallFailure('no-manifest-for-diff'),
      },
    );
  }
  log.info(
    `no root manifest; provisioning in ${resolution.manifestDir} ` +
      `(${resolution.strategy}, owns ${resolution.ownedChangedFiles} changed file(s))`,
  );
  return resolution.manifestDir;
}

/**
 * Provision a single workspace: shallow-clone `repo` at `commit`, install
 * dependencies with the detected package manager, and report the detected
 * test runner. When the clone root has no manifest, subdirectory discovery
 * picks the manifest directory that owns `changedFiles` and the install, the
 * runner detection, and the build all run there (`manifestDir` records the
 * choice). The returned `cleanup` removes the workspace; callers must
 * invoke it (a `finally` is the idiom).
 */
export function provisionWorkspace(opts: ProvisionOptions): Workspace {
  const { repo, commit, baseDir, cacheDir } = opts;
  fs.mkdirSync(baseDir, { recursive: true });
  const slug = repo.replace(/[^a-zA-Z0-9]+/g, '-');
  const workspacePath = fs.mkdtempSync(path.join(baseDir, `eg-${slug}-${commit.slice(0, 8)}-`));
  const cleanup = (): void => {
    killWorkspaceProcesses(workspacePath);
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch (err) {
      log.warn(`failed to clean up workspace ${workspacePath}: ${String(err)}`);
    }
  };
  try {
    log.info(`provisioning ${repo}@${commit.slice(0, 10)} -> ${workspacePath}`);
    gitFetchCheckout(repo, commit, workspacePath, opts.depth ?? 1);
    // A root with a manifest provisions exactly as before. Only the class B1
    // measured, no manifest of any kind at the clone root, goes through
    // subdirectory discovery; the chosen directory then hosts the install, the
    // runner detection, and the build.
    let manifestDir = '';
    if (
      opts.skipInstall !== true &&
      !fs.existsSync(path.join(workspacePath, 'package.json')) &&
      provisionEcosystem(workspacePath) === 'node'
    ) {
      manifestDir = resolveSubdirManifest(workspacePath, opts.changedFiles);
    }
    const installRoot = manifestDir === '' ? workspacePath : path.join(workspacePath, manifestDir);
    const packageManager = detectPackageManager(installRoot);
    if (opts.skipInstall !== true) {
      const ecosystem = provisionEcosystem(installRoot);
      if (ecosystem === 'node') {
        runInstall(packageManager, installRoot, cacheDir, opts.installTimeoutMs);
      } else {
        // pytest / Go: dependency install only. The test-restoration proof runs
        // the suite on these runners (its runner seam is polyglot); mutation and
        // coverage stay Node-only and fail-closed. Provisioning just makes the
        // tree installable and records an honest success or failure.
        provisionNonNode(installRoot, ecosystem, {
          ...(opts.installTimeoutMs !== undefined ? { timeoutMs: opts.installTimeoutMs } : {}),
          ...(cacheDir !== undefined ? { cacheDir } : {}),
        });
      }
      const size = directorySizeBytes(workspacePath);
      if (size > DISK_CAP_BYTES) {
        log.warn(
          `workspace ${workspacePath} is ${(size / 1e9).toFixed(2)}GB, over the ${DISK_CAP_BYTES / 1e9}GB soft cap`,
        );
      }
      // The build script is a Node concept; a pytest/Go tree has no npm build.
      if (ecosystem === 'node' && opts.runBuild === true) {
        buildWorkspace(installRoot, packageManager, opts.buildTimeoutMs ?? 10 * 60 * 1000);
        // A build script can leave a hung native-binary step (profiling-node's
        // linux-target prune) running detached after the build itself returns;
        // sweep it now so it does not idle through the whole check phase.
        killWorkspaceProcesses(workspacePath);
      }
    }
    const testRunner = detectTestRunner(installRoot);
    return { workspacePath, packageManager, testRunner, manifestDir, cleanup };
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
  /** Run the repo's build after install on both workspaces. */
  runBuild?: boolean;
  /** Repo-relative paths the PR changed, for subdirectory manifest discovery
   *  when the clone root has no manifest. */
  changedFiles?: readonly string[];
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
  // When the base is not given we derive it from the head's first parent, so
  // the head must be fetched at depth 2 for the parent to exist locally.
  const post = provisionWorkspace({
    repo: opts.repo,
    commit: opts.prHeadSha,
    baseDir: opts.baseDir,
    cacheDir,
    ...(opts.prBaseSha === undefined ? { depth: 2 } : {}),
    ...(opts.installTimeoutMs !== undefined ? { installTimeoutMs: opts.installTimeoutMs } : {}),
    ...(opts.runBuild !== undefined ? { runBuild: opts.runBuild } : {}),
    ...(opts.changedFiles !== undefined ? { changedFiles: opts.changedFiles } : {}),
  });
  // Resolve the base commit. With an explicit base we fetch it directly;
  // otherwise the post workspace already has the head, and its first parent
  // is the pre-PR state, resolve the parent sha from that checkout.
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
      ...(opts.runBuild !== undefined ? { runBuild: opts.runBuild } : {}),
      ...(opts.changedFiles !== undefined ? { changedFiles: opts.changedFiles } : {}),
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
