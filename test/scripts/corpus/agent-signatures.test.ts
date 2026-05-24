import { strict as assert } from 'assert';
import {
  AGENT_PROFILES,
  attributeAgent,
  type PrSignalInput,
} from '../../../scripts/corpus/agent-signatures';

function baseInput(overrides: Partial<PrSignalInput> = {}): PrSignalInput {
  return {
    prTitle: '',
    prBody: '',
    headRef: 'main',
    authors: [],
    commitMessages: [],
    repository: 'someone/something',
    ...overrides,
  };
}

describe('agent-signatures two-signal attribution', () => {
  it('accepts Claude Code when body footer and claude/ branch both fire', () => {
    const verdict = attributeAgent(
      baseInput({
        prBody: 'Some text. 🤖 Generated with [Claude Code]\n\nMore text.',
        headRef: 'claude/fix-bug',
      }),
    );
    assert.equal(verdict.kind, 'accepted');
    if (verdict.kind !== 'accepted') return;
    assert.equal(verdict.vendor, 'claude-code');
    assert.equal(verdict.confidence, 'high');
    assert.ok(verdict.source.includes('+'));
  });

  it('falls back to unconfirmed on primary-only match', () => {
    const verdict = attributeAgent(
      baseInput({ prBody: '🤖 Generated with [Claude Code]' }),
    );
    assert.equal(verdict.kind, 'unconfirmed');
    if (verdict.kind !== 'unconfirmed') return;
    assert.equal(verdict.vendor, 'claude-code');
    assert.ok(verdict.primaryMatch !== undefined);
    assert.equal(verdict.secondaryMatch, undefined);
  });

  it('falls back to unconfirmed on secondary-only match', () => {
    const verdict = attributeAgent(baseInput({ headRef: 'claude/wip' }));
    assert.equal(verdict.kind, 'unconfirmed');
    if (verdict.kind !== 'unconfirmed') return;
    assert.equal(verdict.vendor, 'claude-code');
    assert.equal(verdict.primaryMatch, undefined);
    assert.ok(verdict.secondaryMatch !== undefined);
  });

  it('returns rejected when nothing fires', () => {
    const verdict = attributeAgent(baseInput({ prTitle: 'just a regular PR' }));
    assert.equal(verdict.kind, 'rejected');
  });

  it('attributes Devin by bot author plus session URL in body', () => {
    const verdict = attributeAgent(
      baseInput({
        authors: ['someone', 'devin-ai-integration[bot]'],
        prBody: 'See https://app.devin.ai/sessions/abc123 for the run',
      }),
    );
    assert.equal(verdict.kind, 'accepted');
    if (verdict.kind !== 'accepted') return;
    assert.equal(verdict.vendor, 'devin');
  });

  it('attributes Aider by commit prefix plus aider/ branch', () => {
    const verdict = attributeAgent(
      baseInput({
        commitMessages: ['aider: refactor module x to remove duplicated logic'],
        headRef: 'aider/refactor-x',
      }),
    );
    assert.equal(verdict.kind, 'accepted');
    if (verdict.kind !== 'accepted') return;
    assert.equal(verdict.vendor, 'aider');
  });

  it('attributes Aider on showcase repo even without branch prefix', () => {
    const verdict = attributeAgent(
      baseInput({
        commitMessages: ['aider: tidy up'],
        repository: 'paul-gauthier/aider',
      }),
    );
    assert.equal(verdict.kind, 'accepted');
    if (verdict.kind !== 'accepted') return;
    assert.equal(verdict.vendor, 'aider');
  });

  it('records source label as primary+secondary for accepted verdicts', () => {
    const verdict = attributeAgent(
      baseInput({
        prBody: '🤖 Generated with [Claude Code]',
        headRef: 'claude/x',
      }),
    );
    if (verdict.kind !== 'accepted') {
      assert.fail(`expected accepted, got ${verdict.kind}`);
      return;
    }
    assert.match(verdict.source, /\+/);
    assert.ok(verdict.source.split('+').length === 2);
  });

  it('every profile declares at least one primary and one secondary signal', () => {
    for (const profile of AGENT_PROFILES) {
      assert.ok(profile.primary.length >= 1, `${profile.vendor} has no primary signals`);
      assert.ok(profile.secondary.length >= 1, `${profile.vendor} has no secondary signals`);
    }
  });

  it('confidence labels match the plan tier table', () => {
    const byVendor = new Map(AGENT_PROFILES.map((p) => [p.vendor, p.confidence]));
    assert.equal(byVendor.get('claude-code'), 'high');
    assert.equal(byVendor.get('devin'), 'high');
    assert.equal(byVendor.get('copilot-workspace'), 'high');
    assert.equal(byVendor.get('openhands'), 'high');
    assert.equal(byVendor.get('aider'), 'high');
    assert.equal(byVendor.get('cursor'), 'medium');
    assert.equal(byVendor.get('codex-cli'), 'medium');
    assert.equal(byVendor.get('replit-agent'), 'low');
  });
});
