// Apply-and-verify drivers for the two obligation surfaces. Both run
// through `applyCandidate` for the write/rollback ceremony and differ
// only in the verifier they invoke:
//   - AST runner: `verifyObligation` against the same checker the
//     producer pipeline uses; candidates may overwrite existing files.
//   - Shell runner: predicate exit drives the verdict; candidates
//     must add NEW files only (existing-path collisions throw).

import * as fs from 'fs';
import * as path from 'path';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../contract/types';
import { verifyObligation } from '../../verification/run-verifier';
import { runPredicate } from '../../verification/predicate-runner';
import type { ParsedCandidate } from './cli-falsifier';
import type { CounterExampleInput } from './types';

type AstObligation = ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation;

export interface ShellCandidateResult {
  readonly falsified: boolean;
  readonly counterExample: CounterExampleInput | null;
  readonly output: string;
  readonly exitCode: number;
}

/**
 * Apply `candidate` to `workspaceRoot`, run the AST verifier, then
 * roll back. Overwrites existing files via in-memory snapshot.
 */
export function runAstCandidate(
  candidate: ParsedCandidate,
  obligation: AstObligation,
  workspaceRoot: string,
  adapterLabel: string,
): { falsified: boolean; counterExample: CounterExampleInput | null } {
  const rollback = applyCandidate(candidate, workspaceRoot, adapterLabel, 'snapshot');
  const verdict = verifyObligation(obligation, { repoRoot: workspaceRoot });
  rollback();
  if (verdict.satisfied) return { falsified: false, counterExample: null };
  return {
    falsified: true,
    counterExample: {
      files: candidate.files.map((f) => ({ relPath: f.relPath, bytes: f.bytes })),
      reproducer:
        `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');` +
        `console.log(JSON.stringify(verifyObligation(${JSON.stringify(obligation)},` +
        `{repoRoot:process.cwd()})))"`,
      reproducerOutput: verdict.detail,
      reproducerExitCode: 1,
    },
  };
}

/**
 * Apply `candidate` to `workspaceRoot`, run `predicate`, then remove
 * the candidate's files. Existing-path collisions throw.
 */
export function runShellCandidate(
  candidate: ParsedCandidate,
  predicate: string,
  workspaceRoot: string,
  adapterLabel: string,
): ShellCandidateResult {
  const rollback = applyCandidate(candidate, workspaceRoot, adapterLabel, 'reject');
  const exec = runPredicate(predicate, workspaceRoot);
  rollback();
  const falsified = exec.exitCode !== 0;
  const counterExample: CounterExampleInput | null = falsified
    ? {
        files: candidate.files.map((f) => ({ relPath: f.relPath, bytes: f.bytes })),
        reproducer: predicate,
        reproducerOutput: exec.output,
        reproducerExitCode: exec.exitCode,
      }
    : null;
  return { falsified, counterExample, output: exec.output, exitCode: exec.exitCode };
}

/**
 * Run the AST verifier against the unmodified workspace. The
 * obligation must be satisfied before any candidate is applied, else
 * every candidate trivially "falsifies" and the cost is wasted.
 */
export function checkAstBaseline(
  obligation: AstObligation,
  workspaceRoot: string,
): { readonly ok: boolean; readonly detail: string } {
  const verdict = verifyObligation(obligation, { repoRoot: workspaceRoot });
  return { ok: verdict.satisfied, detail: verdict.detail };
}

// Existing-file policy: 'snapshot' captures original bytes for restore;
// 'reject' throws on collision.
function applyCandidate(
  candidate: ParsedCandidate,
  workspaceRoot: string,
  adapterLabel: string,
  onExisting: 'snapshot' | 'reject',
): () => void {
  const snapshots: Array<{ absPath: string; original: Buffer | null }> = [];
  const dirsCreated: string[] = [];
  for (const f of candidate.files) {
    const abs = path.resolve(workspaceRoot, f.relPath);
    if (!abs.startsWith(workspaceRoot + path.sep) && abs !== workspaceRoot) {
      throw new Error(
        `${adapterLabel} candidate "${candidate.name}" file "${f.relPath}" resolved outside the workspace root.`,
      );
    }
    const exists = fs.existsSync(abs);
    if (exists && onExisting === 'reject') {
      throw new Error(
        `${adapterLabel} candidate "${candidate.name}" file "${f.relPath}" already exists at ${abs}. ` +
          `The prompt forbids touching existing files.`,
      );
    }
    let current = path.dirname(abs);
    while (current !== workspaceRoot && current !== path.dirname(current)) {
      if (fs.existsSync(current)) break;
      dirsCreated.unshift(current);
      current = path.dirname(current);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const original = exists ? fs.readFileSync(abs) : null;
    fs.writeFileSync(abs, f.bytes, 'utf8');
    snapshots.push({ absPath: abs, original });
  }
  return () => {
    for (const s of snapshots.slice().reverse()) {
      if (s.original === null) fs.rmSync(s.absPath, { force: true });
      else fs.writeFileSync(s.absPath, s.original);
    }
    for (const dir of dirsCreated.slice().reverse()) {
      if (dir === workspaceRoot) continue;
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
  };
}
