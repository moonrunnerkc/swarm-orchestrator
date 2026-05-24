import { strict as assert } from 'assert';
import {
  copilotApiEquivalentUsdPerPremiumRequest,
  copilotUsdPerPremiumRequest,
  dollarsForRequestsByAuth,
  parseCopilotPremiumRequests,
} from '../../../../src/falsification/adapters/profiles/copilot';

describe('copilot-cost', () => {
  describe('copilotUsdPerPremiumRequest', () => {
    it('returns the Pro+ default when the env override is unset', () => {
      const r = copilotUsdPerPremiumRequest({});
      assert.ok(Math.abs(r - 0.026) < 1e-9);
    });

    it('honours a positive numeric override', () => {
      const r = copilotUsdPerPremiumRequest({ COPILOT_USD_PER_PREMIUM_REQUEST: '0.05' });
      assert.ok(Math.abs(r - 0.05) < 1e-9);
    });

    it('falls back to the default when the override is malformed', () => {
      const r = copilotUsdPerPremiumRequest({ COPILOT_USD_PER_PREMIUM_REQUEST: 'banana' });
      assert.ok(Math.abs(r - 0.026) < 1e-9);
    });

    it('falls back to the default when the override is non-positive', () => {
      const r = copilotUsdPerPremiumRequest({ COPILOT_USD_PER_PREMIUM_REQUEST: '0' });
      assert.ok(Math.abs(r - 0.026) < 1e-9);
    });
  });

  describe('copilotApiEquivalentUsdPerPremiumRequest', () => {
    // Distinguishes the subscription-imputed per-request rate ($0.026 on
    // Pro+) from the API-equivalent rate (GPT-4-Turbo midpoint, $0.05).
    // The test pins both the default and the override path so a future
    // rate-card refresh has to update the constant *and* the test
    // intentionally.
    it('returns the GPT-4-Turbo-derived default when the env override is unset', () => {
      const r = copilotApiEquivalentUsdPerPremiumRequest({});
      assert.ok(Math.abs(r - 0.05) < 1e-9);
    });

    it('honours a positive numeric override', () => {
      const r = copilotApiEquivalentUsdPerPremiumRequest({
        COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV: '0.08',
      });
      assert.ok(Math.abs(r - 0.08) < 1e-9);
    });

    it('falls back to the default when the override is malformed', () => {
      const r = copilotApiEquivalentUsdPerPremiumRequest({
        COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV: 'banana',
      });
      assert.ok(Math.abs(r - 0.05) < 1e-9);
    });

    it('falls back to the default when the override is non-positive', () => {
      const r = copilotApiEquivalentUsdPerPremiumRequest({
        COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV: '0',
      });
      assert.ok(Math.abs(r - 0.05) < 1e-9);
    });
  });

  describe('dollarsForRequestsByAuth', () => {
    it('reports dollarsBilled=0 under chatgpt auth', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForRequestsByAuth(4, 'chatgpt', {});
      assert.equal(dollarsBilled, 0);
      assert.ok(dollarsTokenEstimate > 0);
    });

    it('reports dollarsBilled === dollarsTokenEstimate under api auth', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForRequestsByAuth(4, 'api', {});
      assert.equal(dollarsBilled, dollarsTokenEstimate);
    });

    it('treats unknown auth as billed (conservative — bills full estimate)', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForRequestsByAuth(4, 'unknown', {});
      assert.equal(dollarsBilled, dollarsTokenEstimate);
    });

    it('returns 0/0/0 for zero requests', () => {
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForRequestsByAuth(0, 'api', {});
      assert.equal(dollarsBilled, 0);
      assert.equal(dollarsTokenEstimate, 0);
      assert.equal(dollarsApiEquivalent, 0);
    });

    it('reports a non-zero dollarsApiEquivalent under chatgpt auth (Phase 3 shape)', () => {
      // 1 Premium request under Pro+ subscription:
      //   billed         = 0          (subscription)
      //   tokenEstimate  = $0.026     (subscription-imputed)
      //   apiEquivalent  = $0.05      (GPT-4-Turbo per-request)
      const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
        dollarsForRequestsByAuth(1, 'chatgpt', {});
      assert.equal(dollarsBilled, 0);
      assert.ok(Math.abs(dollarsTokenEstimate - 0.026) < 1e-9);
      assert.ok(Math.abs(dollarsApiEquivalent - 0.05) < 1e-9);
      // The two columns are intentionally distinct: subscription
      // pricing flatters tokenEstimate-basis comparisons.
      assert.notEqual(dollarsTokenEstimate, dollarsApiEquivalent);
    });

    it('honours both rate-card env overrides independently', () => {
      const env = {
        COPILOT_USD_PER_PREMIUM_REQUEST: '0.04',
        COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV: '0.10',
      };
      const { dollarsTokenEstimate, dollarsApiEquivalent } = dollarsForRequestsByAuth(
        3,
        'chatgpt',
        env,
      );
      assert.ok(Math.abs(dollarsTokenEstimate - 0.12) < 1e-9);
      assert.ok(Math.abs(dollarsApiEquivalent - 0.3) < 1e-9);
    });
  });

  describe('parseCopilotPremiumRequests', () => {
    it('parses the canonical "Requests N Premium (Ts)" line', () => {
      const stderr = [
        'Changes   +2 -0',
        'Requests  4 Premium (112s)',
        'Tokens    ↑ 1234',
      ].join('\n');
      assert.equal(parseCopilotPremiumRequests(stderr), 4);
    });

    it('returns null when the marker is absent', () => {
      assert.equal(parseCopilotPremiumRequests('no marker here'), null);
    });

    it('returns null on the empty string', () => {
      assert.equal(parseCopilotPremiumRequests(''), null);
    });

    it('parses zero as a valid count', () => {
      assert.equal(parseCopilotPremiumRequests('Requests 0 Premium (1s)'), 0);
    });
  });
});
