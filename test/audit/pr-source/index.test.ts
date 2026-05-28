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

  it('extracts a version from a Co-Authored-By trailer carrying the model', () => {
    const att = detectAgent({
      commitMessages: ['fix: thing\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>'],
    });
    assert.equal(att?.vendor, 'claude-code');
    assert.equal(att?.version, '4.7');
  });

  it('does not invent a version from an unrelated mention of an Anthropic model', () => {
    // Branch-name attribution still fires (medium confidence), but the
    // body mentions "Sonnet 4.6" in unrelated context. Earlier the
    // extractor would happily report version=4.6; now it requires a
    // "Claude" mention within ~40 chars of the model name.
    const att = detectAgent({
      headRef: 'claude/feature-x',
      prBody: 'Refactor of pricing logic. We previously benchmarked against Sonnet 4.6 for context only.',
    });
    assert.equal(att?.vendor, 'claude-code');
    assert.equal(att?.confidence, 'medium');
    assert.equal(att?.version, undefined);
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
