/**
 * Cost computation for the ClaudeCode falsifier.
 *
 * Claude Code with `--output-format json` returns a `total_cost_usd`
 * field per call. Under the operator's logged-in OAuth/Max session,
 * `total_cost_usd` is the rate-card-derived estimate (what the call
 * would cost at API rates); actual billing is flat-rate against the
 * subscription, so `dollarsBilled = 0`. Under explicit
 * `ANTHROPIC_API_KEY` auth (`--bare`), the operator pays per-token and
 * `dollarsBilled` equals `dollarsTokenEstimate`.
 *
 * The CLI does not expose a stable "auth mode" flag; we infer it from
 * the call's environment: `ANTHROPIC_API_KEY` set => `api`, otherwise
 * `chatgpt` (the conventional "subscription" tier label borrowed from
 * Codex's adapter for consistency).
 */

import type { AdapterAuthMethod } from '../types';

export function detectClaudeCodeAuthMethod(env: NodeJS.ProcessEnv = process.env): AdapterAuthMethod {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return 'api';
  }
  return 'chatgpt';
}

export function dollarsForEnvelopeByAuth(
  totalCostUsd: number,
  authMethod: AdapterAuthMethod,
): { dollarsBilled: number; dollarsTokenEstimate: number } {
  const tokenEstimate = roundCents(totalCostUsd);
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
  };
}

function roundCents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
