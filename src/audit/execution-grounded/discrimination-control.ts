// The discrimination control for the claim-differential proof. It closes the
// Hunt 4 false positive: the verdict `claim-falsified-synthesized` was defined as
// "base fails AND head fails," which a witness that fails identically everywhere
// for its own setup reasons satisfies without providing any differential signal.
// The outline case was exactly that: a synthesized witness read a cached counter
// through the wrong path, asserted `expect(count).toEqual(1)` against `undefined`,
// and failed the same way on base and head regardless of what the PR did.
//
// This module is pure logic over already-executed witness runs. The IO (running
// the witness K times against each checkout, establishing pass-capability on an
// honest twin) lives in claim-differential.ts; here we only classify and decide.
// The control is a conjunction, each clause its own cut:
//
//   1. failure classification: only an assertion failure counts. A setup error
//      (exception, missing dependency, timeout, non-assertion crash) on any run
//      is an immediate abstain, because a crashing witness proves nothing.
//   2. determinism quorum: K runs on base and K on head must each agree on the
//      classification AND the failure identity; any divergence abstains.
//   3. failure-identity discrimination: the base failure and the head failure
//      must be the same assertion failing the same way; a divergence abstains.
//   4. pass-capability evidence: affirmative evidence the witness can pass on
//      some correct implementation of the claim. On twins this is the honest
//      twin passing; in production no sound proxy exists (see the module notes in
//      docs), so production supplies `none` and the verdict abstains. This is the
//      clause that refuses the outline pattern.
//
// Nothing here can turn an abstain into a fire; every clause can only hold back a
// verdict that the base/head runs would otherwise let through.

import type { ReproStatus } from './issue-repro';

/**
 * K, the determinism quorum size, for both the base and the head checkout. The
 * outline instance flipped between `claim-falsified-synthesized` and a crash
 * across three re-runs, so a single run cannot be trusted; K=3 is the minimum
 * that catches a one-in-three nondeterministic run. Each run is a sandbox test
 * execution with no model call, so the cost is wall-clock only (K base + K head
 * = 6 test invocations), not tokens.
 */
export const DISCRIMINATION_QUORUM_K = 3;

/** How one witness run is classified. Only `assertion-failure` counts toward a
 *  verdict; `setup-error` (a crash before or around a clean assertion) and a
 *  `passed` run are handled by their own clauses. */
export type FailureClass = 'passed' | 'assertion-failure' | 'setup-error';

/** The captured outcome of one witness run: the status the executor assigned
 *  plus the raw output the classifier reads. */
