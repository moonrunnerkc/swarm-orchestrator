// Non-Node dependency install for the execution-grounded sandbox. sandbox.ts
// owns the clone and the Node package-manager install; this module owns the two
// other ecosystems the viability screen already recognizes: a Python project
// (pytest) and a Go module (go test). Splitting it here keeps sandbox.ts focused
// on orchestration and keeps the Python/Go install commands in one auditable
// spot, the same way runInstall isolates the Node managers.
//
// Scope: this installs dependencies so the sandbox can provision a non-Node tree.
// It does not run the suite. The proof tier's scoped commands (mutation,
// coverage, issue-repro, the restoration proofs) remain Node-only and fail-closed
// on a pytest/Go runner; extending them to Python or Go is recorded future work,
// not part of this seam.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { getLogger } from '../../logger';
import { commandTimeoutMs, execEnv, execFileGuarded, isGuardedTimeout } from './exec-env';

const log = getLogger('audit:execution-grounded:polyglot-install');

/** The two non-Node ecosystems the sandbox can install. */
export type NonNodeEcosystem = 'python' | 'go';

/** One install invocation: a resolved binary, its argv, and a human label used
 *  in the failure message so the recorded error names the exact step. */
export interface InstallStep {
  readonly bin: string;
  readonly args: readonly string[];
  readonly label: string;
}

/** Knobs mirrored from the Node install path. */
export interface NonNodeInstallOptions {
  /** Wall-clock cap per step. Defaults to the shared command timeout (5 min). */
  readonly timeoutMs?: number;
  /** Shared cache directory reused across a run so wheels / modules are not
   *  re-downloaded for every PR. Maps to PIP_CACHE_DIR for Python and the Go
   *  module cache for Go. */
  readonly cacheDir?: string;
}

const PIP_INSTALL = ['-m', 'pip', 'install', '--no-input'] as const;

/**
 * Build the ordered install plan for a Python project checkout, mirroring the
 * Node path's frozen-lockfile discipline where a lockfile exists.
 *
 * Precedence:
 * 1. A poetry project (poetry.lock + pyproject.toml) installs through poetry,
 *    which resolves against the lock (frozen by default). The poetry CLI must be
 *    on PATH; runNonNodeInstall surfaces a clear error when it is not.
 * 2. Otherwise an isolated venv is created and pip installs the pinned
 *    requirements.txt (the lockfile analog) and/or the project itself. A fully
 *    pinned requirements.txt is the frozen install for pip.
 *
 * @param dir the provisioned workspace root (absolute).
 * @returns the ordered steps; an empty-install project still gets its venv so the
 *   provision succeeds honestly (a venv with nothing to install is not a failure).
 */
export function planPythonInstall(dir: string): InstallStep[] {
  const has = (f: string): boolean => fs.existsSync(path.join(dir, f));
  if (has('poetry.lock') && has('pyproject.toml')) {
    return [{ bin: 'poetry', args: ['install', '--no-interaction', '--no-ansi'], label: 'poetry install' }];
  }
  const venvPython = path.join(dir, '.venv', 'bin', 'python');
  const steps: InstallStep[] = [{ bin: 'python3', args: ['-m', 'venv', '.venv'], label: 'create venv' }];
  if (has('requirements.txt')) {
    steps.push({ bin: venvPython, args: [...PIP_INSTALL, '-r', 'requirements.txt'], label: 'pip install -r requirements.txt' });
  }
  if (has('pyproject.toml') || has('setup.py') || has('setup.cfg')) {
    steps.push({ bin: venvPython, args: [...PIP_INSTALL, '.'], label: 'pip install .' });
  }
  return steps;
}

/**
 * Build the install plan for a Go module checkout: fetch and verify the module
 * graph against the committed go.sum (go mod download is checksum-frozen by
 * default). The module cache is redirected into the shared cacheDir by
 * runNonNodeInstall so it is reused across PRs.
 *
 * @param _dir the provisioned workspace root (unused; go reads go.mod from cwd).
 * @returns the single download step.
 */
export function planGoInstall(_dir: string): InstallStep[] {
  return [{ bin: 'go', args: ['mod', 'download'], label: 'go mod download' }];
}

/** Extract the trailing stderr from a guarded-run error for the failure cause. */
function stderrCause(err: unknown): Error {
  const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
  if (stderr.trim().length > 0) return new Error(stderr.trim().slice(-2000));
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Run a non-Node install plan in the sandbox, one step at a time, under the
 * deny-by-default sandbox env. A step failure throws a SwarmError with the exact
 * command and a remediation hint; the caller records it as a provision failure.
 *
 * @param dir the provisioned workspace root (the install cwd).
 * @param ecosystem which ecosystem's cache env to configure.
 * @param steps the ordered plan from planPythonInstall / planGoInstall.
 * @param opts timeout and shared-cache knobs.
 * @throws {SwarmError} code `sandbox-install-failed` when any step fails or times out.
 */
export function runNonNodeInstall(
  dir: string,
  ecosystem: NonNodeEcosystem,
  steps: readonly InstallStep[],
  opts: NonNodeInstallOptions,
): void {
  const timeoutMs = commandTimeoutMs(opts.timeoutMs);
  const env = execEnv();
  if (opts.cacheDir !== undefined) {
    if (ecosystem === 'python') {
      env.PIP_CACHE_DIR = path.join(opts.cacheDir, 'pip');
    } else {
      // Keep the Go build and module caches inside the shared cache dir so a
      // second PR in the same run is mostly a cache hit, matching the Node path.
      env.GOMODCACHE = path.join(opts.cacheDir, 'go-mod');
      env.GOCACHE = path.join(opts.cacheDir, 'go-build');
    }
  }
  for (const step of steps) {
    try {
      log.info(`${ecosystem} install: ${step.label} in ${dir}`);
      execFileGuarded(step.bin, step.args, { cwd: dir, env, timeoutMs });
    } catch (err) {
      const timedOut = isGuardedTimeout(err);
      throw new SwarmError(
        `${ecosystem} dependency install step "${step.label}" (${step.bin} ${step.args.join(' ')}) failed in ${dir}`,
        'sandbox-install-failed',
        {
          remediation: timedOut
            ? `Install exceeded ${Math.round(timeoutMs / 1000)}s. Raise installTimeoutMs or exclude this repo.`
            : ecosystem === 'go'
              ? 'The Go toolchain (`go`) may be missing from the sandbox PATH, or a module is private. ' +
                'Provision Go (actions/setup-go in CI) or exclude this repo.'
              : 'The Python project may need poetry, a system library, or a build toolchain the sandbox lacks. ' +
                'Install the missing tool or record the repo as non-viable.',
          cause: stderrCause(err),
        },
      );
    }
  }
}

/**
 * Provision a non-Node checkout end to end: plan the install for the ecosystem
 * and run it. The one entry point sandbox.ts calls for a pytest or Go tree.
 *
 * @param dir the provisioned workspace root.
 * @param ecosystem 'python' or 'go'.
 * @param opts timeout and shared-cache knobs.
 * @throws {SwarmError} code `sandbox-install-failed` on any install failure.
 */
export function provisionNonNode(dir: string, ecosystem: NonNodeEcosystem, opts: NonNodeInstallOptions): void {
  const steps = ecosystem === 'python' ? planPythonInstall(dir) : planGoInstall(dir);
  runNonNodeInstall(dir, ecosystem, steps, opts);
}
