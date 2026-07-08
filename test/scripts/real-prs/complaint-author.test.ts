import { strict as assert } from 'node:assert';
import {
  isBotAuthor,
  isMaintainerComplaintEntry,
  type ConversationEntry,
} from '../../../scripts/real-prs/lib/github';

function entry(over: Partial<ConversationEntry> = {}): ConversationEntry {
  return { source: 'issue-comment', author: 'maintainer', body: 'no longer asserts', ...over };
}

describe('isBotAuthor', () => {
  it('flags the [bot] account suffix', () => {
    assert.equal(isBotAuthor('copilot-swe-agent[bot]'), true);
    assert.equal(isBotAuthor('renovate[bot]'), true);
  });

  it('flags named CI/dependency bots', () => {
    assert.equal(isBotAuthor('dependabot'), true);
    assert.equal(isBotAuthor('github-actions'), true);
  });

  it('flags the Copilot review surface, which authors as bare Copilot', () => {
    assert.equal(isBotAuthor('Copilot'), true);
    assert.equal(isBotAuthor('copilot-pull-request-reviewer[bot]'), true);
  });

  it('flags any account GitHub classifies as a Bot regardless of login', () => {
    assert.equal(isBotAuthor('some-service', 'Bot'), true);
  });

  it('does not flag a human whose name merely starts with copilot', () => {
    assert.equal(isBotAuthor('copilotfan'), false);
    assert.equal(isBotAuthor('alice', 'User'), false);
  });
});

describe('isMaintainerComplaintEntry', () => {
  it('excludes a self-comment by the PR author (case-insensitive)', () => {
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'jphein' }), 'jphein'), false);
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'JPHein' }), 'jphein'), false);
  });

  it('excludes a bot author', () => {
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'Copilot' }), 'someone'), false);
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'svc', authorType: 'Bot' }), 'someone'), false);
  });

  it('admits a human other than the PR author', () => {
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'polvalente' }), 'blasphemetheus'), true);
  });

  it('disables the self check when the PR author is unknown, but still drops bots', () => {
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'anyone' }), ''), true);
    assert.equal(isMaintainerComplaintEntry(entry({ author: 'Copilot' }), ''), false);
  });
});
