/**
 * Applies a parsed Copilot candidate to the workspace, runs the
 * obligation's AST-backed verifier, captures the result, and rolls back
 * the candidate's filesystem changes before the next candidate is applied.
 *
 * The runner is the verification step that turns Copilot's *claim* into
 * *evidence*. Copilot says "this should fail"; the runner says either
 * "it does, here's the captured detail" (counter-example) or "it doesn't"
 * (false positive — recorded in the cost record).
 *
 * Differs from the Codex predicate-runner in two ways:
 *   1. Permits OVERWRITES of existing files (function-signature drift
 *      requires editing an existing file). The runner snapshots each
 *      target into memory before write so rollback restores the original
 *      bytes verbatim.
 *   2. Verifies via `verifyObligation` from the AST verifier rather than
 *      executing a shell predicate. The AST verifier is the same code
 *      that the v8.0.1 producer pipeline uses for these obligation types,
 *      so a counter-example confirmed here is a counter-example confirmed
 *      against the orchestrator's own verification surface.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../../contract/types';
import { verifyObligation } from '../../../verification/run-verifier';
import type { CounterExampleInput } from '../types';
import type { ParsedCandidate } from './copilot-output-parser';

export interface CandidateRunResult {
  /** True when the obligation is unsatisfied after the candidate is applied. */
  readonly falsified: boolean;
  /**
   * Counter-example payload, populated only when `falsified` is true. The
   * dispatcher passes this directly into `CounterExampleResult.inputs`.
   */
  readonly counterExample: CounterExampleInput | null;
  /** Free-form detail from the verifier (the obligation's failure reason). */
  readonly verifierDetail: string;
}

/**
 * Apply `candidate` to `workspaceRoot`, verify the obligation, then roll
 * back every file the candidate touched.
 *
 * Throws on path-escape attempts (relPath that resolves outside the
 * workspace). Existing-file collisions are *allowed* and treated as
 * overwrites — the runner snapshots the original bytes before write and
 * restores them after the verifier runs.
 */
export function runCandidateAgainstObligation(
  candidate: ParsedCandidate,
  obligation: ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation,
  workspaceRoot: string,
): CandidateRunResult {
  interface Snapshot {
    readonly absPath: string;
    /** Original bytes if the file existed before write; null if it did not. */
    readonly originalBytes: Buffer | null;
  }
  const snapshots: Snapshot[] = [];
  const directoriesCreated: string[] = [];

  for (const file of candidate.files) {
    const absolutePath = path.resolve(workspaceRoot, file.relPath);
    if (!absolutePath.startsWith(workspaceRoot + path.sep) && absolutePath !== workspaceRoot) {
      throw new Error(
        `Copilot candidate "${candidate.name}" file "${file.relPath}" resolved outside the ` +
          `workspace root. Reject the candidate; do not write outside the sandbox.`,
      );
    }
    const exists = fs.existsSync(absolutePath);
    const originalBytes = exists ? fs.readFileSync(absolutePath) : null;
    const dir = path.dirname(absolutePath);
    const newlyCreated = collectMissingAncestors(dir, workspaceRoot);
    if (newlyCreated.length > 0) {
      fs.mkdirSync(dir, { recursive: true });
      for (const created of newlyCreated) {
        directoriesCreated.push(created);
      }
    }
    fs.writeFileSync(absolutePath, file.bytes, 'utf8');
    snapshots.push({ absPath: absolutePath, originalBytes });
  }

  const verdict = verifyObligation(obligation, { repoRoot: workspaceRoot });
  const falsified = !verdict.satisfied;
  let counterExample: CounterExampleInput | null = null;
  if (falsified) {
    counterExample = {
      files: candidate.files.map((file) => ({ relPath: file.relPath, bytes: file.bytes })),
      reproducer: synthesizeReproducerNote(obligation),
      reproducerOutput: verdict.detail,
      // Non-zero exit signals failure to the cost-aggregator and to readers
      // of the on-disk evidence. The verifier returns a typed verdict, not
      // an exit code, so we stamp 1 here as the universal "failed" code.
      reproducerExitCode: 1,
    };
  }

  for (const snapshot of snapshots.slice().reverse()) {
    if (snapshot.originalBytes === null) {
      fs.rmSync(snapshot.absPath, { force: true });
    } else {
      fs.writeFileSync(snapshot.absPath, snapshot.originalBytes);
    }
  }
  for (const dir of directoriesCreated.slice().reverse()) {
    if (isEmptyDirectory(dir) && dir !== workspaceRoot) {
      fs.rmdirSync(dir);
    }
  }

  return { falsified, counterExample, verifierDetail: verdict.detail };
}

/**
 * Run the obligation's AST-backed verifier against the workspace *before*
 * any candidate is applied. The obligation must be satisfied against the
 * unmodified workspace; otherwise yields are pre-tainted (the obligation
 * is already violated), every Copilot candidate trivially "falsifies",
 * and downstream cost is wasted on meaningless work.
 */
export function checkObligationBaseline(
  obligation: ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation,
  workspaceRoot: string,
): { readonly ok: boolean; readonly detail: string } {
  const verdict = verifyObligation(obligation, { repoRoot: workspaceRoot });
  return { ok: verdict.satisfied, detail: verdict.detail };
}

function synthesizeReproducerNote(
  obligation: ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation,
): string {
  // Verification of these obligations is not a single shell command — it
  // runs through `verifyObligation`. The reproducer field is a human-
  // readable note pointing at the verifier entry point so a reviewer can
  // re-run the check by hand. Same evidence shape as Codex's reproducer
  // (a string the reviewer can re-execute), but the executor is the
  // verifier rather than the shell.
  return (
    `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');` +
    `console.log(JSON.stringify(verifyObligation(${JSON.stringify(obligation)},` +
    `{repoRoot:process.cwd()})))"`
  );
}

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return false;
  }
  return fs.readdirSync(dir).length === 0;
}

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
