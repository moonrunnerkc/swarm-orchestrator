import { strict as assert } from 'assert';
import {
  classifyArbiterAgreement,
  dedupeSignals,
} from '../../scripts/real-prs/mine-complaints';

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
