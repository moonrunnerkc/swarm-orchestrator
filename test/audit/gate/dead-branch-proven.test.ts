import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectDeadBranchProven,
  type BlockTrigger,
  type DeadBranchProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible, decideBlock } from '../../../src/audit/gate/gate-decision';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  DeadBranchControls,
  DeadBranchProofRecord,
  DeadBranchVerdict,
} from '../../../src/audit/execution-grounded/dead-branch-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  "git fetch origin pull/9/head && git checkout abc1234 && npx c8 mocha test/calc.test.js " +
  "# then confirm src/calc.ts:2 (the inserted 'if (false)' branch body) is reported uncovered";

const allGreen: DeadBranchControls = {
  branchResolved: true,
  suitePassesAsSubmitted: true,
  branchNeverExecuted: true,
};

function provenRecord(overrides: Partial<DeadBranchProofRecord> = {}): DeadBranchProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'dead-branch-insertion',
    findingFile: 'src/calc.ts',
    branchCondition: 'false',
    branchLine: 2,
    affectedTestFiles: ['test/calc.test.js'],
    controls: { ...allGreen },
    reproduceCommand: REPRODUCE,
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: DeadBranchVerdict[] = [
  'refuted',
  'not-proven:non-source-file',
  'not-proven:no-dead-branch',
  'not-proven:ambiguous-branch',
  'not-proven:no-affected-tests',
  'not-proven:closure-capped',
  'not-proven:suite-already-failing',
  'not-proven:instrumentation-failed',
  'not-proven:control-not-reached',
  'not-proven:runner-unsupported',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectDeadBranchProven (T9)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectDeadBranchProven({
      deadBranchRestorations: [provenRecord(), provenRecord({ findingFile: 'src/pay.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'dead-branch-proven');
      assert.equal(trigger.reproduce, REPRODUCE);
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const evidence = detectDeadBranchProven({ deadBranchRestorations: [record] })[0]!
      .evidence as DeadBranchProvenEvidence;
    assert.equal(evidence.kind, 'dead-branch-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.equal(evidence.file, record.findingFile);
    assert.equal(evidence.branchCondition, record.branchCondition);
    assert.equal(evidence.branchLine, record.branchLine);
    assert.deepEqual(evidence.affectedTestFiles, record.affectedTestFiles);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectDeadBranchProven({ deadBranchRestorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const keys: (keyof DeadBranchControls)[] = [
      'branchResolved',
      'suitePassesAsSubmitted',
      'branchNeverExecuted',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectDeadBranchProven({ deadBranchRestorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const keys: (keyof DeadBranchControls)[] = [
      'branchResolved',
      'suitePassesAsSubmitted',
      'branchNeverExecuted',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectDeadBranchProven({ deadBranchRestorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict });
      assert.equal(
        detectDeadBranchProven({ deadBranchRestorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty deadBranchRestorations', () => {
    assert.deepEqual(detectDeadBranchProven({ deadBranchRestorations: [] }), []);
  });
});

describe('detectBlockTriggers with deadBranchRestorations', () => {
  it('includes dead-branch-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      deadBranchRestorations: { deadBranchRestorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['dead-branch-proven', 'obligation-failure']);
  });

  it('skips the trigger when context.deadBranchRestorations is absent', () => {
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

describe('dead-branch-proven eligibility and gating', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('dead-branch-proven'), true);
  });

  it('controlsAllGreen is true only when all three controls are true', () => {
    const green = detectDeadBranchProven({ deadBranchRestorations: [provenRecord()] })[0]!;
    assert.equal(controlsAllGreen(green), true);
  });

  it('gates a merge in gate mode when controls are all green', () => {
    const trigger = detectDeadBranchProven({ deadBranchRestorations: [provenRecord()] })[0]!;
    const decision = decideBlock([trigger], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers.length, 1);
  });

  it('never blocks in advise mode', () => {
    const trigger = detectDeadBranchProven({ deadBranchRestorations: [provenRecord()] })[0]!;
    assert.equal(decideBlock([trigger], 'advise', true).blocked, false);
  });
});

describe('dead-branch-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectDeadBranchProven({ deadBranchRestorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return { pass: true, findings: [], generatedAt: '2026-01-01T00:00:00.000Z', detectorVersions: {} };
  }

  it('renders the section with the reproduce command and the three controls', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.match(md, /dead-branch-proven/);
    assert.match(md, /npx c8 mocha/);
    assert.match(md, /Verdict:.*proven/i);
    assert.match(md, /A single inserted if-branch with a block body resolved.*✅/);
    assert.match(md, /The affected tests pass as submitted.*✅/);
    assert.match(md, /The condition was evaluated but the branch body never ran.*✅/);
    assert.match(md, /src\/calc\.ts:2/);
  });

  it('embeds the reproduce command in the full PR comment', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [trigger()] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /npx c8 mocha/);
  });

  it('renders byte-identical across renders', () => {
    const a = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    const b = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.equal(a, b);
  });
});
