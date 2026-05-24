import { execSync } from 'child_process';

/**
 * Shared `runPredicate` helper used by the per-phase fixture-contamination
 * tests and the confirmed-yields regression test. Three identical copies
 * existed at one point; the duplicate-blocks quality gate flagged them
 * and the helper was extracted into this file.
 *
 * Returns the exit code and combined stdout+stderr; never throws on a
 * non-zero exit (the obligations being tested deliberately exercise both
 * branches of the predicate).
 */
export function runPredicate(
  predicate: string,
  cwd: string,
): { exitCode: number; output: string } {
  try {
    const stdout = execSync(predicate, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (cause) {
    const err = cause as { status?: unknown; stdout?: unknown; stderr?: unknown };
    const status = typeof err.status === 'number' ? err.status : 1;
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    return { exitCode: status, output: `${stdout}${stderr}` };
  }
}
