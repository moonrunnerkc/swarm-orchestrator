import { strict as assert } from 'assert';
import {
  assessDiscrimination,
  classifyWitnessRun,
  witnessFailureIdentity,
  type PassCapabilityEvidence,
  type WitnessRunOutcome,
} from '../../../src/audit/execution-grounded/discrimination-control';

/** An assertion-failure run: a `failed` status whose output is a clean expect
 *  mismatch (jest/vitest style), with the expected value baked into the text. */
function assertionFailure(expected: string, actual: string, testName = 'delivers the claim'): WitnessRunOutcome {
  return {
    status: 'failed',
    stdout: `  ✕ ${testName}\n    expect(received).toEqual(expected)\n    Expected: ${expected}\n    Received: ${actual}\n    at /tmp/ws-abc/__swarm_repro__.test.js:7:19`,
    stderr: '',
  };
}

const TWIN_ESTABLISHED: PassCapabilityEvidence = { kind: 'honest-twin-pass', established: true, detail: 'passed on all 3 honest-twin runs' };
const TWIN_NOT_ESTABLISHED: PassCapabilityEvidence = { kind: 'honest-twin-pass', established: false, detail: 'an honest-twin run classified as assertion-failure' };
const PRODUCTION_NONE: PassCapabilityEvidence = { kind: 'none', reason: 'no reference implementation in production' };

function triple(run: WitnessRunOutcome): WitnessRunOutcome[] {
  return [run, run, run];
}

describe('classifyWitnessRun (clause 1: failure classification)', () => {
  it('classifies a passing run as passed', () => {
    assert.equal(classifyWitnessRun({ status: 'passed', stdout: 'ok 1 - x', stderr: '' }), 'passed');
  });

  it('classifies a clean assertion mismatch as an assertion-failure', () => {
    assert.equal(classifyWitnessRun(assertionFailure('1', '2')), 'assertion-failure');
  });

  it('classifies node:assert output as an assertion-failure', () => {
    const run: WitnessRunOutcome = { status: 'failed', stdout: '', stderr: 'AssertionError [ERR_ASSERTION]: 3 == 4' };
    assert.equal(classifyWitnessRun(run), 'assertion-failure');
  });

  it('classifies a thrown TypeError as a setup-error, not an assertion-failure', () => {
    const run: WitnessRunOutcome = { status: 'failed', stdout: '', stderr: "TypeError: x.foo is not a function\n    at Object.<anonymous>" };
    assert.equal(classifyWitnessRun(run), 'setup-error');
  });

  it('classifies a missing-module failure as a setup-error even with an expect banner present', () => {
    const run: WitnessRunOutcome = {
      status: 'failed',
      stdout: 'expect(received).toEqual(expected)',
      stderr: "Cannot find module './does-not-exist'",
    };
    assert.equal(classifyWitnessRun(run), 'setup-error', 'a crash dominates an assertion banner');
  });

  it('classifies an errored or timed-out run as a setup-error', () => {
    assert.equal(classifyWitnessRun({ status: 'errored', stdout: '', stderr: '' }), 'setup-error');
    assert.equal(classifyWitnessRun({ status: 'timeout', stdout: '', stderr: '' }), 'setup-error');
  });

  it('fails closed: a non-zero exit with no recognizable assertion banner is a setup-error', () => {
    assert.equal(classifyWitnessRun({ status: 'failed', stdout: 'some unstructured output', stderr: '' }), 'setup-error');
  });
});

