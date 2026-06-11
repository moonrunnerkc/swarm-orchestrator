import { strict as assert } from 'assert';
import {
  controlsAllGreen,
  isSelfCertifying,
  SELF_CERTIFYING_TRIGGERS,
} from '../../../src/audit/gate/self-certifying';
import type { BlockTrigger } from '../../../src/audit/gate/block-trigger-types';

function claimTrigger(preRuns: string[], postRuns: string[]): BlockTrigger {
  return {
    kind: 'claim-falsified',
    summary: 'claim falsified',
    reproduce: 'node __swarm_repro__.js',
    evidence: {
      kind: 'claim-falsified',
      issueRef: 'acme/widgets#42',
      claim: 'fixes #42',
      reproCommand: 'node __swarm_repro__.js',
      preStatus: preRuns[0] ?? '',
      postStatus: postRuns[0] ?? '',
      preRuns,
      postRuns,
      postOutput: 'boom',
    },
  };
}

function obligationTrigger(runsPassed: boolean[]): BlockTrigger {
  return {
    kind: 'obligation-failure',
    summary: 'obligation failed',
    reproduce: 'npm test',
    evidence: {
      kind: 'obligation-failure',
      obligationType: 'test-must-pass',
      command: 'npm test',
      output: 'boom',
      runsPassed,
    },
  };
}

function tamperTrigger(
  controls: { baseTestPasses: boolean | null; tamperedSuitePasses: boolean | null; restoredFailsTwiceSameIdentity: boolean | null },
): BlockTrigger {
  return {
    kind: 'test-tamper-proven',
    summary: 'restoration proof',
    reproduce: 'git checkout … && npx mocha test/calc.test.js',
    evidence: {
      kind: 'test-tamper-proven',
      verdict: 'proven',
      category: 'assertion-strip',
      testFiles: ['test/calc.test.js'],
      failingTests: ['calc › adds'],
      controls,
      reproduceCommand: 'git checkout … && npx mocha test/calc.test.js',
    },
  };
}

describe('self-certifying tier', () => {
  it('lists the three self-certifying trigger kinds', () => {
    assert.deepEqual(
      [...SELF_CERTIFYING_TRIGGERS].sort(),
      ['claim-falsified', 'obligation-failure', 'test-tamper-proven'],
    );
    assert.equal(isSelfCertifying('claim-falsified'), true);
    assert.equal(isSelfCertifying('corroborated-under-constraint'), false);
  });
});

describe('controlsAllGreen', () => {
  it('is green for a claim-falsified firing that failed twice on both sides', () => {
    assert.equal(controlsAllGreen(claimTrigger(['failed', 'failed'], ['failed', 'failed'])), true);
  });

  it('is not green for a single-run claim-falsified firing', () => {
    assert.equal(controlsAllGreen(claimTrigger(['failed'], ['failed'])), false);
  });

  it('is not green for a split claim-falsified firing (one side passed once)', () => {
    assert.equal(controlsAllGreen(claimTrigger(['failed', 'failed'], ['failed', 'passed'])), false);
  });

  it('is green for an obligation that failed twice', () => {
    assert.equal(controlsAllGreen(obligationTrigger([false, false])), true);
  });

  it('is not green for a single-run obligation', () => {
    assert.equal(controlsAllGreen(obligationTrigger([false])), false);
  });

  it('is not green for a split obligation re-run', () => {
    assert.equal(controlsAllGreen(obligationTrigger([false, true])), false);
  });

  it('is green for a proven restoration with all three controls true', () => {
    assert.equal(
      controlsAllGreen(
        tamperTrigger({ baseTestPasses: true, tamperedSuitePasses: true, restoredFailsTwiceSameIdentity: true }),
      ),
      true,
    );
  });

  it('is not green for a proven restoration with any control unmet or unevaluated', () => {
    assert.equal(
      controlsAllGreen(
        tamperTrigger({ baseTestPasses: null, tamperedSuitePasses: true, restoredFailsTwiceSameIdentity: true }),
      ),
      false,
    );
    assert.equal(
      controlsAllGreen(
        tamperTrigger({ baseTestPasses: true, tamperedSuitePasses: false, restoredFailsTwiceSameIdentity: true }),
      ),
      false,
    );
  });
});
