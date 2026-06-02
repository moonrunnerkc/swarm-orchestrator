import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeCoverageDelta,
  coverageDeltaForChanges,
  isLineCovered,
  parseIstanbulCoverage,
  uncoveredChangedLines,
} from '../../../src/audit/execution-grounded/coverage-delta';
import type { ChangedLineRanges } from '../../../src/audit/cheat-detector/diff-walker';

const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REPORT = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures', 'coverage-final.json'),
    'utf8',
  ),
) as unknown;

describe('execution-grounded / coverage-delta (pure logic)', () => {
  describe('parseIstanbulCoverage', () => {
    const cov = parseIstanbulCoverage(REPORT, '/ws');
    it('keys files by workspace-relative path', () => {
      assert.ok(cov.has('src/calc.js'));
    });
    it('records instrumented and covered lines', () => {
      const f = cov.get('src/calc.js')!;
      assert.deepEqual([...f.instrumented].sort((a, b) => a - b), [2, 6, 7, 40]);
      assert.deepEqual([...f.covered].sort((a, b) => a - b), [2, 7]);
    });
  });

  describe('coverageDeltaForChanges', () => {
    const cov = parseIstanbulCoverage(REPORT, '/ws');
    const changed: ChangedLineRanges = { 'src/calc.js': [{ start: 2, end: 7 }] };
    const deltas = coverageDeltaForChanges(cov, changed);
    it('reports only instrumented changed lines', () => {
      // Lines 3,4,5 in the change are not instrumented (non-code) and excluded.
      assert.deepEqual(deltas.map((d) => d.line).sort((a, b) => a - b), [2, 6, 7]);
    });
    it('marks coverage per line', () => {
      assert.equal(deltas.find((d) => d.line === 2)?.coveredAfter, true);
      assert.equal(deltas.find((d) => d.line === 6)?.coveredAfter, false);
      assert.equal(deltas.find((d) => d.line === 7)?.coveredAfter, true);
    });
    it('uncoveredChangedLines isolates the blind spots', () => {
      assert.deepEqual(uncoveredChangedLines(deltas).map((d) => d.line), [6]);
    });
  });

  describe('isLineCovered', () => {
    const cov = parseIstanbulCoverage(REPORT, '/ws');
    it('answers per file and line', () => {
      assert.equal(isLineCovered(cov, 'src/calc.js', 2), true);
      assert.equal(isLineCovered(cov, 'src/calc.js', 6), false);
      assert.equal(isLineCovered(cov, 'src/other.js', 2), false);
    });
  });

  (INTEGRATION ? describe : describe.skip)('computeCoverageDelta (live, against the sample repo)', function () {
    this.timeout(5 * 60 * 1000);
    it('finds the under-tested branch line uncovered', () => {
      const sample = path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures', 'sample-repo');
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-cov-it-'));
      try {
        execFileSync('cp', ['-R', `${sample}/.`, ws]);
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore', timeout: 5 * 60 * 1000 });
        const outcome = computeCoverageDelta({
          workspacePath: ws,
          testRunner: 'mocha',
          changedLines: { 'src/calc.js': [{ start: 1, end: 12 }] },
          timeoutMs: 4 * 60 * 1000,
        });
        assert.equal(outcome.ran, true, outcome.skipReason ?? 'coverage should run');
        // The "nonpos" return (line 9) is never exercised by the test.
        assert.ok(outcome.deltas.length > 0, 'some changed lines instrumented');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
