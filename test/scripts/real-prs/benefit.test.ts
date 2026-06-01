import { strict as assert } from 'assert';
import {
  externalMatches,
  indexDualLabels,
  isArbiterSplit,
  isConfirmedFalseAlarm,
  isFlagged,
  recall,
  splitFindings,
} from '../../../scripts/real-prs/lib/benefit';
import type {
  DifferentialFinding,
  DualArbiterLabel,
  HarnessFinding,
} from '../../../scripts/real-prs/lib/types';

function finding(key: string, file: string, start: number, end: number): HarnessFinding {
  return {
    key,
    repo: 'o/r',
    prNumber: 1,
    category: 'no-op-fix',
    severity: 'warn',
    subjectPath: file,
    hunkIndex: null,
    lineRange: { start, end },
    judgePath: 'structural',
    message: 'm',
    evidence: 'e',
    judgeRationale: null,
  };
}

function ext(file: string, line: number): DifferentialFinding {
  return { tool: 'semgrep', ruleId: 'x', severity: 'INFO', file, line, message: 'm' };
}

describe('scripts/real-prs/lib/benefit', () => {
  it('matches an external finding within line slack on the same file', () => {
    assert.equal(externalMatches(finding('k', 'a.ts', 10, 12), ext('a.ts', 13)), true); // within +1
    assert.equal(externalMatches(finding('k', 'a.ts', 10, 12), ext('a.ts', 20)), false); // far
    assert.equal(externalMatches(finding('k', 'a.ts', 10, 12), ext('b.ts', 11)), false); // other file
  });

  it('splits findings into only-auditor, only-external, and both', () => {
    const auditor = [finding('k1', 'a.ts', 10, 10), finding('k2', 'b.ts', 5, 5)];
    const external = [ext('a.ts', 11), ext('c.ts', 1)];
    const split = splitFindings(auditor, external);
    assert.deepEqual(split.onlyAuditorKeys, ['k2']); // b.ts had no external match
    assert.equal(split.both, 1); // a.ts matched
    assert.equal(split.onlyExternal, 1); // c.ts unmatched
  });

  it('treats a whole-file (null range) auditor finding as matched on the same file', () => {
    const wholeFile: HarnessFinding = { ...finding('k', 'a.ts', 1, 1), lineRange: null };
    assert.equal(externalMatches(wholeFile, ext('a.ts', 999)), true);
    assert.equal(externalMatches(wholeFile, ext('z.ts', 1)), false);
  });

  it('computes recall as flagged over total', () => {
    assert.deepEqual(recall(3, 12), { flagged: 3, total: 12, rate: 0.25 });
    assert.deepEqual(recall(0, 0), { flagged: 0, total: 0, rate: 0 });
  });

  it('isFlagged is true only for a non-empty finding list', () => {
    assert.equal(isFlagged(null), false);
    assert.equal(isFlagged([]), false);
    assert.equal(isFlagged([finding('k', 'a.ts', 1, 1)]), true);
  });

  it('counts a confirmed false alarm only when both arbiters agree on false-alarm', () => {
    const labels: DualArbiterLabel[] = [
      {
        key: 'k1',
        repo: 'o/r',
        prNumber: 1,
        category: 'no-op-fix',
        judgePath: 'structural',
        primary: { model: 'local:m', verdict: 'false-alarm', confidence: 0.9 },
        secondary: { model: 'opus', verdict: 'false-alarm', confidence: 0.8 },
        agreed: true,
        verdict: 'false-alarm',
      },
      {
        key: 'k2',
        repo: 'o/r',
        prNumber: 1,
        category: 'no-op-fix',
        judgePath: 'structural',
        primary: { model: 'local:m', verdict: 'false-alarm', confidence: 0.9 },
        secondary: { model: 'opus', verdict: 'true-cheat', confidence: 0.8 },
        agreed: false,
        verdict: null,
      },
    ];
    const idx = indexDualLabels(labels);
    assert.equal(isConfirmedFalseAlarm(idx.get('k1')), true);
    assert.equal(isConfirmedFalseAlarm(idx.get('k2')), false);
    assert.equal(isArbiterSplit(idx.get('k2')), true);
    assert.equal(isArbiterSplit(idx.get('k1')), false);
    assert.equal(isConfirmedFalseAlarm(idx.get('missing')), false);
  });
});
