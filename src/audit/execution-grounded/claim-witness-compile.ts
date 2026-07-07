// Witness compilation for the claim-differential proof. Split out of
// claim-witness.ts so that module stays focused on the arbiter gate, closure
// control, and execution; this one owns turning a claim into one runnable test.
//
// Hardens the two Hunt 3 compile-layer defects, both fail-closed:
//   1. witness-not-compiled: the model spent its budget reasoning and emitted no
//      test. The prompt demands only the test, the reasoning is stripped before
//      parse, and an empty emission is retried once with a format-only reminder.
//   2. closure-unlinked: a witness written from claim text alone imports nothing
//      the PR changed. The compiler is now fed the behaviorally-revertable changed
//      files and their exported symbols, the witness's import closure is validated
//      statically before any sandbox run, and an unlinked witness is regenerated
//      once with the exact files to import. The closure *control* is untouched;
//      the witness now has the information to satisfy it honestly.
//
// The retry and regeneration are compile-layer recoveries recorded per witness
// (`retried`, `regeneratedForClosure`); neither touches a control or a threshold.

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { reachableSourceFiles } from '../cheat-detector/test-import-closure';
import { getLogger } from '../../logger';
import { closureLinksChangedSource } from './test-restoration';
import { classifyRepro, extractCodeBlocks, reproFileName } from './issue-repro';
import { renderChangedUnits, type ChangedUnit } from './claim-changed-units';
import type { ClaimWitness, Completer } from './claim-witness';

const log = getLogger('audit:execution-grounded:claim-witness-compile');

/** The versioned witness-compilation prompt. A new wording gets a new id so a
 *  replayed measurement folds the exact prompt it was scored against. */
export const WITNESS_PROMPT_VERSION = 'cw-v2';

