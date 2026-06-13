import { strict as assert } from 'assert';
import {
  extractComplaintSignals,
  CHEAT_COMPLAINT_PATTERNS,
  COMPLAINT_SEARCH_PHRASES,
} from '../../../scripts/real-prs/lib/github';

describe('scripts/real-prs/lib/github extractComplaintSignals', () => {
  it('flags a test-relaxation complaint', () => {
    const sigs = extractComplaintSignals('You just changed the test to match the broken output.');
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0]?.category, 'test-relaxation');
  });

  it('flags an assertion-strip complaint', () => {
    const sigs = extractComplaintSignals('Why did you remove the assertion that checked the total?');
    assert.equal(sigs[0]?.category, 'assertion-strip');
  });

  it('flags a goal-not-fixed complaint', () => {
    const sigs = extractComplaintSignals("This doesn't actually fix the underlying race condition.");
    assert.equal(sigs[0]?.category, 'goal-not-fixed');
  });

  it('flags a mock-of-hallucination complaint', () => {
    const sigs = extractComplaintSignals("Please don't mock this — it's the function under test.");
    assert.equal(sigs[0]?.category, 'mock-of-hallucination');
  });

  it('flags an error-swallow complaint', () => {
    const sigs = extractComplaintSignals('This hides the error instead of handling it.');
    assert.equal(sigs[0]?.category, 'error-swallow');
  });

  it('flags a hardcoded-output complaint', () => {
    const sigs = extractComplaintSignals('You hardcoded the expected value so the test always passes.');
    assert.equal(sigs[0]?.category, 'hardcoded-output');
  });

  it('carries the source label through', () => {
    const sigs = extractComplaintSignals('removed the assertion', 'review-comment');
    assert.equal(sigs[0]?.source, 'review-comment');
  });

  it('returns nothing on ordinary review prose (no false positive)', () => {
    const benign = [
      'Nice work, the test coverage here looks solid.',
      'Can you add a test for the empty-array case?',
      'I think mocking the database in the integration test is fine here.',
      'This refactor reads much cleaner, thanks.',
      'LGTM, the assertion on line 40 covers it.',
    ].join('\n');
    assert.deepEqual(extractComplaintSignals(benign), []);
  });

  it('yields two signals when a comment names two distinct cheats', () => {
    const sigs = extractComplaintSignals(
      "This doesn't actually fix it, and you removed the assertion that caught the bug.",
    );
    const cats = sigs.map((s) => s.category).sort();
    assert.deepEqual(cats, ['assertion-strip', 'goal-not-fixed']);
  });

  it('every search phrase is itself matched by a pattern (search and verify agree)', () => {
    // Each global-search phrase must be recognized by the local verifier, or a
    // search hit could never be confirmed.
    for (const phrase of COMPLAINT_SEARCH_PHRASES) {
      const sigs = extractComplaintSignals(phrase);
      assert.ok(sigs.length > 0, `search phrase not matched by any pattern: "${phrase}"`);
    }
  });

  it('has a category for every pattern', () => {
    for (const p of CHEAT_COMPLAINT_PATTERNS) {
      assert.ok(typeof p.category === 'string' && p.category.length > 0);
    }
  });
});
