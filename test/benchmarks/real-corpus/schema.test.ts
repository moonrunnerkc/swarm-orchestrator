import { strict as assert } from 'assert';
import {
  buildPrEntryId,
  isUnlabeledPrEntry,
  validateUnlabeledPrEntry,
} from '../../../benchmarks/real-corpus/schema';

describe('PrCorpusEntry schema', () => {
  const validEntry = {
    id: 'claude-code-anthropics-claude-code-pr123',
    agent: {
      vendor: 'claude-code',
      confidence: 'high',
      source: 'body=claude-code-footer+branch=claude/',
    },
    pr: {
      number: 123,
      headSha: 'abc123',
      baseSha: 'def456',
      headRef: 'claude/fix-bug',
      title: 'Fix the bug',
      body: '🤖 Generated with [Claude Code]',
      author: 'someone',
      repository: 'anthropics/claude-code',
    },
    diffRef: {
      repository: 'anthropics/claude-code',
      headSha: 'abc123',
      baseSha: 'def456',
    },
    vendoredDiffPath: 'claude-code/claude-code-anthropics-claude-code-pr123.diff',
    vendoredAt: '2026-05-23T10:00:00.000Z',
    collectedAt: '2026-05-23T10:00:00.000Z',
  };

  it('accepts a well-formed entry', () => {
    assert.deepEqual(validateUnlabeledPrEntry(validEntry), []);
    assert.equal(isUnlabeledPrEntry(validEntry), true);
  });

  it('rejects when agent.confidence is not in the allowed set', () => {
    const bad = { ...validEntry, agent: { ...validEntry.agent, confidence: 'huge' } };
    const errors = validateUnlabeledPrEntry(bad);
    assert.ok(errors.some((e) => e.includes('agent.confidence')));
    assert.equal(isUnlabeledPrEntry(bad), false);
  });

  it('rejects when agent.vendor is empty', () => {
    const bad = { ...validEntry, agent: { ...validEntry.agent, vendor: '' } };
    assert.ok(validateUnlabeledPrEntry(bad).some((e) => e.includes('agent.vendor')));
  });

  it('accepts open-string vendor names not in any closed enum', () => {
    const novelVendor = {
      ...validEntry,
      agent: { ...validEntry.agent, vendor: 'novel-agent-2027' },
    };
    assert.deepEqual(validateUnlabeledPrEntry(novelVendor), []);
  });

  it('requires pr.number to be a positive integer', () => {
    const negative = { ...validEntry, pr: { ...validEntry.pr, number: -1 } };
    assert.ok(validateUnlabeledPrEntry(negative).some((e) => e.includes('pr.number')));
    const zero = { ...validEntry, pr: { ...validEntry.pr, number: 0 } };
    assert.ok(validateUnlabeledPrEntry(zero).some((e) => e.includes('pr.number')));
    const float = { ...validEntry, pr: { ...validEntry.pr, number: 1.5 } };
    assert.ok(validateUnlabeledPrEntry(float).some((e) => e.includes('pr.number')));
  });

  it('allows pr.body to be empty but not non-string', () => {
    const empty = { ...validEntry, pr: { ...validEntry.pr, body: '' } };
    assert.deepEqual(validateUnlabeledPrEntry(empty), []);
    const nullBody = { ...validEntry, pr: { ...validEntry.pr, body: null } };
    assert.ok(validateUnlabeledPrEntry(nullBody).some((e) => e.includes('pr.body')));
  });

  it('requires vendoredAt and collectedAt to be ISO timestamps', () => {
    const badTime = { ...validEntry, vendoredAt: 'yesterday' };
    assert.ok(validateUnlabeledPrEntry(badTime).some((e) => e.includes('vendoredAt')));
  });

  it('reports multiple errors at once instead of short-circuiting', () => {
    const errors = validateUnlabeledPrEntry({
      id: '',
      agent: { vendor: '', confidence: 'nope', source: '' },
      pr: { number: 0 },
      diffRef: {},
      vendoredDiffPath: '',
      vendoredAt: '',
      collectedAt: '',
    });
    assert.ok(errors.length >= 5);
  });

  describe('buildPrEntryId', () => {
    it('produces a stable kebab-shaped id from owner/repo and number', () => {
      assert.equal(
        buildPrEntryId('claude-code', 'anthropics/claude-code', 123),
        'claude-code-anthropics-claude-code-pr123',
      );
    });

    it('strips characters that would confuse a filesystem path', () => {
      assert.equal(
        buildPrEntryId('vendor', 'foo/bar baz!@#', 7),
        'vendor-foo-bar-baz-pr7',
      );
    });
  });
});
