import { strict as assert } from 'assert';
import {
  detectBlockTriggers,
  detectTypeSuppressionProven,
  type BlockTrigger,
  type TypeSuppressionProvenEvidence,
} from '../../../src/audit/gate/block-triggers';
import { isBlockEligible, decideBlock } from '../../../src/audit/gate/gate-decision';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type {
  TypeSuppressionControls,
  TypeSuppressionProofRecord,
  TypeSuppressionVerdict,
} from '../../../src/audit/execution-grounded/type-suppression-restoration';
import type { AuditResult } from '../../../src/audit/types';

const REPRODUCE =
  'git fetch origin pull/9/head && git checkout abc1234 && ' +
  "git apply -R <<'SWARM_RESTORE_PATCH' && npx tsc --noEmit --pretty false -p tsconfig.json";

const allGreen: TypeSuppressionControls = {
  directiveRemoved: true,
  fileCleanAsSubmitted: true,
  diagnosticSurfacesWhenRemoved: true,
};

function provenRecord(overrides: Partial<TypeSuppressionProofRecord> = {}): TypeSuppressionProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'proven',
    category: 'type-suppression',
    findingFile: 'src/calc.ts',
    removedDirectives: ['@ts-ignore'],
    surfacedDiagnostics: ["src/calc.ts(3,17): error: Cannot find name 'missing'."],
    controls: { ...allGreen },
    reproduceCommand: REPRODUCE,
    revertedHunkPatch: 'diff --git a/src/calc.ts b/src/calc.ts\n',
    ...overrides,
  };
}

const NOT_PROVEN_VERDICTS: TypeSuppressionVerdict[] = [
  'refuted',
  'not-proven:non-typescript-file',
  'not-proven:not-tsc-checkable',
  'not-proven:no-suppression-hunks',
  'not-proven:no-tsconfig',
  'not-proven:tsc-unavailable',
  'not-proven:file-drifted',
  'not-proven:already-failing',
  'not-proven:patch-apply-failed',
  'not-proven:no-workspace',
  'not-proven:execution-error',
];

describe('detectTypeSuppressionProven (T7)', () => {
  it('fires one trigger per proven record with all controls true', () => {
    const triggers = detectTypeSuppressionProven({
      typeSuppressionRestorations: [provenRecord(), provenRecord({ findingFile: 'src/pay.ts' })],
    });
    assert.equal(triggers.length, 2);
    for (const trigger of triggers) {
      assert.equal(trigger.kind, 'type-suppression-proven');
      assert.equal(trigger.reproduce, REPRODUCE);
      assert.ok(trigger.summary.length > 0);
    }
  });

  it('carries the proof record facts intact in its evidence', () => {
    const record = provenRecord();
    const evidence = detectTypeSuppressionProven({ typeSuppressionRestorations: [record] })[0]!
      .evidence as TypeSuppressionProvenEvidence;
    assert.equal(evidence.kind, 'type-suppression-proven');
    assert.equal(evidence.verdict, 'proven');
    assert.equal(evidence.file, record.findingFile);
    assert.deepEqual(evidence.removedDirectives, record.removedDirectives);
    assert.deepEqual(evidence.surfacedDiagnostics, record.surfacedDiagnostics);
    assert.deepEqual(evidence.controls, allGreen);
    assert.equal(evidence.reproduceCommand, record.reproduceCommand);
  });

  it('round-trips its evidence through JSON unchanged', () => {
    const trigger = detectTypeSuppressionProven({ typeSuppressionRestorations: [provenRecord()] })[0]!;
    const round = JSON.parse(JSON.stringify(trigger)) as BlockTrigger;
    assert.deepEqual(round, trigger);
  });

  it('fires nothing for a proven record with any control null (advisory only)', () => {
    const keys: (keyof TypeSuppressionControls)[] = [
      'directiveRemoved',
      'fileCleanAsSubmitted',
      'diagnosticSurfacesWhenRemoved',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: null } });
      assert.equal(
        detectTypeSuppressionProven({ typeSuppressionRestorations: [record] }).length,
        0,
        `a proven record with ${key} unexecuted must stay advisory`,
      );
    }
  });

  it('fires nothing for a proven record with any control false (fail closed)', () => {
    const keys: (keyof TypeSuppressionControls)[] = [
      'directiveRemoved',
      'fileCleanAsSubmitted',
      'diagnosticSurfacesWhenRemoved',
    ];
    for (const key of keys) {
      const record = provenRecord({ controls: { ...allGreen, [key]: false } });
      assert.equal(
        detectTypeSuppressionProven({ typeSuppressionRestorations: [record] }).length,
        0,
        `a proven record with ${key} false must not become a candidate`,
      );
    }
  });

  it('fires nothing for refuted and every not-proven verdict', () => {
    for (const verdict of NOT_PROVEN_VERDICTS) {
      const record = provenRecord({ verdict });
      assert.equal(
        detectTypeSuppressionProven({ typeSuppressionRestorations: [record] }).length,
        0,
        `verdict ${verdict} must produce no trigger`,
      );
    }
  });

  it('returns [] for empty typeSuppressionRestorations', () => {
    assert.deepEqual(detectTypeSuppressionProven({ typeSuppressionRestorations: [] }), []);
  });
});