describe('witnessFailureIdentity (clauses 2 and 3: identity)', () => {
  it('gives the same identity to two runs of the same assertion failure across different workspaces', () => {
    const a: WitnessRunOutcome = { status: 'failed', stdout: 'expect(received).toEqual(expected)\nExpected: 1\nReceived: 2\n at /tmp/ws-AAA/__swarm_repro__.test.js:7:19 (12ms)', stderr: '' };
    const b: WitnessRunOutcome = { status: 'failed', stdout: 'expect(received).toEqual(expected)\nExpected: 1\nReceived: 2\n at /tmp/ws-BBB/__swarm_repro__.test.js:7:31 (48ms)', stderr: '' };
    assert.equal(witnessFailureIdentity(a), witnessFailureIdentity(b), 'paths, positions, and durations are normalized away');
  });

  it('gives different identities to genuinely different assertion failures', () => {
    assert.notEqual(witnessFailureIdentity(assertionFailure('1', '2')), witnessFailureIdentity(assertionFailure('9', '2')));
  });
});

describe('assessDiscrimination clause 1: setup error on any run abstains', () => {
  it('abstains with setup-error when a base run crashed', () => {
    const verdict = assessDiscrimination({
      baseRuns: [assertionFailure('1', '2'), { status: 'errored', stdout: '', stderr: '' }, assertionFailure('1', '2')],
      headRuns: triple(assertionFailure('1', '2')),
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'setup-error']);
  });

  it('abstains with setup-error when a head run threw a runtime error', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', '2')),
      headRuns: [assertionFailure('1', '2'), assertionFailure('1', '2'), { status: 'failed', stdout: '', stderr: 'ReferenceError: y is not defined' }],
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'setup-error']);
  });
});

describe('assessDiscrimination clause 2: determinism quorum', () => {
  it('abstains when the base runs disagree on classification', () => {
    const verdict = assessDiscrimination({
      baseRuns: [assertionFailure('1', '2'), assertionFailure('1', '2'), { status: 'passed', stdout: 'ok', stderr: '' }],
      headRuns: triple(assertionFailure('1', '2')),
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'nondeterministic-classification']);
  });

  it('abstains when the head runs fail with different identities', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', '2')),
      headRuns: [assertionFailure('1', '2'), assertionFailure('1', '2'), assertionFailure('7', '2')],
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'nondeterministic-classification']);
  });
});

describe('assessDiscrimination base-passes and claim-delivered', () => {
  it('abstains with base-passes when the witness passes on the base (claimed defect absent)', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple({ status: 'passed', stdout: 'ok', stderr: '' }),
      headRuns: triple({ status: 'passed', stdout: 'ok', stderr: '' }),
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'base-passes']);
  });

  it('returns claim-delivered when the base fails and the head passes', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', '2')),
      headRuns: triple({ status: 'passed', stdout: 'ok 1 - delivers', stderr: '' }),
      passCapability: PRODUCTION_NONE,
    });
    assert.equal(verdict.outcome, 'claim-delivered');
  });
});

describe('assessDiscrimination clause 3: failure-identity discrimination', () => {
  it('abstains when the base and head fail different assertions', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', '2')),
      headRuns: triple(assertionFailure('5', '2')),
      passCapability: TWIN_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'failure-identity-divergence']);
  });
});

describe('assessDiscrimination clause 4: pass-capability (the heart of the fix)', () => {
  it('fires only when base and head fail identically AND the witness is shown capable of passing', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', '2')),
      headRuns: triple(assertionFailure('1', '2')),
      passCapability: TWIN_ESTABLISHED,
    });
    assert.equal(verdict.outcome, 'fire');
  });

  it('abstains in production: identical everywhere-failure with no pass-capability evidence (the outline pattern)', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', 'undefined')),
      headRuns: triple(assertionFailure('1', 'undefined')),
      passCapability: PRODUCTION_NONE,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'no-pass-capability-evidence']);
  });

  it('abstains when the witness does not pass on the honest twin (not shown capable)', () => {
    const verdict = assessDiscrimination({
      baseRuns: triple(assertionFailure('1', 'undefined')),
      headRuns: triple(assertionFailure('1', 'undefined')),
      passCapability: TWIN_NOT_ESTABLISHED,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'no-pass-capability-evidence']);
  });
});
