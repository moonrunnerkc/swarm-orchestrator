import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectNoOpFixProven,
  type BlockTrigger,
  type NoOpFixProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible, decideBlock } from '../../../src/audit/gate/gate-decision';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  NoOpFixControls,
  NoOpFixProofRecord,
  NoOpFixVerdict,
} from '../../../src/audit/execution-grounded/no-op-fix-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  'git fetch origin pull/9/head && git checkout abc1234 && ' +
  "git apply -R <<'SWARM_RESTORE_PATCH' && npx jest --runTestsByPath test/calc.test.ts";

const allGreen: NoOpFixControls = {
  prClaimsFix: true,
  suitePassesAsSubmitted: true,
  revertedSuiteStillPassesTwice: true,
};

function provenRecord(overrides: Partial<NoOpFixProofRecord> = {}): NoOpFixProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'no-op-fix',
    findingFile: 'src/calc.ts',
    revertedSourceFiles: ['src/calc.ts'],
    affectedTestFiles: ['test/calc.test.ts'],
    controls: { ...allGreen },
    prClaim: 'fixes #42',
    reproduceCommand: REPRODUCE,
    revertedHunkPatch: 'diff --git a/src/calc.ts b/src/calc.ts\n',
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: NoOpFixVerdict[] = [
  'refuted',
  'not-proven:no-fix-claim',
  'not-proven:no-source-hunks',
  'not-proven:no-affected-tests',
  'not-proven:closure-capped',
  'not-proven:suite-already-failing',
  'not-proven:flaky',
  'not-proven:patch-apply-failed',
  'not-proven:runner-unsupported',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectNoOpFixProven (T6)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectNoOpFixProven({
      noOpRestorations: [provenRecord(), provenRecord({ findingFile: 'src/pay.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'no-op-fix-proven');
      assert.equal(trigger.reproduce, REPRODUCE);
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const evidence = detectNoOpFixProven({ noOpRestorations: [record] })[0]!
      .evidence as NoOpFixProvenEvidence;
    assert.equal(evidence.kind, 'no-op-fix-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.deepEqual(evidence.revertedSourceFiles, record.revertedSourceFiles);
    assert.deepEqual(evidence.affectedTestFiles, record.affectedTestFiles);
    assert.equal(evidence.prClaim, record.prClaim);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectNoOpFixProven({ noOpRestorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const keys: (keyof NoOpFixControls)[] = [
      'prClaimsFix',
      'suitePassesAsSubmitted',
      'revertedSuiteStillPassesTwice',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectNoOpFixProven({ noOpRestorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const keys: (keyof NoOpFixControls)[] = [
      'prClaimsFix',
      'suitePassesAsSubmitted',
      'revertedSuiteStillPassesTwice',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectNoOpFixProven({ noOpRestorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict });
      assert.equal(
        detectNoOpFixProven({ noOpRestorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty noOpRestorations', () => {
    assert.deepEqual(detectNoOpFixProven({ noOpRestorations: [] }), []);
  });
});

describe('detectBlockTriggers with noOpRestorations', () => {
  it('includes no-op-fix-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      noOpRestorations: { noOpRestorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['no-op-fix-proven', 'obligation-failure']);
  });

  it('skips the trigger when context.noOpRestorations is absent', () => {
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

describe('no-op-fix-proven eligibility and gating', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('no-op-fix-proven'), true);
  });

  it('controlsAllGreen is true only when all three controls are true', () => {
    const green = detectNoOpFixProven({ noOpRestorations: [provenRecord()] })[0]!;
    assert.equal(controlsAllGreen(green), true);
  });

  it('gates a merge in gate mode when controls are all green', () => {
    const trigger = detectNoOpFixProven({ noOpRestorations: [provenRecord()] })[0]!;
    const decision = decideBlock([trigger], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers.length, 1);
  });

  it('never blocks in advise mode', () => {
    const trigger = detectNoOpFixProven({ noOpRestorations: [provenRecord()] })[0]!;
    assert.equal(decideBlock([trigger], 'advise', true).blocked, false);
  });
});

describe('no-op-fix-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectNoOpFixProven({ noOpRestorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return { pass: true, findings: [], generatedAt: '2026-01-01T00:00:00.000Z', detectorVersions: {} };
  }

  it('renders the section with the reproduce command and the three controls', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.match(md, /no-op-fix-proven/);
    assert.match(md, /git apply -R/);
    assert.match(md, /Verdict:.*proven/i);
    assert.match(md, /PR claims a fix.*✅/);
    assert.match(md, /Affected tests pass as submitted.*✅/);
    assert.match(md, /Affected tests still pass with the fix reverted.*✅/);
    assert.match(md, /test\/calc\.test\.ts/);
    assert.match(md, /src\/calc\.ts/);
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
