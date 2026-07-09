// Tier C: claim-to-existing-test binding. The production route into
// goal-not-fixed that carries no synthesis anywhere in the evidence chain.
//
// The claim-differential proof synthesizes a witness from the PR's claim text and
// then abstains in production, because a synthesized witness's pass-capability
// (can it pass on a correct implementation?) cannot be certified without a
// spec-derived oracle (the parked research problem). Tier C sidesteps that: when a
// PR's claim references behaviour an EXISTING repo test already covers, it binds
// the claim to that test and runs it. The existing test's own green history on the
// repo IS its pass-capability evidence: a real test that provably passed once is a
// valid oracle, so its failure on the PR head is meaningful with no synthesis.
//
// The binding is deterministic-first (issue references, test-name overlap, symbol
// overlap); an arbiter opinion may RANK candidate bindings but never creates one,
// so this module produces the candidates and their deterministic scores and a
// caller may reorder but not invent. The classification reuses the discrimination
// control (assessDiscrimination) unchanged: clause 4 (pass-capability) is fed the
// existing test's green run instead of a synthesized honest twin. The finding
// (claim-falsified-bound) ships ADVISORY.

import type {
  PassCapabilityEvidence,
  WitnessRunOutcome,
} from './discrimination-control';
import { assessDiscrimination, DISCRIMINATION_QUORUM_K } from './discrimination-control';
import { executeTestRun } from './test-restoration';
import type { TestRunner } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import { getLogger } from '../../logger';

const log = getLogger('audit:execution-grounded:claim-binding');

export type ClaimBindingVerdict =
  | 'claim-delivered'
  | 'claim-falsified-bound'
  | 'abstain:no-binding'
  | 'abstain:setup-error'
  | 'abstain:nondeterministic-classification'
  | 'abstain:base-passes'
  | 'abstain:failure-identity-divergence'
  | 'abstain:no-pass-capability-evidence'
  | 'abstain:no-workspace'
  | 'not-proven:execution-error';

/** A repo test the claim could bind to. `referencedSymbols` are production
 *  identifiers the test imports or names, used for deterministic symbol overlap. */
export interface ExistingTest {
  readonly file: string;
  readonly testName: string;
  readonly referencedSymbols: readonly string[];
}

export interface ClaimBinding {
  readonly test: ExistingTest;
  readonly score: number;
  readonly signals: string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'is', 'it', 'that',
  'this', 'fix', 'fixes', 'fixed', 'bug', 'issue', 'pr', 'claim', 'claims', 'now',
  'value', 'result', 'returns', 'return', 'add', 'adds', 'when', 'with', 'so',
]);

/** Lowercase word tokens of length >= 3, minus stopwords. */
function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** camelCase / snake_case aware split of an identifier into lowercase parts. */
function identifierParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 3);
}

/**
 * Pure, deterministic: rank the existing tests the claim could bind to. Signals,
 * highest weight first:
 *   - a test whose file or name is named verbatim in the claim text (+5);
 *   - a production symbol the test references that the claim text also names (+3);
 *   - keyword overlap between the claim and the test name's parts (+1 each).
 * Returns candidates with a positive score, best first, ties broken by test file
 * for determinism. An arbiter may reorder these; it must never add one. Nothing
 * here reads a model or the diff.
 *
 * @param claim the PR's claim text (title + body concatenated is fine).
 * @param existingTests the candidate repo tests.
 * @returns the scored candidate bindings, best first.
 */
export function bindClaimToExistingTest(
  claim: string,
  existingTests: readonly ExistingTest[],
): ClaimBinding[] {
  const claimLower = claim.toLowerCase();
  const claimWords = keywords(claim);
  const bindings: ClaimBinding[] = [];
  for (const test of existingTests) {
    let score = 0;
    const signals: string[] = [];
    if (claimLower.includes(test.testName.toLowerCase()) || claimLower.includes(test.file.toLowerCase())) {
      score += 5;
      signals.push(`claim names the test (${test.testName})`);
    }
    for (const sym of test.referencedSymbols) {
      if (sym.length >= 3 && claimWords.has(sym.toLowerCase())) {
        score += 3;
        signals.push(`claim names referenced symbol ${sym}`);
      }
    }
    const nameParts = new Set(identifierParts(test.testName));
    let overlap = 0;
    for (const part of nameParts) {
      if (claimWords.has(part)) overlap += 1;
    }
    if (overlap > 0) {
      score += overlap;
      signals.push(`${overlap} keyword(s) overlap the test name`);
    }
    if (score > 0) bindings.push({ test, score, signals });
  }
  return bindings.sort((a, b) => b.score - a.score || a.test.file.localeCompare(b.test.file));
}

export interface ClaimBindingResult {
  verdict: ClaimBindingVerdict;
  /** Whether this raises an advisory finding (claim-falsified-bound only). */
  isFinding: boolean;
  reason: string;
  binding: ClaimBinding | null;
  /** Failure identity shared by base and head (present on a finding). */
  identity: string | null;
  baseRuns: number;
  headRuns: number;
  passCapability: PassCapabilityEvidence;
}

export interface ClaimBindingInput {
  claim: string;
  existingTests: readonly ExistingTest[];
  /** Base checkout (the claimed defect present). */
  preWorkspacePath: string | null;
  /** Head checkout (the PR applied). */
  postWorkspacePath: string;
  /** A checkout where the bound test is known green: the test's own green history
   *  on the repo, the pass-capability evidence. Omitted in production when no such
   *  ref is cheaply available, which makes claim-falsified-bound abstain. */
  greenWorkspacePath?: string;
  testRunner: TestRunner | null;
  timeoutMs: number;
  quorumK?: number;
  recipe?: MutationRecipe;
  docker?: DockerContext;
}

