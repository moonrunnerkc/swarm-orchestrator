/**
 * Runs a property-must-hold predicate against a workspace and reports
 * its exit code. The predicate is the obligation's checkable claim
 * (e.g. `grep -q 'foo' src/bar.ts`); exit 0 means the property holds,
 * non-zero means it does not.
 *
 * This is a generic shell-predicate runner shared across the contract
 * compiler (which validates predicates against the baseline before a
 * run starts) and the falsification adapters (which validate the
 * baseline before invoking the underlying CLI). It has no dependency
 * on any particular adapter.
 */

import { execSync } from 'child_process';

export interface PredicateExecResult {
  /** Concatenated stdout+stderr captured from running the predicate. */
  readonly output: string;
  /** Exit code returned by the predicate. */
  readonly exitCode: number;
}

export interface BaselineCheckResult {
  /** True when the predicate exited zero (property already holds). */
  readonly ok: boolean;
  /** Concatenated stdout+stderr from the baseline run. */
  readonly output: string;
  /** Exit code returned by the predicate against the baseline. */
  readonly exitCode: number;
}

/**
 * Execute `predicate` as a shell command in `workspaceRoot`. Returns
 * the exit code and combined output. Never throws on non-zero exit —
 * that is the predicate's expected failure path. Throws only if the
 * shell itself cannot be invoked.
 */
export function runPredicate(predicate: string, workspaceRoot: string): PredicateExecResult {
  try {
    const stdout = execSync(predicate, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    return { output: stdout, exitCode: 0 };
  } catch (cause) {
    const err = cause as { status?: unknown; stdout?: unknown; stderr?: unknown };
    const status = typeof err.status === 'number' ? err.status : 1;
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    return { output: `${stdout}${stderr}`, exitCode: status };
  }
}

/**
 * Run the obligation's predicate against the workspace *before* any
 * candidate is applied. A property-must-hold obligation must FAIL
 * (exit non-zero) against the unmodified workspace for the obligation
 * to be meaningful — if it already exits zero on the baseline, the
 * obligation is a tautology (passes regardless of any changes).
 *
 * Callers in the falsification path short-circuit on `ok === true`
 * (predicate already holds → no falsification possible) and return a
 * `baseline-predicate-already-holds` outcome. Callers in the contract
 * compile path use the same signal to reject tautological obligations
 * before the run starts.
 */
export function checkPredicateBaseline(
  predicate: string,
  workspaceRoot: string,
): BaselineCheckResult {
  const exec = runPredicate(predicate, workspaceRoot);
  return { ok: exec.exitCode === 0, output: exec.output, exitCode: exec.exitCode };
}
