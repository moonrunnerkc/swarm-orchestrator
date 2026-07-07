// Claim witness: compile a PR's stated claim into one executable test, gate it
// behind an independent two-model agreement that the test actually checks the
// claim, and evaluate the controls that make a base/head differential trustworthy.
// This is the compiler-and-controls half of the claim-differential proof; the
// verdict table and orchestration live in claim-differential.ts.
//
// The LLM is injected (a Completer for the witness, two Arbiters for the gate) so
// the whole module is deterministic under test with stubs, and the Anthropic
// wiring lives behind claim-llm.ts. Everything fails closed: an uncompilable
// witness, an arbiter split, or an unresolvable closure yields no witness / no
// agreement rather than a guess.

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { reachableSourceFiles } from '../cheat-detector/test-import-closure';
import type { DockerContext } from './docker-runner';
import {
  executeIssueRepro,
  reproFileName,
  type Repro,
  type ReproExecution,
} from './issue-repro';
import { behaviorallyRevertableSourceFiles, closureLinksChangedSource } from './test-restoration';
import type { TestRunner } from './sandbox';

// Witness compilation (the claim -> one runnable test step, with the
// witness-not-compiled and closure-unlinked hardening) lives in
// claim-witness-compile.ts; re-exported here so callers keep one import surface.
export {
  compileWitness,
  witnessPrompt,
  WITNESS_PROMPT_VERSION,
  type CompileWitnessOptions,
} from './claim-witness-compile';

const log = getLogger('audit:execution-grounded:claim-witness');

/** The versioned arbiter prompt for the "does this test the claim?" gate. */
export const WITNESS_ARBITER_PROMPT_VERSION = 'ca-v1';

/** One completion call: a prompt in, generated text, the model id, and the
 *  sampling policy that produced it (recorded so a replay knows exactly how the
 *  witness was sampled; the witness model rejects an explicit temperature). */
export type Completer = (
  prompt: string,
) => Promise<{ text: string; model: string; samplingPolicy?: string }>;

/** One arbiter call: yes when the witness genuinely tests the stated claim. */
export type WitnessArbiter = (prompt: string) => Promise<{ yes: boolean; model: string }>;

/** A compiled witness plus the provenance the ledger records content-addressed. */
export interface ClaimWitness {
  readonly repro: Repro;
  readonly model: string;
  readonly promptVersion: string;
  /** sha256 of the exact compilation prompt. */
  readonly promptHash: string;
  /** sha256 of the generated witness source. */
  readonly witnessHash: string;
  /** How the witness was sampled (the witness model rejects an explicit
   *  temperature, so this records the model default rather than a pinned value). */
  readonly samplingPolicy?: string;
  /** True when a first empty emission was recovered by one format-only retry. */
  readonly retried?: boolean;
  /** True when an unlinked witness was regenerated once with the changed files to import. */
  readonly regeneratedForClosure?: boolean;
}

/**
 * Assemble the claim text from the PR and any linked issue. Pure. The claim is
 * the behaviour the PR says it delivers; the witness must assert exactly this.
 *
 * @param parts PR title/body and optional linked-issue title/body.
 * @returns a single claim string, or '' when there is no usable claim text.
 */
export function buildClaimText(parts: {
  prTitle: string;
  prBody: string;
  issueTitle?: string;
  issueBody?: string;
}): string {
  const segments = [
    parts.prTitle.trim(),
    parts.prBody.trim(),
    parts.issueTitle !== undefined ? `Linked issue: ${parts.issueTitle.trim()}` : '',
    parts.issueBody?.trim() ?? '',
  ].filter((s) => s.length > 0);
  return segments.join('\n\n').slice(0, 6000);
}

function arbiterPrompt(claim: string, witnessCode: string): string {
  return [
    'Decide whether the TEST below genuinely checks the CLAIM: it must fail when the claimed',
    'behaviour is absent and pass when it is present, and it must exercise the real behaviour',
    '(not a tautology, not a stub of the code under test). Answer strictly.',
    '',
    '--- CLAIM ---',
    claim,
    '',
    '--- TEST ---',
    witnessCode,
  ].join('\n');
}

/**
 * The two-model agreement gate: both arbiters must independently agree the
 * witness tests the claim. A disagreement (or either saying no) fails the gate,
 * and the split is reported by the caller. Two distinct models are the point;
 * the caller supplies them.
 *
 * @param claim the assembled claim text.
 * @param witnessCode the compiled witness source.
 * @param arbiterA first independent arbiter.
 * @param arbiterB second independent arbiter.
 * @returns agreement flag and each arbiter's verdict/model for the record.
 */
export async function arbiterPairAgrees(
  claim: string,
  witnessCode: string,
  arbiterA: WitnessArbiter,
  arbiterB: WitnessArbiter,
): Promise<{ agreed: boolean; a: { yes: boolean; model: string }; b: { yes: boolean; model: string } }> {
  const prompt = arbiterPrompt(claim, witnessCode);
  const [a, b] = await Promise.all([arbiterA(prompt), arbiterB(prompt)]);
  return { agreed: a.yes && b.yes, a, b };
}

/** The closure control's outcome. `linked` is null when the closure could not be
 *  computed confidently (a capped BFS), which the verdict treats as fail-closed. */
export interface ClosureControl {
  readonly linked: boolean | null;
  readonly capped: boolean;
  readonly revertableCount: number;
}

/**
 * Evaluate the closure control on the head workspace: does the witness's import
 * closure reach a behaviorally-revertable source file the PR changed? A capped
 * BFS yields linked=null (fail-closed); no revertable source yields linked=false.
 *
 * @param headWorkspace the provisioned head (post-PR) checkout.
 * @param witness the compiled witness.
 * @param prDiff the PR's unified diff.
 * @returns the closure control result.
 */
export function evaluateClosureControl(
  headWorkspace: string,
  witness: ClaimWitness,
  prDiff: string,
): ClosureControl {
  const revertable = behaviorallyRevertableSourceFiles(prDiff);
  if (revertable.length === 0) {
    return { linked: false, capped: false, revertableCount: 0 };
  }
  const witnessPath = path.join(headWorkspace, reproFileName(witness.repro));
  try {
    fs.writeFileSync(witnessPath, witness.repro.code, 'utf8');
    const closure = reachableSourceFiles([witnessPath], headWorkspace);
    if (closure.capped) return { linked: null, capped: true, revertableCount: revertable.length };
    return {
      linked: closureLinksChangedSource(closure.reachable, revertable, headWorkspace),
      capped: false,
      revertableCount: revertable.length,
    };
  } catch (err) {
    log.debug(`closure control errored: ${String(err)}`);
    return { linked: null, capped: false, revertableCount: revertable.length };
  } finally {
    try {
      fs.rmSync(witnessPath, { force: true });
    } catch {
      // best-effort cleanup of the probe file
    }
  }
}

/**
 * Run the witness once against a provisioned workspace, reusing the issue-repro
 * executor (the witness is a test repro).
 *
 * @param workspacePath the provisioned checkout (base or head).
 * @param witness the compiled witness.
 * @param runner the detected test runner (null makes a test witness unrunnable).
 * @param docker optional container context.
 * @returns the execution result.
 */
export function runWitness(
  workspacePath: string,
  witness: ClaimWitness,
  runner: TestRunner | null,
  docker?: DockerContext,
): ReproExecution {
  return executeIssueRepro({
    workspacePath,
    repro: witness.repro,
    testRunner: runner,
    ...(docker !== undefined ? { docker } : {}),
  });
}
