import { strict as assert } from 'assert';
import {
  dollarsForUsage,
  dollarsForUsageByAuth,
  parseCodexUsage,
} from '../../../../src/falsification/adapters/profiles/codex';

describe('codex cost parsing and pricing', () => {
  describe('parseCodexUsage', () => {
    it('parses the human-readable form', () => {
      const usage = parseCodexUsage(
        'final answer here.\n\ntokens used: input=1234 output=456 total=1690\n',
        'o4-mini',
      );
      assert.ok(usage);
      assert.equal(usage!.inputTokens, 1234);
      assert.equal(usage!.outputTokens, 456);
      assert.equal(usage!.model, 'o4-mini');
    });

    it('parses an embedded JSON tokens object', () => {
      const usage = parseCodexUsage(
        '{"meta": {"tokens": {"input": 800, "output": 200}}}',
        'gpt-5-codex',
      );
      assert.ok(usage);
      assert.equal(usage!.inputTokens, 800);
      assert.equal(usage!.outputTokens, 200);
    });

    it('returns null when no usage is reported', () => {
      assert.equal(parseCodexUsage('just narration with no usage block', 'o4-mini'), null);
    });

    it('parses the codex 0.130.0 footer (single-total form, comma-separated)', () => {
      const usage = parseCodexUsage(
        'codex\nhello there\ntokens used\n1,545\n',
        'gpt-5.5',
      );
      assert.ok(usage);
      assert.equal(usage!.inputTokens, 0);
      assert.equal(usage!.outputTokens, 1545);
      assert.equal(usage!.model, 'gpt-5.5');
    });
  });

  describe('dollarsForUsage', () => {
    it('prices o4-mini at the documented rate', () => {
      const dollars = dollarsForUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'o4-mini' });
      // 1M input * 1.10 + 1M output * 4.40 = 5.50
      assert.equal(dollars, 5.5);
    });

    it('prices gpt-5-codex at the documented rate', () => {
      const dollars = dollarsForUsage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: 'gpt-5-codex',
      });
      // 1M input * 1.25 + 1M output * 10.00 = 11.25
      assert.equal(dollars, 11.25);
    });

    it('falls back to a conservative rate for unknown models', () => {
      const known = dollarsForUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'gpt-5-codex' });
      const unknown = dollarsForUsage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: 'a-future-model-not-in-the-table',
      });
      assert.equal(unknown, known);
    });

    it('returns 0 when no tokens are consumed', () => {
      assert.equal(
        dollarsForUsage({ inputTokens: 0, outputTokens: 0, model: 'o4-mini' }),
        0,
      );
    });
  });

  describe('dollarsForUsageByAuth (audit-and-corrections, 2026-05-09)', () => {
    // Codex is metered at API token rates regardless of auth tier:
    // dollarsApiEquivalent must equal dollarsTokenEstimate for every
    // outcome of dollarsForUsageByAuth. (Subscription auth zeroes
    // dollarsBilled; the API-equivalent column is unaffected.)
    it('reports dollarsApiEquivalent === dollarsTokenEstimate under chatgpt auth', () => {
      const usage = { inputTokens: 1000, outputTokens: 500, model: 'o4-mini' };
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForUsageByAuth(usage, 'chatgpt');
      assert.equal(dollarsBilled, 0);
      assert.ok(dollarsTokenEstimate > 0);
      assert.equal(dollarsApiEquivalent, dollarsTokenEstimate);
    });

    it('reports dollarsApiEquivalent === dollarsTokenEstimate === dollarsBilled under api auth', () => {
      const usage = { inputTokens: 1000, outputTokens: 500, model: 'gpt-5-codex' };
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForUsageByAuth(usage, 'api');
      assert.equal(dollarsBilled, dollarsTokenEstimate);
      assert.equal(dollarsApiEquivalent, dollarsTokenEstimate);
    });
  });
});
