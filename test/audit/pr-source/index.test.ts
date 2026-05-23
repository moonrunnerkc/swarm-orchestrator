import { strict as assert } from 'assert';
import { detectAgent } from '../../../src/audit/pr-source';

describe('audit / pr-source / detectAgent', () => {
  it('identifies Devin from the bot author with high confidence', () => {
    const att = detectAgent({ authors: ['devin-ai-integration[bot]'] });
    assert.equal(att?.vendor, 'devin');
    assert.equal(att?.confidence, 'high');
    assert.equal(att?.source, 'bot-author');
  });

  it('identifies Claude Code from a "Generated with Claude Code" PR body', () => {
    const att = detectAgent({
      prBody: 'Generated with [Claude Code](https://claude.com/claude-code)',
    });
    assert.equal(att?.vendor, 'claude-code');
    assert.equal(att?.confidence, 'high');
    assert.equal(att?.source, 'pr-body-marker');
  });

  it('identifies Claude Code from a Co-Authored-By trailer in commit messages', () => {
    const att = detectAgent({
      commitMessages: ['fix: thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
    });
    assert.equal(att?.vendor, 'claude-code');
    assert.equal(att?.source, 'commit-marker');
  });

  it('extracts a version when a Claude model number is present', () => {
    const att = detectAgent({
      prBody: 'Generated with Claude Code (Opus 4.7)',
    });
    assert.equal(att?.vendor, 'claude-code');
    assert.equal(att?.version, '4.7');
  });

  it('falls back to medium confidence on branch-name pattern', () => {
    const att = detectAgent({ headRef: 'cursor/feature-add-foo' });
    assert.equal(att?.vendor, 'cursor');
    assert.equal(att?.confidence, 'medium');
    assert.equal(att?.source, 'branch-name');
  });

  it('returns undefined when no signal is present', () => {
    const att = detectAgent({
      prTitle: 'plain human PR',
      prBody: 'no markers here',
      headRef: 'main',
    });
    assert.equal(att, undefined);
  });
});
