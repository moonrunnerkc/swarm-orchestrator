import { strict as assert } from 'assert';
import { layerHasWork, type ProofCandidates } from '../../../src/audit/execution-grounded';
import type { ChangedLineRanges } from '../../../src/audit/cheat-detector/diff-walker';
import type { Finding } from '../../../src/audit/types';

// The entry gate that Hunt 6 named: a .go/.py test-tamper must reach the polyglot
// restoration engine instead of bailing at the JS/TS mutation gate. layerHasWork
// is the predicate that decides whether the layer provisions at all.

function emptyCandidates(over: Partial<ProofCandidates> = {}): ProofCandidates {
  return { test: [], mock: [], noOp: null, typeSuppression: [], fakeRefactor: [], deadBranch: [], ...over };
}

function blockFinding(file: string, category: Finding['category']): Finding {
  return {
    category,
    severity: 'block',
    message: 'test-tamper',
    location: { file, line: 1 },
    evidence: 'e',
  };
}

const NO_CHANGED: ChangedLineRanges = {};
const JS_CHANGED: ChangedLineRanges = { 'src/calc.ts': [{ start: 1, end: 2 }] };

describe('execution-grounded / layerHasWork (entry gate)', () => {
  it('bails when there is no JS/TS mutable source and no proof candidate', () => {
    assert.equal(layerHasWork(NO_CHANGED, emptyCandidates()), false);
  });

  it('proceeds on a JS/TS mutable-source diff (TS path unchanged)', () => {
    assert.equal(layerHasWork(JS_CHANGED, emptyCandidates()), true);
  });

  it('proceeds on a Go test-tamper candidate even with no JS/TS mutable source', () => {
    const candidates = emptyCandidates({ test: [blockFinding('calc_test.go', 'test-relaxation')] });
    assert.equal(layerHasWork(NO_CHANGED, candidates), true);
  });

  it('proceeds on a Python test-tamper candidate even with no JS/TS mutable source', () => {
    const candidates = emptyCandidates({ test: [blockFinding('test_calc.py', 'assertion-strip')] });
    assert.equal(layerHasWork(NO_CHANGED, candidates), true);
  });

  it('proceeds on a no-op-fix candidate with no mutable source', () => {
    const candidates = emptyCandidates({
      noOp: { findingFile: 'calc.py', prIntent: { claimsFix: true, evidence: 'fixes #1' }, linkedIssueCount: 1 },
    });
    assert.equal(layerHasWork(NO_CHANGED, candidates), true);
  });
});
