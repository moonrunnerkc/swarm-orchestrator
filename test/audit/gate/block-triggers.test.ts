import { strict as assert } from 'assert';
import {
  blockTriggerEvidenceSha256,
  type BlockTrigger,
  type ClaimFalsifiedEvidence,
  type CorroboratedUnderConstraintEvidence,
  type ObligationFailureEvidence,
} from '../../../src/audit/gate/block-triggers';

const claimFalsified: ClaimFalsifiedEvidence = {
  kind: 'claim-falsified',
  issueRef: 'acme/widgets#42',
  claim: 'fixes #42',
  reproCommand: 'npx mocha __swarm_repro__.test.js',
  preStatus: 'failed',
  postStatus: 'failed',
  postOutput: 'AssertionError: expected 1 to equal 2',
};

const corroborated: CorroboratedUnderConstraintEvidence = {
  kind: 'corroborated-under-constraint',
  category: 'coverage-erosion',
  file: 'src/pay.ts',
  line: 12,
  signal: 'surviving-mutant',
  mutants: ['BlockStatement@src/pay.ts:12 -> Survived'],
  findingEvidence: '- assertChargeApplied()\n+ // removed',
};

const obligationFailure: ObligationFailureEvidence = {
  kind: 'obligation-failure',
  obligationType: 'test-must-pass',
  obligationIndex: 0,
  command: 'npm test',
  output: '1 failing\n  AssertionError: charge not applied',
};

function triggerFor(
  kind: BlockTrigger['kind'],
  evidence: BlockTrigger['evidence'],
  reproduce: string,
): BlockTrigger {
  return { kind, summary: `${kind} candidate`, reproduce, evidence };
}

describe('block-trigger evidence', () => {
  it('round-trips every evidence kind through JSON unchanged', () => {
    const triggers: BlockTrigger[] = [
      triggerFor('claim-falsified', claimFalsified, claimFalsified.reproCommand),
      triggerFor('corroborated-under-constraint', corroborated, 'swarm audit acme/widgets#7'),
      triggerFor('obligation-failure', obligationFailure, obligationFailure.command),
    ];
    for (const trigger of triggers) {
      const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
      assert.deepEqual(round, trigger);
      assert.ok(round.reproduce.length > 0, 'reproduce command must be runnable, not empty');
    }
  });

  it('fingerprints evidence deterministically regardless of key order', () => {
    const reordered: ClaimFalsifiedEvidence = {
      postOutput: claimFalsified.postOutput,
      postStatus: claimFalsified.postStatus,
      preStatus: claimFalsified.preStatus,
      reproCommand: claimFalsified.reproCommand,
      claim: claimFalsified.claim,
      issueRef: claimFalsified.issueRef,
      kind: 'claim-falsified',
    };
    assert.equal(
      blockTriggerEvidenceSha256(claimFalsified),
      blockTriggerEvidenceSha256(reordered),
      'canonical-JSON hash must not depend on field order',
    );
  });

  it('changes the fingerprint when the evidence changes', () => {
    const tampered: ObligationFailureEvidence = { ...obligationFailure, output: 'all green' };
    assert.notEqual(
      blockTriggerEvidenceSha256(obligationFailure),
      blockTriggerEvidenceSha256(tampered),
      'a different captured output must produce a different fingerprint',
    );
  });
});
