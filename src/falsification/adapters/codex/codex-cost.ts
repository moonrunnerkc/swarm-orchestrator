/**
 * Token-to-dollar pricing for the Codex falsifier.
 *
 * Pricing is approximate and source-cited inline. The Phase 1 cost
 * instrumentation requirement is *real dollars per call*; the dispatcher
 * relies on this number to gate against the "single run exceeds 2x its
 * estimate" risk register entry. Refresh the rate table when OpenAI
 * publishes a price change.
 */

import { spawnSync } from 'child_process';
import type { AdapterAuthMethod } from '../types';

export interface CodexUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}

interface ModelRate {
  /** USD per million input tokens. */
  readonly inputUsdPerMillion: number;
  /** USD per million output tokens. */
  readonly outputUsdPerMillion: number;
}

/**
 * Per-model pricing. Keys are the model identifiers Codex emits in its
 * own usage report. Numbers reflect OpenAI's published list pricing as of
 * 2025-Q4. Codex defaults to o4-mini at the time of writing.
 */
const RATES: Readonly<Record<string, ModelRate>> = {
  'o4-mini': { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  'o3-mini': { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  'gpt-5-codex': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10.0 },
  'gpt-4.1-mini': { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
};

/**
 * Conservative fallback when the model is not in the table. Picks the
 * highest of the table's output rates so we never under-report cost.
 * Reporting an over-estimate is preferable to silently zeroing out cost
 * tracking when a new model ships.
 */
const FALLBACK_RATE: ModelRate = { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10.0 };

/**
 * Compute USD spend for a single Codex call. Returns 0 only when both
 * token counts are 0; any positive token count produces a positive
 * dollar value (using the fallback rate if the model is unknown).
 */
export function dollarsForUsage(usage: CodexUsage): number {
  const rate = RATES[usage.model] ?? FALLBACK_RATE;
  const inputCost = (usage.inputTokens / 1_000_000) * rate.inputUsdPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * rate.outputUsdPerMillion;
  return roundCents(inputCost + outputCost);
}

function roundCents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Compute the (billed, token-estimate) pair for a usage record. Under
 * subscription-style auth (`chatgpt`) the operator pays a flat rate, so
 * `billed` is 0 even when the rate-card multiplied token total is
 * positive. Under per-token auth (`api`, or `unknown` as a conservative
 * fallback) the two values coincide.
 */
export function dollarsForUsageByAuth(
  usage: CodexUsage,
  authMethod: AdapterAuthMethod,
): {
  dollarsBilled: number;
  dollarsTokenEstimate: number;
  dollarsApiEquivalent: number;
} {
  const tokenEstimate = dollarsForUsage(usage);
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
    // Codex usage is metered at API token rates already, so the
    // API-equivalent surface is identical to the token-estimate.
    dollarsApiEquivalent: tokenEstimate,
  };
}

let cachedAuthMethod: AdapterAuthMethod | null = null;

/**
 * Probe the local codex CLI to determine which auth tier the next
 * `falsify()` call will run under. The codex CLI prints a single line
 * like `Logged in using ChatGPT` or `Logged in using API key` from
 * `codex login status`; older builds may print a JSON envelope. Cached
 * per process — auth state is not expected to change mid-run.
 *
 * Returns 'unknown' (and does not cache) when the binary is absent or
 * the output cannot be parsed; callers should treat 'unknown' the same
 * as 'api' for cost accounting (conservative — bills full token cost).
 */
export function detectCodexAuthMethod(binaryPath = 'codex'): AdapterAuthMethod {
  if (cachedAuthMethod !== null) return cachedAuthMethod;
  const result = spawnSync(binaryPath, ['login', 'status'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
  if (result.error !== undefined) return 'unknown';
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const detected = parseAuthMethod(combined);
  cachedAuthMethod = detected;
  return detected;
}

/** Reset the auth-method cache. Test-only; production code never calls this. */
export function _resetAuthMethodCacheForTests(): void {
  cachedAuthMethod = null;
}

function parseAuthMethod(output: string): AdapterAuthMethod {
  if (/logged in using chatgpt/i.test(output)) return 'chatgpt';
  if (/logged in using api(\s+key)?/i.test(output)) return 'api';
  if (/"auth_method"\s*:\s*"chatgpt"/i.test(output)) return 'chatgpt';
  if (/"auth_method"\s*:\s*"api(?:_key)?"/i.test(output)) return 'api';
  return 'unknown';
}

/**
 * Extract token usage from Codex's stdout/stderr. Three formats are
 * accepted, in priority order:
 *   1. Older `tokens used: input=NNN output=NNN` line.
 *   2. JSONL/JSON envelope `"tokens": { "input": N, "output": N }`.
 *   3. Codex 0.130.0 footer `tokens used\n<total>` (one count, comma-OK).
 *      The total is reported as a single number; we conservatively bucket
 *      it as `outputTokens` so the dollar estimate uses the higher-priced
 *      output rate. This is an upper-bound pricing approximation, not a
 *      ground-truth split.
 * Returns null if no usage is reported.
 */
export function parseCodexUsage(rawOutput: string, model: string): CodexUsage | null {
  const lineMatch = /tokens?\s*used\s*:\s*input\s*=\s*(\d+)\s+output\s*=\s*(\d+)/i.exec(rawOutput);
  if (lineMatch !== null) {
    const inputTokens = Number.parseInt(lineMatch[1] ?? '0', 10);
    const outputTokens = Number.parseInt(lineMatch[2] ?? '0', 10);
    if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens)) {
      return { inputTokens, outputTokens, model };
    }
  }
  const jsonMatch = /"tokens"\s*:\s*\{[^}]*"input"\s*:\s*(\d+)[^}]*"output"\s*:\s*(\d+)/.exec(
    rawOutput,
  );
  if (jsonMatch !== null) {
    const inputTokens = Number.parseInt(jsonMatch[1] ?? '0', 10);
    const outputTokens = Number.parseInt(jsonMatch[2] ?? '0', 10);
    if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens)) {
      return { inputTokens, outputTokens, model };
    }
  }
  const totalMatch = /tokens\s+used\s*\n\s*([\d,]+)/i.exec(rawOutput);
  if (totalMatch !== null) {
    const totalTokens = Number.parseInt((totalMatch[1] ?? '0').replace(/,/g, ''), 10);
    if (Number.isFinite(totalTokens) && totalTokens >= 0) {
      return { inputTokens: 0, outputTokens: totalTokens, model };
    }
  }
  return null;
}
