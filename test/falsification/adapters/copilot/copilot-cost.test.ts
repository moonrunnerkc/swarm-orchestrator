import { strict as assert } from 'assert';
import {
  copilotUsdPerPremiumRequest,
  dollarsForRequestsByAuth,
  parseCopilotPremiumRequests,
} from '../../../../src/falsification/adapters/copilot/copilot-cost';

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

    it('returns 0/0 for zero requests', () => {
      const { dollarsBilled, dollarsTokenEstimate } = dollarsForRequestsByAuth(0, 'api', {});
      assert.equal(dollarsBilled, 0);
      assert.equal(dollarsTokenEstimate, 0);
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
