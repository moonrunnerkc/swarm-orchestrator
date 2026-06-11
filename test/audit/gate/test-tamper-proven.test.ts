import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectTestTamperProven,
  type BlockTrigger,
  type TestTamperProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible } from '../../../src/audit/gate/gate-decision';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  RestorationControls,
  RestorationProofRecord,
  RestorationVerdict,
} from '../../../src/audit/execution-grounded/test-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  'git fetch origin pull/7/head && git checkout abc1234 && ' +
  'git apply -R restoration-test-hunks.patch && npx mocha test/pay.test.ts';

const allGreen: RestorationControls = {
  baseTestPasses: true,
  tamperedSuitePasses: true,
  restoredFailsTwiceSameIdentity: true,
};

function provenRecord(overrides: Partial<RestorationProofRecord> = {}): RestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'assertion-strip',
    findingFile: 'test/pay.test.ts',
    testFiles: ['test/pay.test.ts'],
    failingTests: ['pay › charges the card', 'pay › rejects an expired card'],
    controls: { ...allGreen },
    reproduceCommand: REPRODUCE,
    revertedHunkPatch: 'diff --git a/test/pay.test.ts b/test/pay.test.ts\n',
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: RestorationVerdict[] = [
  'refuted',
  'not-proven:pre-existing-failure',
  'not-proven:suite-already-failing',
  'not-proven:flaky',
  'not-proven:no-test-hunks',
  'not-proven:patch-apply-failed',
  'not-proven:runner-unsupported',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectTestTamperProven (T4)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectTestTamperProven({
      restorations: [provenRecord(), provenRecord({ findingFile: 'test/refund.test.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'test-tamper-proven');
      assert.equal(trigger.reproduce, REPRODUCE, 'reproduce is the proof record command');
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const triggers = detectTestTamperProven({ restorations: [record] });
    assert.equal(triggers.length, 1);
    const evidence = triggers[0]!.evidence as TestTamperProvenEvidence;
    assert.equal(evidence.kind, 'test-tamper-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.equal(evidence.category, record.category);
    assert.deepEqual(evidence.testFiles, record.testFiles);
    assert.deepEqual(evidence.failingTests, record.failingTests);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('names the category, finding file, failure count, and the base pass in the summary', () => {
    const triggers = detectTestTamperProven({ restorations: [provenRecord()] });
    const summary = triggers[0]!.summary;
    assert.match(summary, /assertion-strip/);
    assert.match(summary, /test\/pay\.test\.ts/);
    assert.match(summary, /2/);
    assert.match(summary, /base/);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectTestTamperProven({ restorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const controlKeys: (keyof RestorationControls)[] = [
      'baseTestPasses',
      'tamperedSuitePasses',
      'restoredFailsTwiceSameIdentity',
    ];
    for (const key of controlKeys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectTestTamperProven({ restorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const controlKeys: (keyof RestorationControls)[] = [
      'baseTestPasses',
      'tamperedSuitePasses',
      'restoredFailsTwiceSameIdentity',
    ];
    for (const key of controlKeys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectTestTamperProven({ restorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict, failingTests: [] });
      assert.equal(
        detectTestTamperProven({ restorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty restorations', () => {
    assert.deepEqual(detectTestTamperProven({ restorations: [] }), []);
  });
});

describe('detectBlockTriggers with restorations', () => {
  it('includes test-tamper-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      restorations: { restorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['obligation-failure', 'test-tamper-proven']);
  });

  it('skips the trigger when context.restorations is absent', () => {
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

describe('test-tamper-proven eligibility', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('test-tamper-proven'), true);
  });
});

describe('test-tamper-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectTestTamperProven({ restorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return {
      pass: true,
      findings: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
      detectorVersions: {},
    };
  }

  it('renders the section without throwing and includes the reproduce command', () => {
    const md = renderBlockTriggerSection([trigger()], 'advise').join('\n');
    assert.match(md, /test-tamper-proven/);
    assert.match(md, /git apply -R restoration-test-hunks\.patch/);
  });

  it('embeds the reproduce command in the full PR comment', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [trigger()] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /git apply -R restoration-test-hunks\.patch/);
  });

  it('shows the verdict and the three internal controls as a table', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    // verdict line
    assert.match(md, /Verdict:.*proven/i);
    // a markdown table with a header and the three control rows
    assert.match(md, /\| *Control *\| *Result *\|/);
    assert.match(md, /Restored test passes on the base checkout.*✅/);
    assert.match(md, /Tampered suite passes as submitted.*✅/);
    assert.match(md, /Restored run fails twice with the same test identity.*✅/);
    // the failing tests are named
    assert.match(md, /pay › charges the card/);
  });

  it('renders the controls table deterministically (byte-identical across renders)', () => {
    const a = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    const b = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.equal(a, b, 'same trigger must render byte-identical markdown');
  });
});