/** Options that let the compiler produce a closure-linked witness and validate it. */
export interface CompileWitnessOptions {
  /** The behaviorally-revertable changed files and their exported symbols. */
  readonly changedUnits?: readonly ChangedUnit[];
  /** The provisioned head checkout, for the static import-closure validation. */
  readonly headWorkspace?: string;
  /** Repo-relative revertable changed files, for the closure-link check. */
  readonly revertableFiles?: readonly string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function baseInstruction(): string {
  return [
    'You are given the stated claim of a pull request (its title, body, and any linked issue).',
    'Write ONE self-contained test that FAILS on code where the claim is NOT delivered and',
    'PASSES only when the claimed behaviour is present. Assert the claimed behaviour directly.',
    'Import the real module under test from the repository; do not stub the code under test.',
    'Use the repository test runner conventions (describe/it/expect or assert).',
  ].join('\n');
}

/**
 * Build the witness-compilation prompt from the claim and, when available, the
 * changed units the witness should import. Pure.
 */
export function witnessPrompt(claim: string, changedUnits: readonly ChangedUnit[] = []): string {
  const units = renderChangedUnits(changedUnits);
  return [
    baseInstruction(),
    'Output only the test source: no explanation, no reasoning, no prose before or after it.',
    ...(units.length > 0 ? ['', units] : []),
    '',
    '--- CLAIM ---',
    claim,
  ].join('\n');
}

/** The format-only retry prompt: same task, stronger insistence on emitting code. */
function retryPrompt(claim: string, changedUnits: readonly ChangedUnit[]): string {
  const units = renderChangedUnits(changedUnits);
  return [
    baseInstruction(),
    'Your previous reply contained no runnable test. Emit ONLY the test source code now,',
    'nothing else: no reasoning, no explanation, no commentary. Begin at the first line of code.',
    ...(units.length > 0 ? ['', units] : []),
    '',
    '--- CLAIM ---',
    claim,
  ].join('\n');
}

/** The regeneration prompt used when a compiled witness does not import a changed unit. */
function importLinkPrompt(claim: string, changedUnits: readonly ChangedUnit[]): string {
  const files = changedUnits.map((u) => u.file).join(', ');
  return [
    baseInstruction(),
    `Your previous test did not import any changed file. You MUST import at least one of: ${files}.`,
    'Import it by its real repository path and exercise its exported behaviour. Emit ONLY the test source.',
    '',
    renderChangedUnits(changedUnits),
    '',
    '--- CLAIM ---',
    claim,
  ].join('\n');
}

/** Strip a leading reasoning block some models emit before the code, then pull the
 *  first runnable test: a fenced code block if present, else the whole (stripped)
 *  reply treated as raw source. Returns the classified repro or null. */
function extractWitnessCandidate(text: string): ReturnType<typeof classifyRepro> {
  const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  for (const block of extractCodeBlocks(stripped)) {
    const repro = classifyRepro(block);
    if (repro !== null && repro.kind === 'test') return repro;
  }
  // Structured-output and prefill-free models return the bare source with no fence.
  const whole = classifyRepro({ lang: '', code: stripped });
  return whole !== null && whole.kind === 'test' ? whole : null;
}

/** True when the witness's import closure reaches a revertable changed source file.
 *  This is the same static computation the closure control performs; running it at
 *  compile time lets an unlinked witness be regenerated before the control sees it.
 *  Fail-closed: a capped closure or an I/O error reads as not-linked. */
function witnessStaticallyLinks(
  headWorkspace: string,
  repro: NonNullable<ReturnType<typeof classifyRepro>>,
  revertableFiles: readonly string[],
): boolean {
  if (revertableFiles.length === 0) return false;
  const witnessPath = path.join(headWorkspace, reproFileName(repro));
  try {
    fs.writeFileSync(witnessPath, repro.code, 'utf8');
    const closure = reachableSourceFiles([witnessPath], headWorkspace);
    return !closure.capped && closureLinksChangedSource(closure.reachable, [...revertableFiles], headWorkspace);
  } catch (err) {
    log.debug(`static closure link check errored: ${String(err)}`);
    return false;
  } finally {
    try {
      fs.rmSync(witnessPath, { force: true });
    } catch {
      // best-effort cleanup of the probe file
    }
  }
}

/**
 * Compile the claim into a witness test. Fails closed: returns null when neither
 * the first completion nor a single format-only retry carries a runnable test.
 * When the changed units and head checkout are supplied, a witness whose import
 * closure does not reach a changed file is regenerated once with the exact files
 * to import; the result is recorded even if still unlinked (the closure control
 * then fails it closed).
 *
 * @param claim the assembled claim text.
 * @param complete the injected completion function (Anthropic in production).
 * @param opts changed units and head checkout for closure-linked regeneration.
 * @returns the compiled witness with provenance, or null when none was extractable.
 */
export async function compileWitness(
  claim: string,
  complete: Completer,
  opts: CompileWitnessOptions = {},
): Promise<ClaimWitness | null> {
  if (claim.trim().length === 0) return null;
  const changedUnits = opts.changedUnits ?? [];

  const firstPrompt = witnessPrompt(claim, changedUnits);
  let used = await complete(firstPrompt);
  let usedPrompt = firstPrompt;
  let repro = extractWitnessCandidate(used.text);
  let retried = false;

  if (repro === null) {
    retried = true;
    const rp = retryPrompt(claim, changedUnits);
    used = await complete(rp);
    usedPrompt = rp;
    repro = extractWitnessCandidate(used.text);
    if (repro === null) {
      log.debug('witness compilation produced no runnable test after one retry');
      return null;
    }
  }

  let regeneratedForClosure = false;
  const canValidate =
    opts.headWorkspace !== undefined && (opts.revertableFiles?.length ?? 0) > 0 && changedUnits.length > 0;
  if (canValidate && !witnessStaticallyLinks(opts.headWorkspace!, repro, opts.revertableFiles!)) {
    const lp = importLinkPrompt(claim, changedUnits);
    const regen = await complete(lp);
    const regenRepro = extractWitnessCandidate(regen.text);
    if (regenRepro !== null) {
      regeneratedForClosure = true;
      repro = regenRepro;
      used = regen;
      usedPrompt = lp;
    }
  }

  return {
    repro,
    model: used.model,
    promptVersion: WITNESS_PROMPT_VERSION,
    promptHash: sha256(usedPrompt),
    witnessHash: sha256(repro.code),
    ...(used.samplingPolicy !== undefined ? { samplingPolicy: used.samplingPolicy } : {}),
    retried,
    regeneratedForClosure,
  };
}
