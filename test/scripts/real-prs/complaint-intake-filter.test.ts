import { strict as assert } from 'node:assert';
import { isAiGeneratedReviewBody } from '../../../scripts/real-prs/lib/ai-review';
import { classifyComplaintIntake } from '../../../scripts/real-prs/mine-complaints';
import type { ConversationEntry } from '../../../scripts/real-prs/lib/github';

function entry(over: Partial<ConversationEntry> = {}): ConversationEntry {
  return { source: 'issue-comment', author: 'reviewer', body: '', ...over };
}

describe('isAiGeneratedReviewBody', () => {
  it('flags the on-behalf-of delegated review line (camel #24716 shape)', () => {
    assert.equal(
      isAiGeneratedReviewBody('Claude Code review on behalf of @gnodet\n\nLGTM, this is a no-op on Java 18+.'),
      true,
    );
  });

  it('flags a model-generated review table with its tool marker (fastjson2 #7675 shape)', () => {
    const body = [
      '<!-- qwen-review-suggestion-summary -->',
      '| File | Suggestion |',
      '|---|---|',
      '| Foo.java | this hides the error |',
      '',
      'qwen3.7-max via Qwen Code /review',
    ].join('\n');
    assert.equal(isAiGeneratedReviewBody(body), true);
  });

  it('flags the Claude Code attribution trailer', () => {
    assert.equal(isAiGeneratedReviewBody('Looks fine.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'), true);
  });

  it('does not flag a human complaint that merely mentions an AI tool', () => {
    assert.equal(
      isAiGeneratedReviewBody('This reads like Claude Code output and it swallows the error. Please fix properly.'),
      false,
    );
  });
});

describe('classifyComplaintIntake (standing filter at complaint intake)', () => {
  it('drops a thread whose only cheat-language is the PR author narrating their own iteration, as author-solo-flag', () => {
    const conversation = [
      entry({ author: 'agent-user', body: 'Updated: the new wording no longer asserts either, self-reviewed.' }),
      entry({ author: 'maintainer', body: 'Thanks, merging.' }),
    ];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'author-solo-flag');
    assert.ok(result.rawSignals.length > 0, 'raw hit is still counted');
    assert.equal(result.maintainerSignals.length, 0);
    assert.ok(result.authorSoloSignals.length > 0, 'the self-flag rides to the sidecar, not silence');
  });

  it('drops a thread whose only cheat-language comes from a bot-suffixed account', () => {
    const conversation = [
      entry({ author: 'copilot-pull-request-reviewer[bot]', authorType: 'Bot', body: 'Warning: this hides the error in the catch block.' }),
      entry({ author: 'maintainer', body: 'LGTM.' }),
    ];
    const result = classifyComplaintIntake(conversation, 'someone-else');
    assert.equal(result.drop, 'bot-or-ai-review-only');
    assert.equal(result.maintainerSignals.length, 0);
    assert.equal(result.authorSoloSignals.length, 0);
  });

  it('drops an AI-generated on-behalf-of review body posted under a human account', () => {
    const conversation = [
      entry({
        author: 'gnodet',
        source: 'review',
        body: 'Claude Code review on behalf of @gnodet\n\nNote that this is a no-op on Java 18 and later.',
      }),
    ];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'bot-or-ai-review-only');
  });

  it('drops a model-generated review table posted under a human account', () => {
    const conversation = [
      entry({
        author: 'wenshao',
        body: '<!-- qwen-review-suggestion-summary -->\n| Location | Issue |\n|---|---|\n| JSONReader.java | swallows the error |',
      }),
    ];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'bot-or-ai-review-only');
  });

  it('passes a genuine third-party maintainer complaint (control)', () => {
    const conversation = [
      entry({ author: 'agent-user', body: 'Fixed the failing test.' }),
      entry({
        author: 'project-maintainer',
        source: 'review-comment',
        body: "This doesn't actually fix the race, it just widens the timeout. Please revert.",
      }),
    ];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'none');
    assert.ok(result.maintainerSignals.length > 0, 'the maintainer complaint survives the filter');
  });

  it('still passes when the author also self-flags alongside a real maintainer complaint', () => {
    const conversation = [
      entry({ author: 'agent-user', body: 'I know this is a no-op for older runtimes.' }),
      entry({ author: 'project-maintainer', body: 'It swallows the error, that is not acceptable.' }),
    ];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'none');
  });

  it('classifies a thread with no cheat-language at all as no-signal', () => {
    const conversation = [entry({ author: 'maintainer', body: 'Nice work, thanks!' })];
    const result = classifyComplaintIntake(conversation, 'agent-user');
    assert.equal(result.drop, 'no-signal');
    assert.equal(result.rawSignals.length, 0);
  });
});
