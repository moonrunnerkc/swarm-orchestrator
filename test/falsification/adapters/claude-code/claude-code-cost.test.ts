import { strict as assert } from 'assert';
import {
  detectClaudeCodeAuthMethod,
  dollarsForEnvelopeByAuth,
} from '../../../../src/falsification/adapters/claude-code/claude-code-cost';

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
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForEnvelopeByAuth(0, 'api');
      assert.equal(dollarsBilled, 0);
      assert.equal(dollarsTokenEstimate, 0);
    });
  });
});