/** Map an executeTestRun result into a discrimination WitnessRunOutcome. */
function toOutcome(run: {
  passed: boolean;
  rawOutput: string;
  timedOut: boolean;
  spawnFailed: boolean;
}): WitnessRunOutcome {
  const status = run.timedOut
    ? 'timeout'
    : run.spawnFailed
      ? 'errored'
      : run.passed
        ? 'passed'
        : 'failed';
  return { status, stdout: run.rawOutput, stderr: '' };
}

const ABSTAIN_MAP: Record<string, ClaimBindingVerdict> = {
  'setup-error': 'abstain:setup-error',
  'nondeterministic-classification': 'abstain:nondeterministic-classification',
  'base-passes': 'abstain:base-passes',
  'failure-identity-divergence': 'abstain:failure-identity-divergence',
  'no-pass-capability-evidence': 'abstain:no-pass-capability-evidence',
};

function terminal(
  verdict: ClaimBindingVerdict,
  reason: string,
  fields: Partial<ClaimBindingResult> = {},
): ClaimBindingResult {
  return {
    verdict,
    isFinding: verdict === 'claim-falsified-bound',
    reason,
    binding: fields.binding ?? null,
    identity: fields.identity ?? null,
    baseRuns: fields.baseRuns ?? 0,
    headRuns: fields.headRuns ?? 0,
    passCapability: fields.passCapability ?? { kind: 'none', reason: 'not evaluated' },
  };
}

/**
 * Impure: bind the claim to an existing test and classify. Never throws. Runs the
 * bound test K times on base and K times on head, establishes pass-capability from
 * the green-history checkout, and hands the runs to the discrimination control.
 * Fires `claim-falsified-bound` only when the control fires with the existing
 * test's green history as pass-capability, so it does NOT abstain in production
 * the way the synthesized route does: a real green ref satisfies clause 4.
 *
 * @param input the claim, the candidate tests, the checkouts, and the runner.
 * @returns the binding result; `isFinding` is true only for claim-falsified-bound.
 */
export function runClaimBinding(input: ClaimBindingInput): ClaimBindingResult {
  try {
    return runPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`claim-binding: orchestrator threw unexpectedly: ${message}`);
    return terminal('not-proven:execution-error', `claim-binding threw unexpectedly: ${message}`);
  }
}

function runPipeline(input: ClaimBindingInput): ClaimBindingResult {
  if (input.testRunner === null) {
    return terminal('not-proven:execution-error', 'no supported test runner detected in the workspace');
  }
  if (input.preWorkspacePath === null) {
    return terminal('abstain:no-workspace', 'no base checkout to run the bound test against');
  }
  const bindings = bindClaimToExistingTest(input.claim, input.existingTests);
  const binding = bindings[0];
  if (binding === undefined) {
    return terminal('abstain:no-binding', 'the claim does not deterministically bind to any existing repo test');
  }
  const k = input.quorumK ?? DISCRIMINATION_QUORUM_K;
  const runOn = (cwd: string): WitnessRunOutcome =>
    toOutcome(
      executeTestRun({
        runner: input.testRunner!,
        files: [binding.test.file],
        cwd,
        timeoutMs: input.timeoutMs,
        ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
        ...(input.docker !== undefined ? { docker: input.docker } : {}),
      }),
    );

  const baseRuns = Array.from({ length: k }, () => runOn(input.preWorkspacePath!));
  const headRuns = Array.from({ length: k }, () => runOn(input.postWorkspacePath));

  // Pass-capability from the existing test's green history: run it on the green
  // ref; if it passes, the test is a valid oracle. Absent a green ref, supply
  // `none` so a fail-on-both abstains (production-honest), exactly as the
  // synthesized route abstains without an honest twin.
  let passCapability: PassCapabilityEvidence;
  if (input.greenWorkspacePath !== undefined) {
    const green = runOn(input.greenWorkspacePath);
    passCapability =
      green.status === 'passed'
        ? {
            kind: 'honest-twin-pass',
            established: true,
            detail: `the bound test ${binding.test.file} passes on its green-history checkout`,
          }
        : {
            kind: 'honest-twin-pass',
            established: false,
            detail: `the bound test did not pass on the supplied green ref (status ${green.status})`,
          };
  } else {
    passCapability = {
      kind: 'none',
      reason: 'no green-history checkout supplied; the existing test\'s pass-capability is unestablished',
    };
  }

  const verdict = assessDiscrimination({ baseRuns, headRuns, passCapability });
  const common = { binding, baseRuns: k, headRuns: k, passCapability };
  if (verdict.outcome === 'fire') {
    return terminal(
      'claim-falsified-bound',
      `the PR's claim binds to the existing test ${binding.test.file} (${binding.signals.join('; ')}), ` +
        `which fails identically on base and head with a proven green history: the claimed fix was not delivered. ` +
        `Advisory: an existing test the PR claimed to satisfy still fails.`,
      { ...common, identity: verdict.identity },
    );
  }
  if (verdict.outcome === 'claim-delivered') {
    return terminal(
      'claim-delivered',
      `the bound test ${binding.test.file} passes on the head: the claimed behaviour is delivered`,
      { ...common, identity: verdict.identity },
    );
  }
  return terminal(ABSTAIN_MAP[verdict.reason] ?? 'not-proven:execution-error', verdict.detail, common);
}