export interface WitnessRunOutcome {
  readonly status: ReproStatus;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Affirmative evidence the witness is capable of passing on some implementation
 * of the claim (clause 4). On twins this is direct: the witness passes on the
 * honest twin. In production there is no reference implementation, and no bounded
 * runtime proxy is sound enough to certify it (see the discrimination-control
 * design in `benchmarks/oracle-corpus/proof-protocols.md`), so production supplies
 * `none` and the verdict abstains.
 */
export type PassCapabilityEvidence =
  | { readonly kind: 'honest-twin-pass'; readonly established: boolean; readonly detail: string }
  | { readonly kind: 'none'; readonly reason: string };

/** The abstain reasons the discrimination control can raise, each tied to the
 *  clause that refused the verdict. */
export type DiscriminationAbstain =
  | 'setup-error'
  | 'nondeterministic-classification'
  | 'base-passes'
  | 'failure-identity-divergence'
  | 'no-pass-capability-evidence';

/** The control's decision. `fire` allows `claim-falsified-synthesized`;
 *  `claim-delivered` is the exonerating head-passes outcome; `abstain` names the
 *  refusing clause and carries a human detail plus the matched identity when one
 *  was established. */
export type DiscriminationVerdict =
  | { readonly outcome: 'fire'; readonly identity: string }
  | { readonly outcome: 'claim-delivered'; readonly identity: string }
  | { readonly outcome: 'abstain'; readonly reason: DiscriminationAbstain; readonly detail: string };

// A crash, a missing module, an unresolved import, or a thrown runtime error:
// the witness did not reach a clean assertion, so its non-zero exit is a harness
// artifact, not the claimed behaviour failing. A signature here dominates an
// assertion signature (a witness that throws before asserting is a setup error
// even if the framework also prints an `expect` banner).
const SETUP_ERROR_SIGNATURE = new RegExp(
  [
    'TypeError',
    'ReferenceError',
    'RangeError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'is not a function',
    'is not defined',
    'is not iterable',
    'Cannot read propert',
    "Cannot access '",
    'before initialization',
    'Cannot destructure',
    'Cannot convert',
    'Cannot find module',
    'Cannot find package',
    'MODULE_NOT_FOUND',
    'ERR_MODULE_NOT_FOUND',
    'ERR_UNKNOWN_FILE_EXTENSION',
    'ERR_REQUIRE_ESM',
    'Cannot use import statement',
    'Transform failed',
    'TransformError',
    'Unexpected token',
    'Unexpected identifier',
    'Unexpected end of',
    'Failed to (load|resolve|parse)',
    'UnhandledPromiseRejection',
    'Unhandled rejection',
    'No test(s| files| suites) (found|matching)',
    'must contain at least one test',
  ].join('|'),
);

// The framework reported an assertion mismatch: the test ran and its assertion
// was evaluated and did not hold. Covers node:assert, jest/vitest `expect`,
// chai (mocha), and ava.
const ASSERTION_SIGNATURE = new RegExp(
  [
    'AssertionError',
    'ERR_ASSERTION',
    'expect\\(',
    'Expected:',
    'Received:',
    'toEqual',
    'toStrictEqual',
    'toBe\\b',
    'toMatch',
    'toContain',
    'toHaveBeen',
    'toThrow',
    'to equal',
    'to\\.(be|equal|deep|have|include)',
    'strictEqual',
    'deepEqual',
    'deepStrictEqual',
    'Assertion failed',
  ].join('|'),
);

/**
 * Classify one witness run (clause 1). A `passed` status is `passed`; a timeout
 * or an executor `errored` status is a `setup-error`; a `failed` status is an
 * `assertion-failure` only when the output carries an assertion signature and no
 * setup-error signature, otherwise `setup-error`. Fail-closed: a non-zero exit
 * with no recognizable assertion banner is a setup error, never a counted
 * assertion failure.
 *
 * @param run the captured status and output of one witness run.
 * @returns the failure class.
 */
export function classifyWitnessRun(run: WitnessRunOutcome): FailureClass {
  if (run.status === 'passed') return 'passed';
  if (run.status === 'timeout' || run.status === 'errored') return 'setup-error';
  const text = `${run.stdout}\n${run.stderr}`;
  if (SETUP_ERROR_SIGNATURE.test(text)) return 'setup-error';
  if (ASSERTION_SIGNATURE.test(text)) return 'assertion-failure';
  return 'setup-error';
}

/**
 * A normalized identity for an assertion failure, used by the determinism quorum
 * (clause 2) and the base-vs-head discrimination (clause 3). It strips the parts
 * that legitimately differ between two checkouts (absolute paths, the temp
 * workspace, line:col, durations, hex addresses) and keeps the salient failure
 * lines (the assertion banner and the failing-test name), so two runs of the same
 * unfixed defect match while a genuinely different failure does not.
 *
 * @param run the captured output of an assertion-failure run.
 * @returns a stable, lowercase signature string.
 */
export function witnessFailureIdentity(run: WitnessRunOutcome): string {
  const raw = `${run.stdout}\n${run.stderr}`;
  const normalized = raw
    .replace(/\u001b\[[0-9;]*m/g, '') // ANSI SGR colour codes
    .replace(/(?:\/[\w.@-]+)+\/__swarm_repro__\.[\w.]+/g, '<witness>')
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/:\d+:\d+/g, ':<pos>')
    .replace(/\b\d+(?:\.\d+)?\s?m?s\b/g, '<dur>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/[ \t]+/g, ' ');
  const salient = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && (ASSERTION_SIGNATURE.test(l) || /not ok|✕|✗|✖|×|failing|●|\bAssertionError\b/.test(l)))
    .slice(0, 4)
    .join(' | ')
    .toLowerCase();
  // Fall back to the whole normalized body (bounded) when no salient line
  // matched, so two identical failures still compare equal.
  return (salient.length > 0 ? salient : normalized.trim().slice(0, 400).toLowerCase());
}

/** True when every run agrees on class and (for assertion failures) identity.
 *  An empty set is not unanimous. */
function quorumAgrees(runs: readonly WitnessRunOutcome[]): { agreed: boolean; class: FailureClass; identity: string } {
  const first = runs[0];
  if (first === undefined) return { agreed: false, class: 'setup-error', identity: '' };
  const firstClass = classifyWitnessRun(first);
  const firstIdentity = firstClass === 'assertion-failure' ? witnessFailureIdentity(first) : firstClass;
  for (const run of runs.slice(1)) {
    const c = classifyWitnessRun(run);
    if (c !== firstClass) return { agreed: false, class: firstClass, identity: firstIdentity };
    if (c === 'assertion-failure' && witnessFailureIdentity(run) !== firstIdentity) {
      return { agreed: false, class: firstClass, identity: firstIdentity };
    }
  }
  return { agreed: true, class: firstClass, identity: firstIdentity };
}

/**
 * Run the full discrimination conjunction over the K base and K head runs and
 * the pass-capability evidence. Pure. Returns `fire` only when every clause holds
 * and the witness is shown capable of passing on a correct implementation;
 * `claim-delivered` when the head passes; otherwise the abstain reason of the
 * clause that refused. Never fires without pass-capability evidence, so a witness
 * that fails identically everywhere for its own reasons abstains.
 *
 * @param input the base runs, the head runs, and the pass-capability evidence.
 * @returns the discrimination verdict.
 */
export function assessDiscrimination(input: {
  readonly baseRuns: readonly WitnessRunOutcome[];
  readonly headRuns: readonly WitnessRunOutcome[];
  readonly passCapability: PassCapabilityEvidence;
}): DiscriminationVerdict {
  const { baseRuns, headRuns, passCapability } = input;

  // Clause 1: a setup error on any run means the witness did not run clean; abstain.
  for (const [side, runs] of [['base', baseRuns] as const, ['head', headRuns] as const]) {
    for (let i = 0; i < runs.length; i += 1) {
      if (classifyWitnessRun(runs[i]!) === 'setup-error') {
        return { outcome: 'abstain', reason: 'setup-error', detail: `${side} run ${i + 1} was a setup error, not a clean assertion` };
      }
    }
  }

  // Clause 2: each side's K runs must agree on class and identity.
  const base = quorumAgrees(baseRuns);
  if (!base.agreed) {
    return { outcome: 'abstain', reason: 'nondeterministic-classification', detail: `the ${baseRuns.length} base runs did not all produce the same classification and failure identity` };
  }
  const head = quorumAgrees(headRuns);
  if (!head.agreed) {
    return { outcome: 'abstain', reason: 'nondeterministic-classification', detail: `the ${headRuns.length} head runs did not all produce the same classification and failure identity` };
  }

  // The base must exhibit the claimed defect; a passing base means the witness is
  // invalid. A passing head is the exonerating claim-delivered outcome.
  if (base.class === 'passed') {
    return { outcome: 'abstain', reason: 'base-passes', detail: 'the witness passes on the base, so the claimed defect is absent and the witness is invalid' };
  }
  if (head.class === 'passed') {
    return { outcome: 'claim-delivered', identity: base.identity };
  }

  // Both sides are assertion failures (setup errors were excluded in clause 1).
  // Clause 3: the base and head failures must be the same assertion failing the
  // same way, or the witness is not coherently measuring one behaviour.
  if (base.identity !== head.identity) {
    return { outcome: 'abstain', reason: 'failure-identity-divergence', detail: 'the base and head failures are not the same assertion failing the same way' };
  }

  // Clause 4: the heart of the fix. Fire only with affirmative evidence the
  // witness can pass on a correct implementation of the claim.
  if (passCapability.kind === 'honest-twin-pass' && passCapability.established) {
    return { outcome: 'fire', identity: base.identity };
  }
  const reason =
    passCapability.kind === 'none'
      ? passCapability.reason
      : `the witness did not pass on the honest twin (${passCapability.detail}), so it is not shown capable of passing on a correct implementation`;
  return { outcome: 'abstain', reason: 'no-pass-capability-evidence', detail: reason };
}
