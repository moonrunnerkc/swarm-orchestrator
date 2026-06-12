import { strict as assert } from 'assert';
import type { CheatCategory, Finding } from '../../../src/audit/types';
import {
  corroborateStructuralFindings,
  corroborationFor,
  executionSignalsFromOutcome,
  type ExecutionSignals,
} from '../../../src/audit/execution-grounded/corroborate';
import type { ExecutionGroundedOutcome } from '../../../src/audit/execution-grounded';

function finding(category: CheatCategory, file: string, line: number, endLine?: number): Finding {
  return {
    category,
    severity: 'warn',
    message: `${category} at ${file}:${line}`,
    location: endLine !== undefined ? { file, line, endLine } : { file, line },
    evidence: 'x',
  };
}

const NO_SIGNALS: ExecutionSignals = { survivingMutants: [], coverageGaps: [], reproFailures: [] };

describe('execution-grounded / corroborate', () => {
  describe('corroborationFor', () => {
    it('boosts a coverage-erosion finding with a surviving mutant on the same line', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [{ file: 'src/a.ts', line: 12, id: 'BlockStatement@src/a.ts:12 -> Survived' }],
        coverageGaps: [],
        reproFailures: [],
      };
      const c = corroborationFor(finding('coverage-erosion', 'src/a.ts', 12), signals);
      assert.ok(c !== null);
      assert.equal(c.signal, 'surviving-mutant');
      assert.deepEqual(c.mutants, ['BlockStatement@src/a.ts:12 -> Survived']);
    });

    it('does not boost when the mutant is on a different file or outside the finding range', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [
          { file: 'src/other.ts', line: 12, id: 'm1' },
          { file: 'src/a.ts', line: 99, id: 'm2' },
        ],
        coverageGaps: [],
        reproFailures: [],
      };
      assert.equal(corroborationFor(finding('coverage-erosion', 'src/a.ts', 12), signals), null);
    });

    it('matches a mutant anywhere inside a multi-line finding range', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [{ file: 'src/a.ts', line: 15, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      };
      const c = corroborationFor(finding('assertion-strip', 'src/a.ts', 10, 20), signals);
      assert.ok(c !== null && c.signal === 'surviving-mutant');
    });

    it('does not corroborate a category outside the eligible set, even with a matching mutant', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [{ file: 'src/a.ts', line: 12, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      };
      // no-op-fix is not in any corroborates set
      assert.equal(corroborationFor(finding('no-op-fix', 'src/a.ts', 12), signals), null);
    });

    it('corroborates assertion-strip via a coverage gap, carrying the uncovered lines', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [],
        coverageGaps: [{ file: 'src/a.ts', line: 7 }],
        reproFailures: [],
      };
      const c = corroborationFor(finding('assertion-strip', 'src/a.ts', 7), signals);
      assert.ok(c !== null && c.signal === 'coverage-gap');
      assert.deepEqual(c.uncoveredLines, [7]);
    });

    it('prefers a surviving mutant over a coverage gap when both apply', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [{ file: 'src/a.ts', line: 5, id: 'm' }],
        coverageGaps: [{ file: 'src/a.ts', line: 5 }],
        reproFailures: [],
      };
      const c = corroborationFor(finding('coverage-erosion', 'src/a.ts', 5), signals);
      assert.ok(c !== null && c.signal === 'surviving-mutant', 'the stronger signal wins');
    });

    it('corroborates goal-not-fixed PR-wide via a still-failing repro, regardless of file', () => {
      const signals: ExecutionSignals = {
        survivingMutants: [],
        coverageGaps: [],
        reproFailures: [{ issueRef: 'owner/repo#42' }],
      };
      const c = corroborationFor(finding('goal-not-fixed', 'issue-42-repro', 1), signals);
      assert.ok(c !== null && c.signal === 'repro-still-fails');
      assert.equal(c.repro, 'owner/repo#42');
    });

    it('returns null when there are no signals at all', () => {
      assert.equal(corroborationFor(finding('coverage-erosion', 'src/a.ts', 12), NO_SIGNALS), null);
    });
  });

  describe('corroborateStructuralFindings', () => {
    it('annotates only the backed findings and leaves the rest untouched', () => {
      const findings = [
        finding('coverage-erosion', 'src/a.ts', 12),
        finding('test-relaxation', 'src/b.ts', 3),
        finding('no-op-fix', 'src/a.ts', 12),
      ];
      const signals: ExecutionSignals = {
        survivingMutants: [{ file: 'src/a.ts', line: 12, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      };
      const backed = corroborateStructuralFindings(findings, signals);
      assert.equal(backed, 1);
      assert.ok(findings[0]!.runtimeCorroboration !== undefined, 'coverage-erosion is backed');
      assert.equal(findings[1]!.runtimeCorroboration, undefined, 'test-relaxation has no matching signal');
      assert.equal(findings[2]!.runtimeCorroboration, undefined, 'no-op-fix is not eligible');
    });

    it('raises a backed finding to runtime-corroborated through the shared setter', () => {
      const f = finding('test-relaxation', 'src/a.ts', 3);
      corroborateStructuralFindings([f], {
        survivingMutants: [{ file: 'src/a.ts', line: 3, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      });
      assert.equal(f.confidence, 'runtime-corroborated');
    });

    it('never clobbers a finding that already carries runtime backing', () => {
      const f = finding('assertion-strip', 'src/a.ts', 3);
      f.runtimeCorroboration = { signal: 'restored-test-fails', failingTests: ['suite › name'] };
      const n = corroborateStructuralFindings([f], {
        survivingMutants: [{ file: 'src/a.ts', line: 3, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      });
      assert.equal(n, 0, 'an already-backed finding is not re-counted');
      assert.equal(f.runtimeCorroboration.signal, 'restored-test-fails');
    });

    it('runtime corroboration outranks a prior judge-confirmed grade', () => {
      const f = finding('coverage-erosion', 'src/a.ts', 12);
      f.judgeConfirmed = true;
      f.confidence = 'judge-confirmed'; // as the judge gate would have left it
      corroborateStructuralFindings([f], {
        survivingMutants: [{ file: 'src/a.ts', line: 12, id: 'm' }],
        coverageGaps: [],
        reproFailures: [],
      });
      assert.equal(f.confidence, 'runtime-corroborated', 'strongest wins, never downgrades');
    });
  });

  describe('executionSignalsFromOutcome', () => {
    it('derives surviving mutants, coverage gaps, and repro failures, rerooted by package', () => {
      const outcome: ExecutionGroundedOutcome = {
        findings: [],
        skipped: [],
        restorations: [],
        mockRestorations: [],
        noOpRestorations: [],
        typeSuppressionRestorations: [],
        fakeRefactorRestorations: [],
        deadBranchRestorations: [],
        mutationRuns: [
          {
            packageDir: 'packages/core',
            outcome: {
              ran: true,
              results: [
                { file: 'src/a.ts', line: 5, mutator: 'Block', killed: false, status: 'Survived' },
                { file: 'src/a.ts', line: 6, mutator: 'Block', killed: true, status: 'Killed' },
                { file: 'src/b.ts', line: 9, mutator: 'Arith', killed: false, status: 'NoCoverage' },
              ],
              summary: { total: 3, killed: 1, survived: 1, noCoverage: 1, errored: 0 },
              scope: { patterns: [], includedLines: 0, droppedLines: 0 },
            },
          },
        ],
        coverageRuns: [
          {
            packageDir: '',
            outcome: {
              ran: true,
              deltas: [
                { file: 'src/c.ts', line: 2, addedOrModified: true, coveredAfter: false },
                { file: 'src/c.ts', line: 3, addedOrModified: true, coveredAfter: true },
              ],
            },
          },
        ],
        repros: [
          {
            issue: { owner: 'o', repo: 'r', number: 7 },
            repro: { kind: 'test', language: 'ts', code: '' },
            verdict: 'fix-not-delivered',
            preStatus: 'failed',
            postStatus: 'failed',
            preOutput: '',
            postOutput: '',
          },
          {
            issue: { owner: 'o', repo: 'r', number: 8 },
            repro: { kind: 'test', language: 'ts', code: '' },
            verdict: 'fix-delivered',
            preStatus: 'failed',
            postStatus: 'passed',
            preOutput: '',
            postOutput: '',
          },
        ],
      };
      const signals = executionSignalsFromOutcome(outcome);
      // Killed mutant dropped; the two non-killed rerooted to packages/core/...
      assert.deepEqual(
        signals.survivingMutants.map((m) => m.file),
        ['packages/core/src/a.ts', 'packages/core/src/b.ts'],
      );
      // Only the uncovered changed line; root package keeps the bare path.
      assert.deepEqual(signals.coverageGaps, [{ file: 'src/c.ts', line: 2 }]);
      // Only the fix-not-delivered repro counts.
      assert.deepEqual(signals.reproFailures, [{ issueRef: 'o/r#7' }]);
    });
  });
});
