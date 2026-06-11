import { strict as assert } from 'assert';
import {
  blockTriggerEvidenceSha256,
  detectBlockTriggers,
  detectClaimFalsified,
  detectCorroboratedUnderConstraint,
  detectObligationFailure,
  type BlockTrigger,
  type ClaimFalsifiedEvidence,
  type CorroboratedUnderConstraintEvidence,
  type ObligationFailureEvidence,
} from '../../../src/audit/gate/block-triggers';
import type { ReproComparison } from '../../../src/audit/execution-grounded';
import type { ExecutionSignals } from '../../../src/audit/execution-grounded/corroborate';
import type { PrIntent } from '../../../src/audit/cheat-detector/pr-intent';
import type { CheatCategory, Finding } from '../../../src/audit/types';

function finding(category: CheatCategory, file: string, line: number): Finding {
  return {
    category,
    severity: 'warn',
    message: `${category} at ${file}:${line}`,
    location: { file, line },
    evidence: '- assertChargeApplied()\n+ // removed',
  };
}

const noSignals: ExecutionSignals = { survivingMutants: [], coverageGaps: [], reproFailures: [] };

function reproComparison(verdict: ReproComparison['verdict']): ReproComparison {
  const postStatus = verdict === 'fix-not-delivered' ? 'failed' : 'passed';
  return {
    issue: { owner: 'acme', repo: 'widgets', number: 42 },
    repro: { kind: 'script', language: 'js', code: 'require("./").charge()' },
    verdict,
    preStatus: 'failed',
    postStatus,
    preOutput: 'before',
    postOutput: 'Error: charge not applied',
    // A fix-not-delivered candidate is re-run on both sides to confirm the
    // controls; every other verdict records the single first run.
    preRuns: verdict === 'fix-not-delivered' ? ['failed', 'failed'] : ['failed'],
    postRuns: verdict === 'fix-not-delivered' ? ['failed', 'failed'] : [postStatus],
  };
}

const claimsFix: PrIntent = { claimsFix: true, evidence: 'fixes #42' };
const noClaim: PrIntent = { claimsFix: false, evidence: '' };

const claimFalsified: ClaimFalsifiedEvidence = {
  kind: 'claim-falsified',
  issueRef: 'acme/widgets#42',
  claim: 'fixes #42',
  reproCommand: 'npx mocha __swarm_repro__.test.js',
  preStatus: 'failed',
  postStatus: 'failed',
  preRuns: ['failed', 'failed'],
  postRuns: ['failed', 'failed'],
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
  runsPassed: [false, false],
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
      postRuns: claimFalsified.postRuns,
      preRuns: claimFalsified.preRuns,
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

describe('detectClaimFalsified (T1)', () => {
  it('fires when a claimed fix leaves the issue repro still failing', () => {
    const triggers = detectClaimFalsified({
      prIntent: claimsFix,
      linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 42 }],
      repros: [reproComparison('fix-not-delivered')],
      testRunner: null,
    });
    assert.equal(triggers.length, 1);
    const trigger = triggers[0]!;
    assert.equal(trigger.kind, 'claim-falsified');
    const evidence = trigger.evidence as ClaimFalsifiedEvidence;
    assert.equal(evidence.issueRef, 'acme/widgets#42');
    assert.equal(evidence.postStatus, 'failed');
    assert.match(evidence.postOutput, /charge not applied/);
    assert.equal(evidence.reproCommand, 'node __swarm_repro__.js');
    assert.equal(trigger.reproduce, evidence.reproCommand, 'reproduce is the repro command');
    assert.deepEqual(evidence.preRuns, ['failed', 'failed'], 'records both base-side runs');
    assert.deepEqual(evidence.postRuns, ['failed', 'failed'], 'records both patched-side runs');
  });

  it('carries the single first run when the side was not re-run (split repro)', () => {
    const split: ReproComparison = {
      ...reproComparison('fix-not-delivered'),
      preRuns: ['failed'],
      postRuns: ['failed'],
    };
    const triggers = detectClaimFalsified({
      prIntent: claimsFix,
      linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 42 }],
      repros: [split],
      testRunner: null,
    });
    assert.equal(triggers.length, 1, 'still fires as an advisory candidate');
    const evidence = triggers[0]!.evidence as ClaimFalsifiedEvidence;
    assert.deepEqual(evidence.preRuns, ['failed']);
    assert.deepEqual(evidence.postRuns, ['failed']);
  });

  it('stays silent when the claimed fix actually delivered', () => {
    const triggers = detectClaimFalsified({
      prIntent: claimsFix,
      linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 42 }],
      repros: [reproComparison('fix-delivered')],
      testRunner: null,
    });
    assert.equal(triggers.length, 0);
  });

  it('stays silent when the PR makes no fix claim and links no issue', () => {
    const triggers = detectClaimFalsified({
      prIntent: noClaim,
      linkedIssues: [],
      repros: [reproComparison('fix-not-delivered')],
      testRunner: null,
    });
    assert.equal(triggers.length, 0);
  });
});

