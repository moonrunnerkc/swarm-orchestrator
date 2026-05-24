import { strict as assert } from 'assert';
import {
  parsePrIntent,
  upgradeSeverity,
  type IntentSeverityPolicy,
  type Severity,
} from '../../../src/audit/cheat-detector/pr-intent';

describe('cheat-detector / pr-intent', () => {
  describe('parsePrIntent', () => {
    it('returns claimsFix:false when input is undefined', () => {
      assert.equal(parsePrIntent(undefined).claimsFix, false);
    });

    it('returns claimsFix:false on empty title and body', () => {
      const r = parsePrIntent({ title: '', body: '' });
      assert.equal(r.claimsFix, false);
      assert.equal(r.evidence, '');
    });

    // Vocabulary 1: GitHub close-keywords with issue refs.
    it('matches "fixes #123" in title', () => {
      const r = parsePrIntent({ title: 'fixes #123: payment bug', body: '' });
      assert.equal(r.claimsFix, true);
      assert.ok(/fixes #123/i.test(r.evidence));
    });

    it('matches "closes #42" in body', () => {
      const r = parsePrIntent({ title: 'wip', body: 'This patch closes #42 finally.' });
      assert.equal(r.claimsFix, true);
      assert.ok(/closes #42/i.test(r.evidence));
    });

    it('matches "resolves #1" and "resolved #1" variants', () => {
      assert.equal(parsePrIntent({ title: 'resolves #1', body: '' }).claimsFix, true);
      assert.equal(parsePrIntent({ title: 'resolved #1', body: '' }).claimsFix, true);
    });

    it('matches "patches #7" and "addresses #7" variants', () => {
      assert.equal(parsePrIntent({ title: 'patches #7', body: '' }).claimsFix, true);
      assert.equal(parsePrIntent({ title: 'addresses #7', body: '' }).claimsFix, true);
    });

    // Vocabulary 2: imperative-mood title prefix.
    it('matches "fix:" imperative title prefix', () => {
      const r = parsePrIntent({ title: 'fix: drop the racy mutex', body: '' });
      assert.equal(r.claimsFix, true);
      assert.ok(/fix\s*:/i.test(r.evidence));
    });

    it('matches "resolves:" imperative title prefix', () => {
      assert.equal(parsePrIntent({ title: 'resolves: stale cache', body: '' }).claimsFix, true);
    });

    it('matches "closed:" imperative title prefix', () => {
      assert.equal(parsePrIntent({ title: 'closed: race condition', body: '' }).claimsFix, true);
    });

    it('does NOT match "fixture:" or other unrelated prefixes', () => {
      assert.equal(parsePrIntent({ title: 'fixture: add edge cases', body: '' }).claimsFix, false);
      assert.equal(parsePrIntent({ title: 'feat: new feature', body: '' }).claimsFix, false);
      assert.equal(parsePrIntent({ title: 'docs: typo', body: '' }).claimsFix, false);
    });

    // Vocabulary 3: body-lead "This PR fixes/resolves/closes" sentence.
    it('matches "This PR fixes ..." in body lead', () => {
      const r = parsePrIntent({ title: 'wip', body: 'This PR fixes the timeout on chunked uploads.' });
      assert.equal(r.claimsFix, true);
      assert.ok(/this pr fix/i.test(r.evidence));
    });

    it('matches "This PR resolves" and "This PR closes"', () => {
      assert.equal(
        parsePrIntent({ title: 'wip', body: 'This PR resolves the auth regression.' }).claimsFix,
        true,
      );
      assert.equal(
        parsePrIntent({ title: 'wip', body: 'This PR closes the leaderboard bug.' }).claimsFix,
        true,
      );
    });

    it('does NOT match "This PR fixes" beyond first 500 chars of body', () => {
      const filler = 'lorem '.repeat(120); // ~720 chars
      const body = `${filler}This PR fixes the bug.`;
      assert.equal(parsePrIntent({ title: 'wip', body }).claimsFix, false);
    });

    it('returns trimmed, whitespace-collapsed evidence', () => {
      const r = parsePrIntent({ title: '   fixes \n  #99   ', body: '' });
      assert.equal(r.claimsFix, true);
      assert.ok(!/\n/.test(r.evidence));
      assert.ok(!/\s{2,}/.test(r.evidence));
    });
  });

  describe('upgradeSeverity', () => {
    const intentFix: ReturnType<typeof parsePrIntent> = { claimsFix: true, evidence: 'fix: x' };
    const intentNeutral: ReturnType<typeof parsePrIntent> = { claimsFix: false, evidence: '' };

    function check(
      from: Severity,
      policy: IntentSeverityPolicy,
      intent: ReturnType<typeof parsePrIntent>,
      expected: Severity,
    ): void {
      assert.equal(upgradeSeverity(from, intent, policy), expected);
    }

    it('strict policy: warn -> block when claimsFix', () => {
      check('warn', 'strict', intentFix, 'block');
    });
    it('strict policy: info -> warn when claimsFix', () => {
      check('info', 'strict', intentFix, 'warn');
    });
    it('strict policy: block stays block', () => {
      check('block', 'strict', intentFix, 'block');
    });
    it('lenient policy: warn -> block when claimsFix', () => {
      check('warn', 'lenient', intentFix, 'block');
    });
    it('lenient policy: info stays info when claimsFix', () => {
      check('info', 'lenient', intentFix, 'info');
    });
    it('off policy: no upgrades regardless of claimsFix', () => {
      check('warn', 'off', intentFix, 'warn');
      check('info', 'off', intentFix, 'info');
      check('block', 'off', intentFix, 'block');
    });
    it('neutral PR: no upgrades regardless of policy', () => {
      check('warn', 'strict', intentNeutral, 'warn');
      check('info', 'strict', intentNeutral, 'info');
      check('warn', 'lenient', intentNeutral, 'warn');
    });
  });
});
