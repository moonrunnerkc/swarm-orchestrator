// The single disclosed verification for the discrimination control (soundness run
// Phase 1). The control was developed and validated on synthetic and executable
// semi-synthetic twins only; the Hunt 4 outline record is read exactly once, here,
// at the end of Phase 1, to confirm the finished control refuses the known false
// positive.
//
// The committed record (benchmarks/real-prs/hunt4/records/...outline...json) shows
// the pre-discrimination raw table fired `claim-falsified-synthesized` on
// outline/outline#12197: base failed twice, head failed, arbiters agreed, closure
// linked. The Hunt 4 diagnosis (benchmarks/real-prs/hunt4/outline-diagnosis.md)
// established WHY it is a false positive: the synthesized witness asserts
// `expect(count).toEqual(1)` against a cached counter it never populated, so it
// fails identically on base and head (`Expected: 1 / Received: undefined`)
// regardless of the PR, and it can never pass on any implementation.
//
// Replaying that failure through the finished control in production mode (no
// reference implementation, so pass-capability is `none`) must abstain, and the
// clause that refuses it is clause 4 (pass-capability). This is the disclosed
// receipt that the control closes the gap.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  assessDiscrimination,
  type PassCapabilityEvidence,
  type WitnessRunOutcome,
} from '../../../src/audit/execution-grounded/discrimination-control';

const RECORD = path.join(
  'benchmarks',
  'real-prs',
  'hunt4',
  'records',
  'claude-code-outline-outline-pr12197.json',
);

// The outline witness's failure, as the committed diagnosis records it: an
// assertion mismatch of a cached counter that was never populated, identical on
// base and head.
function outlineAssertionFailure(): WitnessRunOutcome {
  return {
    status: 'failed',
    stdout: [
      '  ✕ suspended users are excluded from the cached member count',
      '    expect(received).toEqual(expected)',
      '    Expected: 1',
      '    Received: undefined',
      '    at Object.<anonymous> (/tmp/outline-ws/__swarm_repro__.test.js:14:23)',
    ].join('\n'),
    stderr: '',
  };
}

// Production: no reference implementation exists, so pass-capability cannot be
// established. This is the deployment mode the outline run was in.
const PRODUCTION: PassCapabilityEvidence = {
  kind: 'none',
  reason: 'no reference implementation available in production',
};

describe('disclosed verification: the outline false positive replayed through the finished control', () => {
  it('the committed record shows the pre-discrimination raw table fired the false positive', () => {
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8')) as {
      claimDifferential: { verdict: string; baseRuns: string[]; headStatus: string };
    };
    assert.equal(record.claimDifferential.verdict, 'claim-falsified-synthesized', 'the raw fire under test');
    assert.deepEqual(record.claimDifferential.baseRuns, ['failed', 'failed']);
    assert.equal(record.claimDifferential.headStatus, 'failed', 'base and head failed identically (the outline pattern)');
  });

  it('the finished control ABSTAINS on the outline pattern in production, refused at clause 4 (pass-capability)', () => {
    const fail = outlineAssertionFailure();
    const verdict = assessDiscrimination({
      baseRuns: [fail, fail, fail],
      headRuns: [fail, fail, fail],
      passCapability: PRODUCTION,
    });
    assert.equal(verdict.outcome, 'abstain', 'the false positive no longer fires');
    assert.equal(
      (verdict as { reason?: string }).reason,
      'no-pass-capability-evidence',
      'clause 4 (pass-capability) is the clause that refuses it: nothing establishes the witness could pass on a correct implementation',
    );
  });

  it('the outline re-run nondeterminism (1 of 3 runs errored) independently trips clause 1 (setup error)', () => {
    // The diagnosis recorded that a re-run erroed rather than failed. A setup
    // error on any run is an immediate abstain, so the control also refuses the
    // fire on robustness grounds, before pass-capability is even reached.
    const fail = outlineAssertionFailure();
    const errored: WitnessRunOutcome = { status: 'errored', stdout: '', stderr: '' };
    const verdict = assessDiscrimination({
      baseRuns: [fail, errored, fail],
      headRuns: [fail, fail, fail],
      passCapability: PRODUCTION,
    });
    assert.deepEqual([verdict.outcome, (verdict as { reason?: string }).reason], ['abstain', 'setup-error']);
  });
});
