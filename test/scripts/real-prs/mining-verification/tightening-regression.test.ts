import { strict as assert } from 'node:assert';
import { classifyPr } from '../../../../scripts/real-prs/mining-verification/tightening-regression';

function e(author: string, body: string, authorType?: string) {
  return { source: 'issue-comment', author, authorType, body };
}

describe('tightening-regression classifyPr', () => {
  it('admits a PR whose cheat phrase came from a non-author human', () => {
    const r = classifyPr('r-1', 'o/r', 1, 'author', [e('maintainer', 'this no longer asserts')]);
    assert.equal(r.oldHit, true);
    assert.equal(r.newHit, true);
    assert.equal(r.excludedReason, undefined);
  });

  it('excludes a self-only match (the PR author used the phrase for their own change)', () => {
    const r = classifyPr('r-2', 'o/r', 2, 'jphein', [e('jphein', 'this is a no-op optimization')]);
    assert.equal(r.oldHit, true);
    assert.equal(r.newHit, false);
    assert.equal(r.excludedReason, 'self-only');
  });

  it('excludes a bot-only match (Copilot review surface)', () => {
    const r = classifyPr('r-3', 'o/r', 3, 'author', [e('Copilot', 'this no longer asserts the count')]);
    assert.equal(r.newHit, false);
    assert.equal(r.excludedReason, 'bot-only');
  });

  it('reports self-and-bot when both a self and a bot match but no human', () => {
    const r = classifyPr('r-4', 'o/r', 4, 'author', [e('author', 'no longer asserts'), e('svc', 'no longer asserts', 'Bot')]);
    assert.equal(r.newHit, false);
    assert.equal(r.excludedReason, 'self-and-bot');
  });

  it('is a clean miss when no cheat phrase matched at all', () => {
    const r = classifyPr('r-5', 'o/r', 5, 'author', [e('maintainer', 'please rebase onto main')]);
    assert.equal(r.oldHit, false);
    assert.equal(r.newHit, false);
    assert.equal(r.excludedReason, undefined);
  });
});
