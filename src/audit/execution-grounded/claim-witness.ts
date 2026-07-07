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

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { reachableSourceFiles } from '../cheat-detector/test-import-closure';
import type { DockerContext } from './docker-runner';
import {
  classifyRepro,
  executeIssueRepro,
  extractCodeBlocks,
  reproFileName,
  type Repro,
  type ReproExecution,
} from './issue-repro';
import { behaviorallyRevertableSourceFiles, closureLinksChangedSource } from './test-restoration';
import type { TestRunner } from './sandbox';

const log = getLogger('audit:execution-grounded:claim-witness');

/** The versioned witness-compilation prompt. A new wording gets a new id so a
 *  replayed measurement folds the exact prompt it was scored against. */
export const WITNESS_PROMPT_VERSION = 'cw-v1';

/** The versioned arbiter prompt for the "does this test the claim?" gate. */
export const WITNESS_ARBITER_PROMPT_VERSION = 'ca-v1';

/** One completion call: a prompt in, generated text plus the model id out. */
export type Completer = (prompt: string) => Promise<{ text: string; model: string }>;

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

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function witnessPrompt(claim: string): string {
  return [
    'You are given the stated claim of a pull request (its title, body, and any linked issue).',
    'Write ONE self-contained test that FAILS on code where the claim is NOT delivered and',
    'PASSES only when the claimed behaviour is present. Assert the claimed behaviour directly.',
    'Import the real module under test from the repository; do not stub the code under test.',
    'Use the repository test runner conventions (describe/it/expect or assert). Output only a',
    'single fenced code block containing the test, no prose.',
    '',
    '--- CLAIM ---',
    claim,
  ].join('\n');
}

/**
 * Compile the claim into a witness test. Fails closed: returns null when the
 * completion carries no runnable test code block.
 *
 * @param claim the assembled claim text.
 * @param complete the injected completion function (Anthropic in production).
 * @returns the compiled witness with provenance, or null when none was extractable.
 */
export async function compileWitness(claim: string, complete: Completer): Promise<ClaimWitness | null> {
  if (claim.trim().length === 0) return null;
  const prompt = witnessPrompt(claim);
  const { text, model } = await complete(prompt);
  for (const block of extractCodeBlocks(text)) {
    const repro = classifyRepro(block);
    if (repro !== null && repro.kind === 'test') {
      return {
        repro,
        model,
        promptVersion: WITNESS_PROMPT_VERSION,
        promptHash: sha256(prompt),
        witnessHash: sha256(repro.code),
      };
    }
  }
  log.debug('witness compilation produced no runnable test block');
  return null;
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