describe('detectBlockTriggers with typeSuppressionRestorations', () => {
  it('includes type-suppression-proven candidates alongside other kinds', () => {
    const triggers = detectBlockTriggers({
      obligations: [
        { obligationType: 'test-must-pass', passed: false, command: 'npm test', detail: 'failed' },
      ],
      typeSuppressionRestorations: { typeSuppressionRestorations: [provenRecord()] },
    });
    const kinds = triggers.map((t) => t.kind).sort();
    assert.deepEqual(kinds, ['obligation-failure', 'type-suppression-proven']);
  });

  it('skips the trigger when context.typeSuppressionRestorations is absent', () => {
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

describe('type-suppression-proven eligibility and gating', () => {
  it('is block-eligible by kind under the self-certifying tier', () => {
    assert.equal(isBlockEligible('type-suppression-proven'), true);
  });

  it('controlsAllGreen is true only when all three controls are true', () => {
    const green = detectTypeSuppressionProven({ typeSuppressionRestorations: [provenRecord()] })[0]!;
    assert.equal(controlsAllGreen(green), true);
  });

  it('gates a merge in gate mode when controls are all green', () => {
    const trigger = detectTypeSuppressionProven({ typeSuppressionRestorations: [provenRecord()] })[0]!;
    const decision = decideBlock([trigger], 'gate', true);
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockingTriggers.length, 1);
  });

  it('never blocks in advise mode', () => {
    const trigger = detectTypeSuppressionProven({ typeSuppressionRestorations: [provenRecord()] })[0]!;
    assert.equal(decideBlock([trigger], 'advise', true).blocked, false);
  });
});

describe('type-suppression-proven rendering', () => {
  function trigger(): BlockTrigger {
    return detectTypeSuppressionProven({ typeSuppressionRestorations: [provenRecord()] })[0]!;
  }

  function baseResult(): AuditResult {
    return { pass: true, findings: [], generatedAt: '2026-01-01T00:00:00.000Z', detectorVersions: {} };
  }

  it('renders the section with the reproduce command and the three controls', () => {
    const md = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.match(md, /type-suppression-proven/);
    assert.match(md, /git apply -R/);
    assert.match(md, /Verdict:.*proven/i);
    assert.match(md, /Added directive reverted in the sandbox.*✅/);
    assert.match(md, /File typechecks clean as submitted.*✅/);
    assert.match(md, /A tsc diagnostic surfaces once the directive is gone.*✅/);
    assert.match(md, /Cannot find name 'missing'/);
  });

  it('embeds the reproduce command in the full PR comment', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [trigger()] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /npx tsc/);
  });

  it('renders byte-identical across renders', () => {
    const a = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    const b = renderBlockTriggerSection([trigger()], 'gate').join('\n');
    assert.equal(a, b);
  });
});
