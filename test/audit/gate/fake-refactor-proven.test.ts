import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectFakeRefactorProven,
  type BlockTrigger,
  type FakeRefactorProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible, decideBlock } from '../../../src/audit/gate/gate-decision';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  FakeRefactorControls,
  FakeRefactorProofRecord,
  FakeRefactorVerdict,
} from '../../../src/audit/execution-grounded/fake-refactor-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  "git fetch origin pull/9/head && git checkout abc1234 && grep -rnw 'oldTotal' src/report.ts";

const allGreen: FakeRefactorControls = {
  oldSymbolResolved: true,
  oldSymbolDeclarationRemoved: true,
  oldSymbolStillReferenced: true,
};

function provenRecord(overrides: Partial<FakeRefactorProofRecord> = {}): FakeRefactorProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'fake-refactor',
    findingFile: 'src/calc.ts',
    oldName: 'oldTotal',
    newName: 'computeTotal',
    references: ['src/report.ts:2'],
    controls: { ...allGreen },
    reproduceCommand: REPRODUCE,
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: FakeRefactorVerdict[] = [
  'refuted',
  'not-proven:non-source-file',
  'not-proven:no-rename',
  'not-proven:ambiguous-old-symbol',
  'not-proven:old-symbol-still-declared',
  'not-proven:scan-capped',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectFakeRefactorProven (T8)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectFakeRefactorProven({
      fakeRefactorRestorations: [provenRecord(), provenRecord({ findingFile: 'src/pay.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'fake-refactor-proven');
      assert.equal(trigger.reproduce, REPRODUCE);
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const evidence = detectFakeRefactorProven({ fakeRefactorRestorations: [record] })[0]!
      .evidence as FakeRefactorProvenEvidence;
    assert.equal(evidence.kind, 'fake-refactor-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.equal(evidence.file, record.findingFile);
    assert.equal(evidence.oldName, record.oldName);
    assert.equal(evidence.newName, record.newName);
    assert.deepEqual(evidence.references, record.references);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectFakeRefactorProven({ fakeRefactorRestorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const keys: (keyof FakeRefactorControls)[] = [
      'oldSymbolResolved',
      'oldSymbolDeclarationRemoved',
      'oldSymbolStillReferenced',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectFakeRefactorProven({ fakeRefactorRestorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const keys: (keyof FakeRefactorControls)[] = [
      'oldSymbolResolved',
      'oldSymbolDeclarationRemoved',
      'oldSymbolStillReferenced',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectFakeRefactorProven({ fakeRefactorRestorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict });
      assert.equal(
        detectFakeRefactorProven({ fakeRefactorRestorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty fakeRefactorRestorations', () => {
    assert.deepEqual(detectFakeRefactorProven({ fakeRefactorRestorations: [] }), []);
  });
});

describe('detectBlockTriggers with fakeRefactorRestorations', () => {
  it('includes fake-refactor-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      fakeRefactorRestorations: { fakeRefactorRestorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['fake-refactor-proven', 'obligation-failure']);
  });

  it('skips the trigger when context.fakeRefactorRestorations is absent', () => {
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

describe('fake-refactor-proven eligibility and gating', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('fake-refactor-proven'), true);
  });

  it('controlsAllGreen is true only when all three controls are true', () => {
    const green = detectFakeRefactorProven({ fakeRefactorRestorations: [provenRecord()] })[0]!;
    assert.equal(controlsAllGreen(green), true);
  });

  it('gates a merge in gate mode when controls are all green', () => {
    const trigger = detectFakeRefactorProven({ fakeRefactorRestorations: [provenRecord()] })[0]!;
    const decision = decideBlock([trigger], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers.length, 1);
  });

  it('never blocks in advise mode', () => {
    const trigger = detectFakeRefactorProven({ fakeRefactorRestorations: [provenRecord()] })[0]!;
    assert.equal(decideBlock([trigger], 'advise', true).blocked, false);
  });
});

describe('fake-refactor-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectFakeRefactorProven({ fakeRefactorRestorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return { pass: true, findings: [], generatedAt: '2026-01-01T00:00:00.000Z', detectorVersions: {} };
  }

  it('renders the section with the reproduce command and the three controls', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.match(md, /fake-refactor-proven/);
    assert.match(md, /grep -rnw/);
    assert.match(md, /Verdict:.*proven/i);
    assert.match(md, /Old symbol resolved unambiguously.*✅/);
    assert.match(md, /Old symbol no longer declared anywhere.*✅/);
    assert.match(md, /At least one reference to the old symbol survives.*✅/);
    assert.match(md, /oldTotal/);
    assert.match(md, /src\/report\.ts:2/);
  });

  it('embeds the reproduce command in the full PR comment', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [trigger()] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /grep -rnw/);
  });

  it('renders byte-identical across renders', () => {
    const a = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    const b = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.equal(a, b);
  });
});
