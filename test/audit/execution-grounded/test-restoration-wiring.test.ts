import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyRestorationToFinding,
  budgetExhaustedRecords,
  noWorkspaceRecords,
  persistRestorationProofs,
  restorationBudgetExhausted,
  runExecutionGrounded,
  RESTORATION_MIN_BUDGET_MS,
  type ExecutionGroundedInput,
  type ExecutionGroundedOutcome,
  type RestorationProofEnvelope,
} from '../../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../../src/audit/cheat-detector/audit-config';
import type { Finding } from '../../../src/audit/types';
import type {
  RestorationProofRecord,
  RestorationVerdict,
} from '../../../src/audit/execution-grounded/test-restoration';

// Wiring of the test-restoration proof engine into the execution-grounded
// orchestrator: the outcome carries every proof record, qualifying findings
// still produce honest no-workspace records when the layer bails before a
// sandbox exists, the records persist as a PR-identity-stamped envelope on
// every enabled run with an evidenceDir (written empty up front so a stale
// envelope from a prior run cannot outlive even a run that throws), and a
// verdict rides back onto its structural finding (refuted demotes, proven
// corroborates, everything else is record-only).

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function baseConfig(over: Partial<ExecutionGroundedConfig> = {}): ExecutionGroundedConfig {
  return {
    enabled: true,
    mutation: true,
    issueRepro: false,
    coverage: true,
    maxWallClockPerPrMs: 60_000,
    runner: 'host',
    corroborateStructural: false,
    ...over,
  };
}

function baseInput(over: Partial<ExecutionGroundedInput> = {}): ExecutionGroundedInput {
  return {
    prDiff: '',
    repo: 'o/r',
    prNumber: 1,
    prHeadSha: 'a'.repeat(40),
    config: baseConfig(),
    baseDir: tempDir('swarm-eg-restoration-'),
    ...over,
  };
}

function blockFinding(over: Partial<Finding> = {}): Finding {
  return {
    category: 'assertion-strip',
    severity: 'block',
    message: 'assertion removed from test',
    location: { file: 'test/calc.test.ts', line: 4 },
    evidence: '-  expect(add(1, 2)).toBe(3);',
    ...over,
  };
}

function proofRecord(
  verdict: RestorationVerdict,
  over: Partial<RestorationProofRecord> = {},
): RestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'assertion-strip',
    findingFile: 'test/calc.test.ts',
    testFiles: ['test/calc.test.ts'],
    failingTests: [],
    controls: {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: null,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
    ...over,
  };
}

function readEnvelope(evidenceDir: string): RestorationProofEnvelope {
  return JSON.parse(
    fs.readFileSync(path.join(evidenceDir, 'restoration-proof.json'), 'utf8'),
  ) as RestorationProofEnvelope;
}

const DOC_DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # title',
  '+a new line',
  '',
].join('\n');

