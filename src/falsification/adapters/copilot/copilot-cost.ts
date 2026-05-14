// Copilot CLI bills per Premium request (stderr line
// `Requests <N> Premium (<s>s)`), not per token. dollarsBilled is 0
// under subscription auth; dollarsTokenEstimate carries the
// subscription-imputed per-call cost.

import type { AdapterAuthMethod } from '../types';

// $39 / 1500 ≈ $0.026 per request under Pro+. Refresh on price change;
// the fallback is conservative on purpose — under-estimating spend is
// the failure mode to avoid.
const COPILOT_PRO_PLUS_USD_PER_REQUEST = 0.026;

// API-equivalent rate (DECISIONS.md 2026-05-09):
//   3500 input × $10/1M + 500 output × $30/1M = $0.05
// Premium requests route to GPT-4-class models on Pro+. Single midpoint
// rather than per-call computation because Copilot CLI does not
// surface token counts.
const COPILOT_API_EQUIV_USD_PER_REQUEST = 0.05;

const RATE_OVERRIDE_ENV = 'COPILOT_USD_PER_PREMIUM_REQUEST';
const API_EQUIV_OVERRIDE_ENV = 'COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV';

// Returns the default rather than 0 on a malformed override so cost
// tracking does not silently zero out.
export function copilotUsdPerPremiumRequest(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RATE_OVERRIDE_ENV];
  if (raw === undefined || raw.trim() === '') return COPILOT_PRO_PLUS_USD_PER_REQUEST;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return COPILOT_PRO_PLUS_USD_PER_REQUEST;
  return parsed;
}

export function copilotApiEquivalentUsdPerPremiumRequest(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[API_EQUIV_OVERRIDE_ENV];
  if (raw === undefined || raw.trim() === '') return COPILOT_API_EQUIV_USD_PER_REQUEST;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return COPILOT_API_EQUIV_USD_PER_REQUEST;
  return parsed;
}

// `authMethod` is accepted for parity with Codex; currently always
// `chatgpt` for Copilot but kept on the contract so a future API-tier
// surface can flip to `api` without a schema change.
export function dollarsForRequestsByAuth(
  premiumRequests: number,
  authMethod: AdapterAuthMethod,
  env: NodeJS.ProcessEnv = process.env,
): {
  dollarsBilled: number;
  dollarsTokenEstimate: number;
  dollarsApiEquivalent: number;
} {
  const tokenEstimate = roundCents(premiumRequests * copilotUsdPerPremiumRequest(env));
  const apiEquivalent = roundCents(
    premiumRequests * copilotApiEquivalentUsdPerPremiumRequest(env),
  );
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
    dollarsApiEquivalent: apiEquivalent,
  };
}

function roundCents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Format example: `Requests  4 Premium (112s)`. Mirrors the producer-
// side `parseCopilotRequestCount` so the falsifier doesn't depend on
// src/adapters/copilot-adapter.ts.
const COPILOT_REQUEST_LINE_RE = /^\s*Requests\s+(\d+)\s+Premium\b/m;

export function parseCopilotPremiumRequests(rawOutput: string): number | null {
  if (rawOutput.length === 0) return null;
  const m = COPILOT_REQUEST_LINE_RE.exec(rawOutput);
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// `copilot login status` has no stable machine-readable auth-method
// line; return `chatgpt` because Copilot CLI billing is
// subscription-only at the time this adapter ships. The cost layer
// treats `unknown` as `api` so a misconfigured environment surfaces as
// inflated dollarsBilled rather than silent under-reporting.
export function detectCopilotAuthMethod(_binaryPath = 'copilot'): AdapterAuthMethod {
  return 'chatgpt';
}
