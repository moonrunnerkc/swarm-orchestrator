/**
 * Token-to-dollar pricing for the Codex falsifier.
 *
 * Pricing is approximate and source-cited inline. The Phase 1 cost
 * instrumentation requirement is *real dollars per call*; the dispatcher
 * relies on this number to gate against the "single run exceeds 2x its
 * estimate" risk register entry. Refresh the rate table when OpenAI
 * publishes a price change.
 */

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
 * Extract token usage from Codex's stdout/stderr. Codex's `exec` mode
 * prints a tail of the form
 *   `tokens used: input=NNN output=NNN total=NNN`
 * (or, in newer builds, a structured JSON line with the same fields).
 * Either form is acceptable. Returns null if no usage is reported.
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
  return null;
}
