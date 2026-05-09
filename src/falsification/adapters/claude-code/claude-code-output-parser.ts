/**
 * Parses Claude Code's `--output-format json` envelope and extracts the
 * fenced JSON candidate document from the agent's reply.
 *
 * Claude Code with `-p --output-format json` emits a single JSON
 * envelope on stdout shaped like:
 *
 *   {
 *     "type": "result",
 *     "subtype": "success" | "error_*",
 *     "is_error": boolean,
 *     "result": "<agent text reply>",
 *     "total_cost_usd": number,
 *     "modelUsage": { ... },
 *     ...
 *   }
 *
 * The candidate document lives inside `.result` as a fenced ```json```
 * block. We parse the envelope first, then re-use Copilot's
 * brace-balanced fenced extractor and validator on `.result` so the two
 * adapters share the same strict-JSON discipline.
 *
 * Strict by design — malformed output is a real error, not a
 * `no-falsification-found` outcome.
 */

import { parseCopilotCandidates } from '../copilot/copilot-output-parser';
import type { ParsedCandidate } from '../copilot/copilot-output-parser';

export type { ParsedCandidate } from '../copilot/copilot-output-parser';

export interface ClaudeCodeEnvelope {
  readonly type: string;
  readonly subtype: string;
  readonly isError: boolean;
  readonly result: string;
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly stopReason: string | null;
  readonly numTurns: number;
}

/**
 * Parse the Claude Code JSON envelope. Throws on any structural
 * deviation. The envelope shape is documented at
 * https://docs.anthropic.com/en/docs/claude-code/output-formats; we
 * read the fields that drive cost accounting and error reporting and
 * return them in a typed object.
 */
export function parseClaudeCodeEnvelope(stdout: string): ClaudeCodeEnvelope {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error('Claude Code emitted no stdout — investigate auth or binary state');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error(
      'Claude Code stdout did not parse as a single JSON envelope. With ' +
        '--output-format json the CLI should emit one JSON object; if it instead ' +
        'streamed multiple events, the harness must be re-checked. Inspect captured ' +
        'stdout to debug.',
      { cause },
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Claude Code envelope was not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const type = requireString(obj, 'type');
  const subtype = requireString(obj, 'subtype');
  const isError = obj.is_error === true;
  const result = typeof obj.result === 'string' ? obj.result : '';
  const totalCostUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0;
  const usage = (obj.usage ?? {}) as Record<string, unknown>;
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const cacheReadInputTokens = numberOrZero(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = numberOrZero(usage.cache_creation_input_tokens);
  const stopReason = typeof obj.stop_reason === 'string' ? obj.stop_reason : null;
  const numTurns = numberOrZero(obj.num_turns);

  return {
    type,
    subtype,
    isError,
    result,
    totalCostUsd,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    stopReason,
    numTurns,
  };
}

/**
 * Extract the fenced ```json``` candidate document from the agent's
 * `result` text and validate it via `parseCopilotCandidates` (same
 * brace-balanced scanner, same schema).
 *
 * Throws when the envelope reports `is_error`, when the agent text is
 * empty, when the fenced JSON is missing, or when the candidate count
 * does not match `CLAUDE_CODE_CANDIDATE_COUNT`.
 */
export function parseClaudeCodeCandidates(stdout: string): readonly ParsedCandidate[] {
  const envelope = parseClaudeCodeEnvelope(stdout);
  if (envelope.isError) {
    throw new Error(
      `Claude Code envelope reported is_error=true (subtype=${envelope.subtype}); ` +
        `agent reply: ${envelope.result.slice(0, 240)}`,
    );
  }
  if (envelope.result.length === 0) {
    throw new Error(
      'Claude Code envelope had empty `result`. Cannot extract candidates from an empty reply.',
    );
  }
  return parseCopilotCandidates(envelope.result);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Claude Code envelope missing string field "${key}"`);
  }
  return v;
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
