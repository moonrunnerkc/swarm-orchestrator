import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectMockMutationProven,
  type BlockTrigger,
  type MockMutationProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible, decideBlock } from '../../../src/audit/gate/gate-decision';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  MockRestorationControls,
  MockRestorationProofRecord,
  MockRestorationVerdict,
} from '../../../src/audit/execution-grounded/mock-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  'git fetch origin pull/9/head && git checkout abc1234 && ' +
  "git apply -R <<'SWARM_RESTORE_PATCH' && npx jest --runTestsByPath test/totals.test.ts";

const allGreen: MockRestorationControls = {
  tamperedSuitePasses: true,
  restoredFailsTwiceSameIdentity: true,
  mockReturnsAssertedValue: true,
};

function provenRecord(
  overrides: Partial<MockRestorationProofRecord> = {},
): MockRestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'cheat-mock-mutation',
    findingFile: 'test/totals.test.ts',
    testFiles: ['test/totals.test.ts'],
    failingTests: ['totals › sums the line items'],
    mockedReturnValues: ['expected'],
    controls: { ...allGreen },
    reproduceCommand: REPRODUCE,
    revertedHunkPatch: 'diff --git a/test/totals.test.ts b/test/totals.test.ts\n',
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: MockRestorationVerdict[] = [
  'refuted',
  'not-proven:no-mock-hunks',
  'not-proven:mock-not-asserted',
  'not-proven:suite-already-failing',
  'not-proven:flaky',
  'not-proven:patch-apply-failed',
  'not-proven:runner-unsupported',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectMockMutationProven (T5)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectMockMutationProven({
      mockRestorations: [provenRecord(), provenRecord({ findingFile: 'test/refund.test.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'mock-mutation-proven');
      assert.equal(trigger.reproduce, REPRODUCE);
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const triggers = detectMockMutationProven({ mockRestorations: [record] });
    const evidence = triggers[0]!.evidence as MockMutationProvenEvidence;
    assert.equal(evidence.kind, 'mock-mutation-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.deepEqual(evidence.testFiles, record.testFiles);
    assert.deepEqual(evidence.failingTests, record.failingTests);
    assert.deepEqual(evidence.mockedReturnValues, record.mockedReturnValues);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectMockMutationProven({ mockRestorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const keys: (keyof MockRestorationControls)[] = [
      'tamperedSuitePasses',
      'restoredFailsTwiceSameIdentity',
      'mockReturnsAssertedValue',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectMockMutationProven({ mockRestorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const keys: (keyof MockRestorationControls)[] = [
      'tamperedSuitePasses',
      'restoredFailsTwiceSameIdentity',
      'mockReturnsAssertedValue',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectMockMutationProven({ mockRestorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict, failingTests: [] });
      assert.equal(
        detectMockMutationProven({ mockRestorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty mockRestorations', () => {
    assert.deepEqual(detectMockMutationProven({ mockRestorations: [] }), []);
  });
});

describe('detectBlockTriggers with mockRestorations', () => {
  it('includes mock-mutation-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      mockRestorations: { mockRestorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['mock-mutation-proven', 'obligation-failure']);
  });

  it('skips the trigger when context.mockRestorations is absent', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
    });
    assert.deepEqual(
      triggers.map((t) => t.kind),
      ['obligation-failure'],
    );
  });
});

describe('mock-mutation-proven eligibility and gating', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('mock-mutation-proven'), true);
  });

  it('controlsAllGreen is true only when all three controls are true', () => {
    const green = detectMockMutationProven({ mockRestorations: [provenRecord()] })[0]!;
    assert.equal(controlsAllGreen(green), true);
  });

  it('gates a merge in gate mode when controls are all green', () => {
    const trigger = detectMockMutationProven({ mockRestorations: [provenRecord()] })[0]!;
    const decision = decideBlock([trigger], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers.length, 1);
  });

  it('never blocks in advise mode', () => {
    const trigger = detectMockMutationProven({ mockRestorations: [provenRecord()] })[0]!;
    assert.equal(decideBlock([trigger], 'advise', true).blocked, false);
  });
});

describe('mock-mutation-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectMockMutationProven({ mockRestorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return {
      pass: true,
      findings: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
      detectorVersions: {},
    };
  }

  it('renders the section with the reproduce command and the three controls', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.match(md, /mock-mutation-proven/);
    assert.match(md, /git apply -R/);
    assert.match(md, /Verdict:.*proven/i);
    assert.match(md, /Tampered \(mocked\) suite passes as submitted.*✅/);
    assert.match(md, /Restored run fails twice with the same test identity.*✅/);
    assert.match(md, /Added mock returns the asserted value.*✅/);
    assert.match(md, /totals › sums the line items/);
  });

  it('embeds the reproduce command in the full PR comment', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [trigger()] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /git apply -R/);
  });

  it('renders byte-identical across renders', () => {
    const a = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    const b = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.equal(a, b);
  });
});
