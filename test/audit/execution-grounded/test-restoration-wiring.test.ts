import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyRestorationToFinding,
  noWorkspaceRecords,
  persistRestorationProofs,
  runExecutionGrounded,
  type ExecutionGroundedInput,
  type ExecutionGroundedOutcome,
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
// sandbox exists, the records persist to evidenceDir in one write, and a
// verdict rides back onto its structural finding (refuted demotes, proven
// corroborates, everything else is record-only).

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
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-restoration-'));
  return {
    prDiff: '',
    repo: 'o/r',
    prNumber: 1,
    prHeadSha: 'a'.repeat(40),
    config: baseConfig(),
    baseDir,
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

function proofRecord(verdict: RestorationVerdict, over: Partial<RestorationProofRecord> = {}): RestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: 'assertion-strip',
    findingFile: 'test/calc.test.ts',
    testFiles: ['test/calc.test.ts'],
    failingTests: [],
    controls: { baseTestPasses: null, tamperedSuitePasses: true, restoredFailsTwiceSameIdentity: null },
    reproduceCommand: '',
    revertedHunkPatch: '',
    ...over,
  };
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

    it('persists the no-workspace records when evidenceDir is set', async () => {
      const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-evidence-'));
      await runExecutionGrounded(
        baseInput({ prDiff: DOC_DIFF, evidenceDir, structuralFindings: [blockFinding()] }),
      );
      const file = path.join(evidenceDir, 'restoration-proof.json');
      assert.ok(fs.existsSync(file), 'restoration-proof.json written');
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RestorationProofRecord[];
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0]!.verdict, 'not-proven:no-workspace');
    });

    it('noWorkspaceRecords builds a null-control, empty-evidence record per finding', () => {
      const records = noWorkspaceRecords(
        [blockFinding(), blockFinding({ category: 'test-relaxation', location: { file: 'test/b.test.ts', line: 1 } })],
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

  describe('persistRestorationProofs', () => {
    it('writes every record as one JSON array under evidenceDir', () => {
      const evidenceDir = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-persist-')),
        'nested',
      );
      const records = [proofRecord('proven'), proofRecord('refuted'), proofRecord('not-proven:flaky')];
      persistRestorationProofs(records, evidenceDir);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(evidenceDir, 'restoration-proof.json'), 'utf8'),
      ) as RestorationProofRecord[];
      assert.deepEqual(parsed, records);
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
      assert.equal(finding.runtimeCorroboration, undefined);
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