describe('detectCorroboratedUnderConstraint (T2)', () => {
  it('fires when a corroboratable finding shares its line with a surviving mutant', () => {
    const signals: ExecutionSignals = {
      survivingMutants: [{ file: 'src/pay.ts', line: 12, id: 'BlockStatement@src/pay.ts:12 -> Survived' }],
      coverageGaps: [],
      reproFailures: [],
    };
    const triggers = detectCorroboratedUnderConstraint({
      findings: [finding('coverage-erosion', 'src/pay.ts', 12)],
      signals,
      prRef: 'acme/widgets#7',
    });
    assert.equal(triggers.length, 1);
    const evidence = triggers[0]!.evidence as CorroboratedUnderConstraintEvidence;
    assert.equal(evidence.signal, 'surviving-mutant');
    assert.deepEqual(evidence.mutants, ['BlockStatement@src/pay.ts:12 -> Survived']);
    assert.equal(triggers[0]!.reproduce, 'swarm audit acme/widgets#7');
  });

  it('does not fire on a finding with no runtime signal on its line', () => {
    const signals: ExecutionSignals = {
      survivingMutants: [{ file: 'src/other.ts', line: 99, id: 'x' }],
      coverageGaps: [],
      reproFailures: [],
    };
    const triggers = detectCorroboratedUnderConstraint({
      findings: [finding('coverage-erosion', 'src/pay.ts', 12)],
      signals,
      prRef: 'acme/widgets#7',
    });
    assert.equal(triggers.length, 0, 'the structural half alone is not enough');
  });

  it('ignores categories outside the corroboratable set even with a signal on the line', () => {
    const signals: ExecutionSignals = {
      survivingMutants: [{ file: 'src/pay.ts', line: 12, id: 'x' }],
      coverageGaps: [],
      reproFailures: [],
    };
    const triggers = detectCorroboratedUnderConstraint({
      findings: [finding('no-op-fix', 'src/pay.ts', 12)],
      signals,
      prRef: 'acme/widgets#7',
    });
    assert.equal(triggers.length, 0);
  });

  it('returns nothing when there are no signals at all', () => {
    const triggers = detectCorroboratedUnderConstraint({
      findings: [finding('assertion-strip', 'src/pay.ts', 12)],
      signals: noSignals,
      prRef: 'acme/widgets#7',
    });
    assert.equal(triggers.length, 0);
  });
});

describe('detectObligationFailure (T3)', () => {
  it('fires on a failed obligation, carrying its command and output', () => {
    const triggers = detectObligationFailure([
      {
        obligationType: 'test-must-pass',
        obligationIndex: 0,
        passed: false,
        command: 'npm test',
        detail: 'command "npm test" exited 1\n  1 failing',
      },
    ]);
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.reproduce, 'npm test');
    const evidence = triggers[0]!.evidence as ObligationFailureEvidence;
    assert.equal(evidence.obligationType, 'test-must-pass');
    assert.match(evidence.output, /1 failing/);
    assert.deepEqual(evidence.runsPassed, [false], 'a single run records one false');
  });

  it('records both runs when a confirmation re-run is supplied', () => {
    const triggers = detectObligationFailure([
      {
        obligationType: 'test-must-pass',
        passed: false,
        command: 'npm test',
        detail: 'failed twice',
        confirmRunPassed: false,
      },
    ]);
    assert.equal(triggers.length, 1);
    const evidence = triggers[0]!.evidence as ObligationFailureEvidence;
    assert.deepEqual(evidence.runsPassed, [false, false], 'confirmed failure ran twice');
  });

  it('records a split re-run as it happened (not control-confirmed)', () => {
    const triggers = detectObligationFailure([
      {
        obligationType: 'test-must-pass',
        passed: false,
        command: 'npm test',
        detail: 'flaky',
        confirmRunPassed: true,
      },
    ]);
    assert.equal(triggers.length, 1, 'still fires as an advisory candidate');
    const evidence = triggers[0]!.evidence as ObligationFailureEvidence;
    assert.deepEqual(evidence.runsPassed, [false, true]);
  });

  it('stays silent when every obligation passed', () => {
    const triggers = detectObligationFailure([
      { obligationType: 'build-must-pass', passed: true, command: 'npm run build', detail: 'exited 0' },
    ]);
    assert.equal(triggers.length, 0);
  });
});

describe('detectBlockTriggers (aggregate)', () => {
  it('runs every applicable trigger and collects all candidates', () => {
    const signals: ExecutionSignals = {
      survivingMutants: [{ file: 'src/pay.ts', line: 12, id: 'm1' }],
      coverageGaps: [],
      reproFailures: [],
    };
    const triggers = detectBlockTriggers({
      claimFalsified: {
        prIntent: claimsFix,
        linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 42 }],
        repros: [reproComparison('fix-not-delivered')],
        testRunner: null,
      },
      corroborated: {
        findings: [finding('coverage-erosion', 'src/pay.ts', 12)],
        signals,
        prRef: 'acme/widgets#7',
      },
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['claim-falsified', 'corroborated-under-constraint', 'obligation-failure']);
  });

  it('skips a trigger whose input is omitted', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'build-must-pass', passed: false, command: 'npm run build', detail: 'boom' },
      ],
    });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.kind, 'obligation-failure');
  });
});
