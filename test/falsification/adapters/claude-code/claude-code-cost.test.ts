import { strict as assert } from 'assert';
import {
  detectClaudeCodeAuthMethod,
  dollarsForEnvelopeByAuth,
} from '../../../../src/falsification/adapters/profiles/claude-code';

describe('claude-code-cost', () => {
  describe('detectClaudeCodeAuthMethod', () => {
    it('returns chatgpt when ANTHROPIC_API_KEY is unset', () => {
      assert.equal(detectClaudeCodeAuthMethod({}), 'chatgpt');
    });
    it('returns chatgpt when ANTHROPIC_API_KEY is empty', () => {
      assert.equal(detectClaudeCodeAuthMethod({ ANTHROPIC_API_KEY: '' }), 'chatgpt');
    });
    it('returns api when ANTHROPIC_API_KEY is set', () => {
      assert.equal(detectClaudeCodeAuthMethod({ ANTHROPIC_API_KEY: 'sk-x' }), 'api');
    });
  });

  describe('dollarsForEnvelopeByAuth', () => {
    it('reports dollarsBilled=0 under chatgpt auth', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForEnvelopeByAuth(0.42, 'chatgpt');
      assert.equal(dollarsBilled, 0);
      assert.ok(dollarsTokenEstimate > 0);
    });

    it('reports dollarsBilled === dollarsTokenEstimate under api auth', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForEnvelopeByAuth(0.42, 'api');
      assert.equal(dollarsBilled, dollarsTokenEstimate);
    });

    it('treats unknown as billed (conservative)', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForEnvelopeByAuth(0.42, 'unknown');
      assert.equal(dollarsBilled, dollarsTokenEstimate);
    });

    it('returns 0/0 when totalCostUsd is 0', () => {
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForEnvelopeByAuth(0, 'api');
      assert.equal(dollarsBilled, 0);
      assert.equal(dollarsTokenEstimate, 0);
      assert.equal(dollarsApiEquivalent, 0);
    });

    // Audit-and-corrections (2026-05-09): ClaudeCode CLI returns
    // total_cost_usd already at API rate-card value, so the
    // API-equivalent surface is identical to the token-estimate.
    it('reports dollarsApiEquivalent === dollarsTokenEstimate under chatgpt auth', () => {
      const { dollarsTokenEstimate, dollarsApiEquivalent } = dollarsForEnvelopeByAuth(
        0.42,
        'chatgpt',
      );
      assert.equal(dollarsApiEquivalent, dollarsTokenEstimate);
    });

    it('reports dollarsApiEquivalent === dollarsTokenEstimate === dollarsBilled under api auth', () => {
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForEnvelopeByAuth(0.42, 'api');
      assert.equal(dollarsApiEquivalent, dollarsTokenEstimate);
      assert.equal(dollarsApiEquivalent, dollarsBilled);
    });
  });
});
