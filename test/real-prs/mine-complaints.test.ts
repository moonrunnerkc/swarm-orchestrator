import { strict as assert } from 'assert';
import {
  arbiterUnavailable,
  classifyArbiterAgreement,
  dedupeSignals,
} from '../../scripts/real-prs/mine-complaints';

describe('arbiterUnavailable (graceful arbiter skip)', () => {
  it('skips when an anthropic arbiter is requested but no key is present', () => {
    assert.equal(arbiterUnavailable(true, 'anthropic', 'anthropic', false), true);
    assert.equal(arbiterUnavailable(true, 'anthropic', 'local', false), true, 'either backend needing the key is enough');
  });

  it('runs when the anthropic key is present', () => {
    assert.equal(arbiterUnavailable(true, 'anthropic', 'anthropic', true), false);
  });

  it('never skips for this reason when no backend needs the key', () => {
    assert.equal(arbiterUnavailable(true, 'local', 'ollama', false), false);
  });

  it('is a no-op when the arbiter was not requested', () => {
    assert.equal(arbiterUnavailable(false, 'anthropic', 'anthropic', false), false);
  });
});

describe('classifyArbiterAgreement', () => {
  it('confirms only when both arbiters independently return true-cheat', () => {
    assert.deepEqual(classifyArbiterAgreement('true-cheat', 'true-cheat'), {
      agreed: true,
      confirmed: true,
    });
  });

  it('agrees-but-rejects when both return false-alarm', () => {
    assert.deepEqual(classifyArbiterAgreement('false-alarm', 'false-alarm'), {
      agreed: true,
      confirmed: false,
    });
  });

  it('marks a split as confirmed=null so it is excluded and counted, never a cheat', () => {
    const r = classifyArbiterAgreement('true-cheat', 'debatable');
    assert.equal(r.agreed, false);
    assert.equal(r.confirmed, null);
  });
});

describe('dedupeSignals', () => {
  it('collapses signals sharing a category and phrase, case-insensitively', () => {
    const out = dedupeSignals([
      { category: 'assertion-strip', phrase: 'Removed the assertion', source: 'review' },
      { category: 'assertion-strip', phrase: 'removed the assertion', source: 'issue-comment' },
      { category: 'no-op-fix', phrase: "doesn't actually fix", source: 'review' },
    ]);
    assert.equal(out.length, 2, 'the two assertion-strip phrasings collapse to one');
  });
});
