/**
 * Applies a parsed Codex candidate to the workspace, runs the obligation's
 * predicate, captures the result, and removes the candidate's files
 * before the next candidate is applied.
 *
 * The runner is the verification step that turns Codex's *claim* into
 * *evidence*. Codex says "this should fail"; the runner says either "it
 * does, here's the captured output" (counter-example) or "it doesn't"
 * (false positive — recorded in the cost record).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { CounterExampleInput } from '../types';
import type { ParsedCandidate } from './codex-output-parser';

export interface PredicateRunResult {
  /** True when the predicate exited non-zero (property does not hold). */
  readonly falsified: boolean;
  /**
   * Counter-example payload, populated only when `falsified` is true. The
   * dispatcher passes this directly into `CounterExampleResult.inputs`.
   */
  readonly counterExample: CounterExampleInput | null;
  /** Stdout+stderr captured from running the predicate. */
  readonly output: string;
  /** Exit code returned by the predicate. */
  readonly exitCode: number;
}

/**
 * Apply `candidate` to `workspaceRoot`, run `predicate`, then remove the
 * candidate's files (and any empty directories the candidate created).
 *
 * Throws if a candidate file path collides with an existing file. The
 * prompt forbids touching existing files; collisions indicate the model
 * disobeyed the prompt and we surface that rather than silently
 * overwriting.
 */
export function runCandidateAgainstPredicate(
  candidate: ParsedCandidate,
  predicate: string,
  workspaceRoot: string,
): PredicateRunResult {
  const writtenAbsolutePaths: string[] = [];
  const directoriesCreated: string[] = [];
  for (const file of candidate.files) {
    const absolutePath = path.resolve(workspaceRoot, file.relPath);
    if (!absolutePath.startsWith(workspaceRoot + path.sep) && absolutePath !== workspaceRoot) {
      throw new Error(
        `Codex candidate "${candidate.name}" file "${file.relPath}" resolved outside the ` +
          `workspace root. Reject the candidate; do not write outside the sandbox.`,
      );
    }
    if (fs.existsSync(absolutePath)) {
      throw new Error(
        `Codex candidate "${candidate.name}" file "${file.relPath}" already exists at ` +
          `${absolutePath}. The prompt forbids touching existing files; reject and surface ` +
          `as a strategy issue.`,
      );
    }
    const dir = path.dirname(absolutePath);
    const newlyCreated = collectMissingAncestors(dir, workspaceRoot);
    if (newlyCreated.length > 0) {
      fs.mkdirSync(dir, { recursive: true });
      for (const created of newlyCreated) {
        directoriesCreated.push(created);
      }
    }
    fs.writeFileSync(absolutePath, file.bytes, 'utf8');
    writtenAbsolutePaths.push(absolutePath);
  }

  const exec = runPredicate(predicate, workspaceRoot);
  const falsified = exec.exitCode !== 0;
  let counterExample: CounterExampleInput | null = null;
  if (falsified) {
    counterExample = {
      files: candidate.files.map((file) => ({ relPath: file.relPath, bytes: file.bytes })),
      reproducer: predicate,
      reproducerOutput: exec.output,
      reproducerExitCode: exec.exitCode,
    };
  }

  for (const absolutePath of writtenAbsolutePaths.reverse()) {
    fs.rmSync(absolutePath, { force: true });
  }
  for (const dir of directoriesCreated.reverse()) {
    if (isEmptyDirectory(dir) && dir !== workspaceRoot) {
      fs.rmdirSync(dir);
    }
  }

  return {
    falsified,
    counterExample,
    output: exec.output,
    exitCode: exec.exitCode,
  };
}

interface PredicateExecResult {
  readonly output: string;
  readonly exitCode: number;
}

/**
 * Run the obligation's predicate against the workspace *before* any
 * candidate is applied. A property-must-hold obligation must pass against
 * the unmodified workspace; otherwise yields are pre-tainted (the
 * predicate is already failing for unrelated reasons), every codex
 * candidate trivially "falsifies", and downstream cost is wasted on
 * meaningless work.
 *
 * Callers should short-circuit on `ok === false` and return a
 * `no-falsification-found` outcome with reason `baseline-predicate-failed`
 * rather than invoking the underlying CLI.
 */
export function checkPredicateBaseline(
  predicate: string,
  workspaceRoot: string,
): { readonly ok: boolean; readonly output: string; readonly exitCode: number } {
  const exec = runPredicate(predicate, workspaceRoot);
  return { ok: exec.exitCode === 0, output: exec.output, exitCode: exec.exitCode };
}

function runPredicate(predicate: string, workspaceRoot: string): PredicateExecResult {
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

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return false;
  }
  return fs.readdirSync(dir).length === 0;
}

/**
 * Walk from `target` upwards toward `root`, collecting every directory
 * that does not exist yet. The deepest missing ancestor is returned
 * last; callers iterate in reverse to remove leaf-first.
 */
function collectMissingAncestors(target: string, root: string): readonly string[] {
  const missing: string[] = [];
  let current = target;
  while (current !== root && current !== path.dirname(current)) {
    if (fs.existsSync(current)) break;
    missing.unshift(current);
    current = path.dirname(current);
  }
  return missing;
}
