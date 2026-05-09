/**
 * Cost computation for the Copilot falsifier.
 *
 * Copilot CLI bills per *Premium request* — visible on its stderr summary
 * line `Requests <N> Premium (<seconds>s)`. There is no per-token rate; a
 * single Premium request can cover a multi-tool-use turn. The Phase 3
 * cost-instrumentation requirement is *real dollars per call*; we map
 * Premium-request count to USD via the published per-plan rate.
 *
 * Copilot is subscription-only (no API-key billing tier for the CLI), so
 * `dollarsBilled` is 0 under any plan and `dollarsTokenEstimate` is the
 * conservative per-request cost. The Codex / Copilot dollar comparison in
 * Phase 3's analysis uses `dollarsTokenEstimate` (not `dollarsBilled`)
 * because both adapters report comparable token-estimate dollars even
 * though their billing surfaces differ.
 *
 * The default per-request rate corresponds to GitHub Copilot Pro+
 * ($39 / month / 1500 Premium requests ≈ $0.026 / request). Operators on
 * a different plan can override `COPILOT_USD_PER_PREMIUM_REQUEST` in the
 * environment; the Phase 3 protocol records whichever rate the run used.
 */

import type { AdapterAuthMethod } from '../types';

/**
 * USD per Premium request under GitHub Copilot Pro+. Derivation:
 *   $39 / 1500 = $0.026 per request.
 *
 * Refresh when GitHub publishes a price change. The fallback is
 * intentionally conservative — picking a higher number is fine for cost
 * tracking; under-estimating spend is the failure mode we avoid.
 */
const COPILOT_PRO_PLUS_USD_PER_REQUEST = 0.026;

/** Environment-variable name an operator can use to override the rate. */
const RATE_OVERRIDE_ENV = 'COPILOT_USD_PER_PREMIUM_REQUEST';

/**
 * Resolve the per-Premium-request USD rate. Reads the environment override
 * if present and parseable; otherwise returns the Pro+ default. Returns the
 * default rather than 0 on a malformed override so cost tracking does not
 * silently zero out.
 */
export function copilotUsdPerPremiumRequest(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RATE_OVERRIDE_ENV];
  if (raw === undefined || raw.trim() === '') return COPILOT_PRO_PLUS_USD_PER_REQUEST;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return COPILOT_PRO_PLUS_USD_PER_REQUEST;
  return parsed;
}

/**
 * Compute the (billed, token-estimate) pair for a Copilot call. Copilot is
 * subscription-only at the CLI surface, so `dollarsBilled` is 0 and the
 * per-call dollar value is exposed only as `dollarsTokenEstimate`. The
 * `authMethod` argument is accepted for parity with Codex's signature; it
 * is currently always `chatgpt` for Copilot but kept on the contract so a
 * future API-tier surface can flip to `api` without a schema change.
 */
export function dollarsForRequestsByAuth(
  premiumRequests: number,
  authMethod: AdapterAuthMethod,
  env: NodeJS.ProcessEnv = process.env,
): { dollarsBilled: number; dollarsTokenEstimate: number } {
  const tokenEstimate = roundCents(premiumRequests * copilotUsdPerPremiumRequest(env));
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
  };
}

function roundCents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Parse Copilot's premium-request count from its stderr/stdout summary
 * line. Format example: `Requests  4 Premium (112s)`. Returns null when no
 * marker is present, which is the common case under auth failure or when
 * Copilot exits before a request lands. Mirrors the production
 * `parseCopilotRequestCount` parser at `src/adapters/copilot-adapter.ts`
 * but lives here so the falsifier does not depend on the producer-side
 * adapter module.
 */
const COPILOT_REQUEST_LINE_RE = /^\s*Requests\s+(\d+)\s+Premium\b/m;

export function parseCopilotPremiumRequests(rawOutput: string): number | null {
  if (rawOutput.length === 0) return null;
  const m = COPILOT_REQUEST_LINE_RE.exec(rawOutput);
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Detect Copilot's auth method. Copilot CLI is subscription-only (no
 * API-key billing for the CLI itself), so the only currently meaningful
 * value is `chatgpt` — flat-rate. The function returns `chatgpt` when the
 * binary is present and authenticated, `unknown` otherwise.
 *
 * The cost layer treats `unknown` the same as `api` (conservative — bills
 * full per-request cost), so a misconfigured environment surfaces as
 * inflated `dollarsBilled` rather than silent under-reporting.
 */
export function detectCopilotAuthMethod(_binaryPath = 'copilot'): AdapterAuthMethod {
  // No probe call is performed: `copilot login status` does not print a
  // stable machine-readable auth-method line. Return `chatgpt` to reflect
  // the fact that Copilot CLI billing is subscription-only at the time
  // this adapter ships. If GitHub introduces a per-token billing tier the
  // probe can be added without changing the adapter contract.
  return 'chatgpt';
}
