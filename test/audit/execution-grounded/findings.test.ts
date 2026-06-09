import { strict as assert } from 'assert';
import {
  coverageFindings,
  mutableSourceFilter,
  mutationFindings,
  reproFindings,
  type ReproComparison,
} from '../../../src/audit/execution-grounded/index';
import type { MutationResult } from '../../../src/audit/execution-grounded/mutation-check';

describe('execution-grounded / finding builders', () => {
  describe('mutableSourceFilter', () => {
    it('accepts source JS/TS, rejects tests and non-code', () => {
      assert.equal(mutableSourceFilter('src/calc.ts'), true);
      assert.equal(mutableSourceFilter('packages/x/src/a.mjs'), true);
      assert.equal(mutableSourceFilter('src/calc.test.ts'), false);
      assert.equal(mutableSourceFilter('README.md'), false);
      assert.equal(mutableSourceFilter('package.json'), false);
    });
  });

  describe('mutationFindings', () => {
    const survivedCovered: MutationResult = { file: 'src/a.ts', line: 5, mutator: 'EqualityOperator', killed: false, status: 'Survived' };
    const noCoverage: MutationResult = { file: 'src/a.ts', line: 9, mutator: 'BooleanLiteral', killed: false, status: 'NoCoverage' };
    const killed: MutationResult = { file: 'src/a.ts', line: 2, mutator: 'ArithmeticOperator', killed: true, status: 'Killed' };

    it('ignores killed mutants', () => {
      assert.equal(mutationFindings([killed]).length, 0);
    });
    it('classifies a Survived mutant as on-changed-line (covered) when the run discriminates', () => {
      // A killed mutant in the same run proves the suite discriminates, so the
      // covered survivor is real signal.
      const f = mutationFindings([survivedCovered, killed]).find((x) => x.location.line === 5);
      assert.equal(f?.category, 'mutation-survives-on-changed-line');
      assert.equal(f?.severity, 'warn');
    });
    it('suppresses covered survivors when the run killed nothing (non-discriminating)', () => {
      // No kill anywhere in the run: the suite asserts nothing here, so a
      // covered survivor is an artifact, not signal.
      assert.equal(mutationFindings([survivedCovered]).length, 0);
    });
    it('still reports NoCoverage survivors even when the run killed nothing', () => {
      // An uncovered line is a coverage fact, independent of the suite killing.
      const [f] = mutationFindings([noCoverage]);
      assert.equal(f?.category, 'mutation-survives-on-uncovered-changed-line');
    });
    it('keeps per-line uncovered findings at or below the aggregation threshold', () => {
      const mutants: MutationResult[] = [9, 11, 14].map((line) => ({
        file: 'src/a.ts', line, mutator: 'BooleanLiteral', killed: false, status: 'NoCoverage',
      }));
      const fs = mutationFindings(mutants);
      assert.equal(fs.length, 3);
      assert.ok(fs.every((f) => f.category === 'mutation-survives-on-uncovered-changed-line'));
    });
    it('collapses an uncovered-survivor flood into one finding per file', () => {
      // The flood case: a PR adds an untested region and every line repeats the
      // same fact. One clean-corpus PR carried 32 such findings in one file.
      const mutants: MutationResult[] = [3, 4, 5, 6, 9].map((line) => ({
        file: 'src/region.ts', line, mutator: 'StringLiteral', killed: false, status: 'NoCoverage',
      }));
      const fs = mutationFindings(mutants);
      assert.equal(fs.length, 1);
      const f = fs[0];
      assert.equal(f?.category, 'mutation-survives-on-uncovered-changed-line');
      assert.equal(f?.location.line, 3);
      assert.equal(f?.location.endLine, 9);
      assert.ok(f?.message.includes('5 mutations across 5 uncovered changed lines'));
      assert.ok(f?.evidence.includes('3-6, 9'));
    });
    it('aggregates per file, not across files', () => {
      const mk = (file: string, line: number): MutationResult => ({
        file, line, mutator: 'BooleanLiteral', killed: false, status: 'NoCoverage',
      });
      const fs = mutationFindings([
        mk('src/a.ts', 1), mk('src/a.ts', 2), mk('src/a.ts', 3), mk('src/a.ts', 4),
        mk('src/b.ts', 7),
      ]);
      assert.equal(fs.filter((f) => f.location.file === 'src/a.ts').length, 1);
      assert.equal(fs.filter((f) => f.location.file === 'src/b.ts').length, 1);
      assert.equal(fs.find((f) => f.location.file === 'src/b.ts')?.evidence.includes('BooleanLiteral'), true);
    });
    it('never aggregates covered survivors; each is an independent signal', () => {
      const mutants: MutationResult[] = [1, 2, 3, 4, 5].map((line) => ({
        file: 'src/hot.ts', line, mutator: 'EqualityOperator', killed: false, status: 'Survived',
      }));
      const fs = mutationFindings([...mutants, killed]);
      assert.equal(fs.filter((f) => f.category === 'mutation-survives-on-changed-line').length, 5);
    });
    it('trusts Stryker coverage: a Survived mutant stays covered (suite discriminates)', () => {
      // Coverage comes from Stryker's own per-test analysis: a Survived mutant
      // was executed by the suite, so it is covered regardless of what a
      // separate istanbul run reports. With a kill in the run it is the strong
      // covered-survivor signal.
      const f = mutationFindings([survivedCovered, killed]).find((x) => x.location.line === 5);
      assert.equal(f?.category, 'mutation-survives-on-changed-line');
    });
  });

  describe('coverageFindings', () => {
    const deltas = [
      { file: 'src/a.ts', line: 5, addedOrModified: true, coveredAfter: true },
      { file: 'src/a.ts', line: 9, addedOrModified: true, coveredAfter: false },
      { file: 'src/a.ts', line: 12, addedOrModified: true, coveredAfter: false },
    ];
    it('flags only uncovered lines as info findings', () => {
      const fs = coverageFindings(deltas, new Set());
      assert.deepEqual(fs.map((f) => f.location.line).sort((a, b) => a - b), [9, 12]);
      assert.equal(fs[0]?.severity, 'info');
      assert.equal(fs[0]?.category, 'uncovered-changed-line');
    });
    it('suppresses lines a mutation finding already raised', () => {
      const fs = coverageFindings(deltas, new Set(['src/a.ts:9']));
      assert.deepEqual(fs.map((f) => f.location.line), [12]);
    });
  });

  describe('reproFindings', () => {
    const base = {
      issue: { owner: 'o', repo: 'r', number: 7 },
      repro: { kind: 'script' as const, language: 'js' as const, code: 'x' },
      preStatus: 'failed',
      postStatus: 'failed',
      preOutput: 'pre',
      postOutput: 'still broken',
    };
    it('raises issue-repro-still-fails for fix-not-delivered', () => {
      const fs = reproFindings([{ ...base, verdict: 'fix-not-delivered' } as ReproComparison]);
      assert.equal(fs[0]?.category, 'issue-repro-still-fails');
      assert.equal(fs[0]?.severity, 'warn');
      assert.ok(fs[0]?.evidence.includes('still broken'));
    });
    it('raises pr-breaks-issue-repro for pr-broke-repro', () => {
      const fs = reproFindings([{ ...base, verdict: 'pr-broke-repro' } as ReproComparison]);
      assert.equal(fs[0]?.category, 'pr-breaks-issue-repro');
    });
    it('emits nothing for delivered or non-reproducible verdicts', () => {
      assert.equal(reproFindings([{ ...base, verdict: 'fix-delivered' } as ReproComparison]).length, 0);
      assert.equal(reproFindings([{ ...base, verdict: 'not-reproducible' } as ReproComparison]).length, 0);
      assert.equal(reproFindings([{ ...base, verdict: 'unevaluable' } as ReproComparison]).length, 0);
    });
  });
});