describe('execution-grounded / test-restoration wiring', () => {
  describe('outcome shape', () => {
    it('the disabled path returns an empty restorations array (the layer never ran)', async () => {
      const outcome: ExecutionGroundedOutcome = await runExecutionGrounded(
        baseInput({
          config: baseConfig({ enabled: false }),
          structuralFindings: [blockFinding()],
        }),
      );
      assert.deepEqual(outcome.restorations, []);
    });

    it('the disabled path never writes a proof file (nothing was promised to run)', async () => {
      const evidenceDir = tempDir('swarm-eg-evidence-');
      await runExecutionGrounded(
        baseInput({
          config: baseConfig({ enabled: false }),
          evidenceDir,
          structuralFindings: [blockFinding()],
        }),
      );
      assert.ok(!fs.existsSync(path.join(evidenceDir, 'restoration-proof.json')));
    });
  });

  describe('no-workspace honesty records', () => {
    it('an enabled run that bails before provisioning yields one record per qualifying finding', async () => {
      // DOC_DIFF has no mutable source line, so the layer returns before any
      // workspace exists; the qualifying block finding must not vanish.
      const qualifying = blockFinding();
      const ineligibleSeverity = blockFinding({ severity: 'warn' });
      const ineligibleCategory = blockFinding({ category: 'no-op-fix' });
      const outcome = await runExecutionGrounded(
        baseInput({
          prDiff: DOC_DIFF,
          structuralFindings: [qualifying, ineligibleSeverity, ineligibleCategory],
        }),
      );
      assert.equal(outcome.restorations.length, 1);
      const record = outcome.restorations[0]!;
      assert.equal(record.verdict, 'not-proven:no-workspace');
      assert.equal(record.category, 'assertion-strip');
      assert.equal(record.findingFile, 'test/calc.test.ts');
      assert.ok(record.reason !== undefined && record.reason.length > 0, 'carries a loud reason');
    });

    it('persists the no-workspace records as an identity-stamped envelope when evidenceDir is set', async () => {
      const evidenceDir = tempDir('swarm-eg-evidence-');
      await runExecutionGrounded(
        baseInput({ prDiff: DOC_DIFF, evidenceDir, structuralFindings: [blockFinding()] }),
      );
      const envelope = readEnvelope(evidenceDir);
      assert.equal(envelope.schemaVersion, 1);
      assert.equal(envelope.prRef, 'o/r#1');
      assert.equal(envelope.prHeadSha, 'a'.repeat(40));
      assert.ok(!Number.isNaN(Date.parse(envelope.generatedAt)), 'generatedAt is ISO-parseable');
      assert.equal(envelope.records.length, 1);
      assert.equal(envelope.records[0]!.verdict, 'not-proven:no-workspace');
    });

    it('an enabled bail with zero qualifying findings still overwrites the proof file', async () => {
      const evidenceDir = tempDir('swarm-eg-evidence-');
      // A stale file from an earlier head SHA claiming a proven restoration.
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'restoration-proof.json'),
        JSON.stringify([proofRecord('proven')]),
        'utf8',
      );
      await runExecutionGrounded(
        baseInput({ prDiff: DOC_DIFF, evidenceDir, structuralFindings: [] }),
      );
      const envelope = readEnvelope(evidenceDir);
      assert.equal(envelope.prRef, 'o/r#1');
      assert.deepEqual(envelope.records, [], 'an empty records array is itself evidence');
    });

    it('a stale envelope from a prior run never survives an enabled run with qualifying findings', async () => {
      const evidenceDir = tempDir('swarm-eg-evidence-');
      // A stale envelope from an earlier run, different PR identity, claiming
      // a proven restoration.
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, 'restoration-proof.json'),
        JSON.stringify({
          schemaVersion: 1,
          prRef: 'old/run#9',
          prHeadSha: 'c'.repeat(40),
          generatedAt: new Date(0).toISOString(),
          records: [proofRecord('proven')],
        }),
        'utf8',
      );
      await runExecutionGrounded(
        baseInput({ prDiff: DOC_DIFF, evidenceDir, structuralFindings: [blockFinding()] }),
      );
      const envelope = readEnvelope(evidenceDir);
      assert.equal(envelope.prRef, 'o/r#1', 'the stale identity is gone');
      assert.ok(
        envelope.records.every((r) => r.verdict === 'not-proven:no-workspace'),
        'the stale proven claim did not survive',
      );
    });

    it('noWorkspaceRecords builds a null-control, empty-evidence record per finding', () => {
      const records = noWorkspaceRecords(
        [
          blockFinding(),
          blockFinding({
            category: 'test-relaxation',
            location: { file: 'test/b.test.ts', line: 1 },
          }),
        ],
        'provisioning failed: network down',
      );
      assert.equal(records.length, 2);
      for (const r of records) {
        assert.equal(r.schemaVersion, 1);
        assert.equal(r.verdict, 'not-proven:no-workspace');
        assert.deepEqual(r.controls, {
          baseTestPasses: null,
          tamperedSuitePasses: null,
          restoredFailsTwiceSameIdentity: null,
        });
        assert.deepEqual(r.testFiles, []);
        assert.deepEqual(r.failingTests, []);
        assert.equal(r.reproduceCommand, '');
        assert.equal(r.revertedHunkPatch, '');
        assert.match(r.reason ?? '', /network down/);
      }
      assert.equal(records[0]!.category, 'assertion-strip');
      assert.equal(records[1]!.category, 'test-relaxation');
      assert.equal(records[1]!.findingFile, 'test/b.test.ts');
    });
  });

  describe('wall-clock budget exhaustion', () => {
    it('budgetExhaustedRecords claims no execution: all controls null, every evidence field empty', () => {
      const records = budgetExhaustedRecords([
        blockFinding(),
        blockFinding({
          category: 'coverage-erosion',
          location: { file: 'test/b.test.ts', line: 2 },
        }),
      ]);
      assert.equal(records.length, 2);
      for (const r of records) {
        assert.equal(r.schemaVersion, 1);
        assert.equal(r.verdict, 'not-proven:execution-error');
        assert.deepEqual(r.controls, {
          baseTestPasses: null,
          tamperedSuitePasses: null,
          restoredFailsTwiceSameIdentity: null,
        });
        assert.deepEqual(r.testFiles, []);
        assert.deepEqual(r.failingTests, []);
        assert.equal(r.reproduceCommand, '');
        assert.equal(r.revertedHunkPatch, '');
        assert.match(
          r.reason ?? '',
          /wall-clock budget exhausted before any test run executed/,
          'the reason must be loud about why nothing ran',
        );
      }
      assert.equal(records[0]!.category, 'assertion-strip');
      assert.equal(records[1]!.category, 'coverage-erosion');
      assert.equal(records[1]!.findingFile, 'test/b.test.ts');
    });

    it('restorationBudgetExhausted trips below the floor, at the deadline, and past it', () => {
      const now = 1_000_000;
      assert.equal(restorationBudgetExhausted(now + RESTORATION_MIN_BUDGET_MS, now), false);
      assert.equal(restorationBudgetExhausted(now + RESTORATION_MIN_BUDGET_MS - 1, now), true);
      assert.equal(restorationBudgetExhausted(now, now), true);
      assert.equal(restorationBudgetExhausted(now - 1, now), true);
    });
  });

  describe('persistRestorationProofs', () => {
    it('writes an envelope stamping PR identity over every record', () => {
      const evidenceDir = path.join(tempDir('swarm-eg-persist-'), 'nested');
      const records = [
        proofRecord('proven'),
        proofRecord('refuted'),
        proofRecord('not-proven:flaky'),
      ];
      persistRestorationProofs(
        { prRef: 'octo/calc#7', prHeadSha: 'b'.repeat(40), records },
        evidenceDir,
      );
      const envelope = readEnvelope(evidenceDir);
      assert.equal(envelope.schemaVersion, 1);
      assert.equal(envelope.prRef, 'octo/calc#7');
      assert.equal(envelope.prHeadSha, 'b'.repeat(40));
      assert.ok(!Number.isNaN(Date.parse(envelope.generatedAt)));
      assert.deepEqual(envelope.records, records);
    });

    it('writes the envelope even when there are no records', () => {
      const evidenceDir = tempDir('swarm-eg-persist-');
      persistRestorationProofs(
        { prRef: 'octo/calc#7', prHeadSha: 'b'.repeat(40), records: [] },
        evidenceDir,
      );
      assert.deepEqual(readEnvelope(evidenceDir).records, []);
    });
  });

  describe('applyRestorationToFinding', () => {
    it('refuted demotes the finding to info with a legitimate-refactor note', () => {
      const finding = blockFinding();
      const before = finding.evidence;
      applyRestorationToFinding(finding, proofRecord('refuted'));
      assert.equal(finding.severity, 'info');
      assert.ok(finding.evidence.startsWith(before), 'original evidence preserved');
      assert.match(finding.evidence, /restored original test passes/i);
      assert.match(finding.evidence, /legitimate refactor/i);
      // Sharpened: the demotion names the test execution that cleared it, so a
      // reader knows exactly what was run, not just that "a" test passed.
      assert.match(finding.evidence, /test\/calc\.test\.ts/);
      assert.equal(finding.runtimeCorroboration, undefined);
    });

    it('refuted recomputes confidence down so the grade matches the demoted severity', () => {
      const finding = blockFinding({ judgeConfirmed: true, confidence: 'judge-confirmed' });
      applyRestorationToFinding(finding, proofRecord('refuted'));
      assert.equal(finding.severity, 'info');
      assert.equal(
        finding.confidence,
        'structural-only',
        'a judge-confirmed badge must not outlive the block it confirmed',
      );
    });

    it('proven corroborates the finding and raises confidence through the shared setter', () => {
      const finding = blockFinding();
      const record = proofRecord('proven', {
        failingTests: ['calc › add returns the sum'],
        controls: {
          baseTestPasses: true,
          tamperedSuitePasses: true,
          restoredFailsTwiceSameIdentity: true,
        },
      });
      applyRestorationToFinding(finding, record);
      assert.equal(finding.severity, 'block', 'severity untouched');
      assert.ok(finding.runtimeCorroboration !== undefined);
      assert.equal(finding.runtimeCorroboration.signal, 'restored-test-fails');
      assert.deepEqual(finding.runtimeCorroboration.failingTests, ['calc › add returns the sum']);
      assert.equal(finding.confidence, 'runtime-corroborated');
    });

    it('any other verdict is record-only: the finding is untouched', () => {
      const finding = blockFinding();
      const snapshot = JSON.parse(JSON.stringify(finding)) as Finding;
      applyRestorationToFinding(finding, proofRecord('not-proven:flaky'));
      applyRestorationToFinding(finding, proofRecord('not-proven:suite-already-failing'));
      applyRestorationToFinding(finding, proofRecord('not-proven:no-workspace'));
      assert.deepEqual(finding, snapshot);
    });
  });
});
