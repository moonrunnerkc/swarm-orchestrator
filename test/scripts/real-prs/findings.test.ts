import { strict as assert } from 'assert';
import { normalizeFinding, findingKey } from '../../../scripts/real-prs/lib/findings';
import type { Finding } from '../../../src/audit/types';

function makeFinding(over: Partial<Finding>): Finding {
  return {
    category: 'no-op-fix',
    severity: 'warn',
    message: 'msg',
    location: { file: 'src/x.ts', line: 10 },
    evidence: 'ev',
    ...over,
  } as Finding;
}

describe('scripts/real-prs/lib/findings', () => {
  it('derives judge-primary path when judgePrimary is set', () => {
    const f = normalizeFinding('a/b', 7, makeFinding({ judgePrimary: true, judgeConfirmed: true }));
    assert.equal(f.judgePath, 'judge-primary');
  });

  it('derives judge-confirm path when only judgeConfirmed is set', () => {
    const f = normalizeFinding('a/b', 7, makeFinding({ judgeConfirmed: true }));
    assert.equal(f.judgePath, 'judge-confirm');
  });

  it('derives structural path by default', () => {
    const f = normalizeFinding('a/b', 7, makeFinding({}));
    assert.equal(f.judgePath, 'structural');
  });

  it('builds a stable key and lineRange', () => {
    const f = normalizeFinding('a/b', 7, makeFinding({ location: { file: 'src/x.ts', line: 10, endLine: 12 } }));
    assert.equal(f.key, findingKey('a/b', 7, 'no-op-fix', 'src/x.ts', 10));
    assert.deepEqual(f.lineRange, { start: 10, end: 12 });
  });

  it('carries the judge rationale through when present', () => {
    const f = normalizeFinding('a/b', 7, makeFinding({ judgeReasoning: 'because' }));
    assert.equal(f.judgeRationale, 'because');
  });
});
