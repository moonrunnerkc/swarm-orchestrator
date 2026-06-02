import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildMutateScope,
  correlateMutationsWithProof,
  generateStrykerConfig,
  parseStrykerReport,
  runMutationCheck,
  summarizeMutations,
} from '../../../src/audit/execution-grounded/mutation-check';
import type { ChangedLineRanges } from '../../../src/audit/cheat-detector/diff-walker';

const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REPORT = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures', 'stryker-report.json'),
    'utf8',
  ),
) as unknown;

// calc.ts changed lines 2-6 (post-image). Line 40 is outside the change.
const CHANGED: ChangedLineRanges = { 'src/calc.ts': [{ start: 2, end: 6 }] };

describe('execution-grounded / mutation-check (pure logic)', () => {
  describe('buildMutateScope', () => {
    it('emits file:start-end patterns for each range', () => {
      const scope = buildMutateScope({ 'src/a.ts': [{ start: 2, end: 3 }, { start: 7, end: 7 }] });
      assert.deepEqual(scope.patterns, ['src/a.ts:2-3', 'src/a.ts:7-7']);
      assert.equal(scope.includedLines, 3);
      assert.equal(scope.droppedLines, 0);
    });
    it('glob-escapes file paths so dynamic-route names do not break the run', () => {
      const scope = buildMutateScope({ 'src/pages/api/[id].ts': [{ start: 1, end: 2 }] });
      assert.deepEqual(scope.patterns, ['src/pages/api/\\[id\\].ts:1-2']);
    });
    it('caps the total changed lines and reports the drop, never silently', () => {
      const scope = buildMutateScope({ 'src/a.ts': [{ start: 1, end: 100 }] }, 10);
      assert.deepEqual(scope.patterns, ['src/a.ts:1-10']);
      assert.equal(scope.includedLines, 10);
      assert.equal(scope.droppedLines, 90);
    });
  });

  describe('generateStrykerConfig', () => {
    it('scopes mutate to the patterns and disables the break threshold', () => {
      const cfg = generateStrykerConfig({ testRunner: 'mocha', mutate: ['src/a.ts:1-2'], concurrency: 3 });
      assert.equal(cfg.testRunner, 'mocha');
      assert.deepEqual(cfg.plugins, ['@stryker-mutator/mocha-runner']);
      assert.deepEqual(cfg.reporters, ['json']);
      assert.deepEqual(cfg.mutate, ['src/a.ts:1-2']);
      assert.equal(cfg.concurrency, 3);
      assert.equal(cfg.thresholds.break, null);
      assert.equal(cfg.disableTypeChecks, true);
    });
  });

  describe('parseStrykerReport', () => {
    const results = parseStrykerReport(REPORT, CHANGED);
    it('keeps only mutants on changed lines', () => {
      assert.equal(results.find((m) => m.line === 40), undefined, 'line 40 is outside the change');
      assert.equal(results.length, 5);
    });
    it('counts Killed and Timeout as killed', () => {
      assert.equal(results.find((m) => m.line === 2 && m.mutator === 'ArithmeticOperator')?.killed, true);
      assert.equal(results.find((m) => m.line === 5)?.killed, true, 'Timeout is a kill');
    });
    it('records the raw status for non-killed mutants', () => {
      assert.equal(results.find((m) => m.line === 3)?.status, 'Survived');
      assert.equal(results.find((m) => m.line === 3)?.survivedReason, 'Survived');
      assert.equal(results.find((m) => m.line === 6)?.status, 'NoCoverage');
    });
  });

  describe('summarizeMutations', () => {
    it('buckets by status', () => {
      const s = summarizeMutations(parseStrykerReport(REPORT, CHANGED));
      assert.equal(s.total, 5);
      assert.equal(s.killed, 2);
      assert.equal(s.survived, 1);
      assert.equal(s.noCoverage, 1);
      assert.equal(s.errored, 1);
    });
  });

  describe('correlateMutationsWithProof', () => {
    it('flags survivors on lines the proof later changed as high-confidence', () => {
      const results = parseStrykerReport(REPORT, CHANGED);
      // The hotfix touched line 3 of calc.ts.
      const proof: ChangedLineRanges = { 'src/calc.ts': [{ start: 3, end: 3 }] };
      const { highConfidenceCatches, otherSurvivors } = correlateMutationsWithProof(results, proof);
      assert.deepEqual(highConfidenceCatches.map((m) => m.line), [3]);
      assert.deepEqual(otherSurvivors.map((m) => m.line).sort(), [6]);
    });
    it('returns no high-confidence catches when the proof touches unrelated lines', () => {
      const results = parseStrykerReport(REPORT, CHANGED);
      const proof: ChangedLineRanges = { 'src/calc.ts': [{ start: 99, end: 99 }] };
      const { highConfidenceCatches } = correlateMutationsWithProof(results, proof);
      assert.equal(highConfidenceCatches.length, 0);
    });
  });

  (INTEGRATION ? describe : describe.skip)('runMutationCheck (live, against the sample repo)', function () {
    this.timeout(5 * 60 * 1000);
    it('kills the constrained mutant and surfaces the under-tested branch', () => {
      const sample = path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures', 'sample-repo');
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-mut-it-'));
      try {
        execFileSync('cp', ['-R', `${sample}/.`, ws]);
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore', timeout: 5 * 60 * 1000 });
        const outcome = runMutationCheck({
          workspacePath: ws,
          changedLines: { 'src/calc.js': [{ start: 1, end: 9 }] },
          testRunner: 'mocha',
          timeoutMs: 4 * 60 * 1000,
        });
        assert.equal(outcome.ran, true, outcome.skipReason ?? 'run should succeed');
        assert.ok(outcome.summary.killed >= 1, 'at least one mutant killed');
        assert.ok(outcome.summary.survived >= 1, 'at least one mutant survived');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
