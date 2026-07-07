// Anthropic-backed LLM providers for the claim-differential proof: a Completer
// that writes the witness test and two independent WitnessArbiters that gate it.
// Kept out of claim-witness.ts so that module stays deterministic under test with
// injected stubs; only this file talks to a model.
//
// Pinned model ids so a replayed measurement folds the exact call it was scored
// against; temperature is omitted because the current witness model
// (claude-sonnet-5) rejects an explicit temperature with a 400 (the judge path
// does the same), so it takes the model default. That policy is recorded in every
// witness entry (samplingPolicy) rather than a temperature value, closing the Hunt
// 3 reproduce-section contradiction honestly. The arbiter gate wants two
// independent models; this environment has only Anthropic, so it uses two distinct
// Anthropic tiers, and the model ids ride into the record. A cross-vendor second
// family is a config swap.

import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from '../../logger';
import type { Completer, WitnessArbiter } from './claim-witness';

const log = getLogger('audit:execution-grounded:claim-llm');

/** The sampling policy recorded on every witness. claude-sonnet-5 rejects an
 *  explicit temperature (HTTP 400), so the witness is sampled at the model default
 *  with effort pinned low; this string documents that in the ledger. */
export const WITNESS_SAMPLING_POLICY =
  'temperature-unset (claude-sonnet-5 rejects explicit temperature); output_config.effort=low';

/** The structured-output contract for the witness: the model must return the test
 *  source in one string field, so reasoning cannot consume the whole budget and
 *  leave no test (the Hunt 3 witness-not-compiled defect). */
const WITNESS_OUTPUT_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  properties: {
    test_source: {
      type: 'string',
      description: 'The complete runnable test source code, and nothing else.',
    },
  },
  required: ['test_source'],
  additionalProperties: false,
};

/**
 * Pull the witness source out of a structured-output reply. The model returns a
 * JSON object `{ test_source }`; parse it and return that field. Falls back to the
 * raw text when the reply is not the expected JSON (an older model, a refusal),
 * because the compile-layer extractor also accepts bare source.
 *
 * @param raw the concatenated text content of the completion.
 * @returns the extracted test source, or the raw text on a parse miss.
 */
export function witnessSourceFromResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { test_source?: unknown };
    if (typeof parsed.test_source === 'string') return parsed.test_source;
  } catch {
    // Not the expected JSON; hand the raw text to the compile-layer extractor.
  }
  return raw;
}

/** Pinned defaults, overridable by env for a replayed or re-pinned run. */
export const DEFAULT_WITNESS_MODEL = process.env.SWARM_CLAIM_WITNESS_MODEL ?? 'claude-sonnet-5';
export const DEFAULT_ARBITER_A_MODEL = process.env.SWARM_CLAIM_ARBITER_A_MODEL ?? 'claude-sonnet-5';
export const DEFAULT_ARBITER_B_MODEL =
  process.env.SWARM_CLAIM_ARBITER_B_MODEL ?? 'claude-haiku-4-5-20251001';

export interface ClaimLlmOptions {
  /** Inject a pre-built client (test seam). */
  client?: Anthropic;
  apiKey?: string;
  witnessModel?: string;
  arbiterAModel?: string;
  arbiterBModel?: string;
}

export interface ClaimLlm {
  readonly complete: Completer;
  readonly arbiterA: WitnessArbiter;
  readonly arbiterB: WitnessArbiter;
}

const ARBITER_TOOL: Anthropic.Tool = {
  name: 'record_agreement',
  description: 'Record whether the test genuinely checks the claim. Call exactly once, emit no other text.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        enum: ['yes', 'no'],
        description: 'yes when the test fails without the claimed behaviour and passes with it; no otherwise',
      },
    },
    required: ['answer'],
  },
};

function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function toolAnswer(content: readonly Anthropic.ContentBlock[]): 'yes' | 'no' | null {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === ARBITER_TOOL.name) {
      const answer = (block.input as { answer?: unknown }).answer;
      if (answer === 'yes' || answer === 'no') return answer;
    }
  }
  return null;
}

/**
 * Build the Anthropic-backed witness Completer and two arbiter functions. The
 * arbiters fail closed: any non-`yes` (including a malformed reply) reads as no,
 * so a parse failure can never manufacture agreement.
 *
 * @param options client/key and optional model overrides.
 * @returns the completer and the two arbiters for runClaimDifferential.
 */
export function createClaimLlm(options: ClaimLlmOptions = {}): ClaimLlm {
  const client =
    options.client ?? new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const witnessModel = options.witnessModel ?? DEFAULT_WITNESS_MODEL;
  const arbiterAModel = options.arbiterAModel ?? DEFAULT_ARBITER_A_MODEL;
  const arbiterBModel = options.arbiterBModel ?? DEFAULT_ARBITER_B_MODEL;

  const complete: Completer = async (prompt) => {
    // The structured-output contract forces the reply into { test_source }, so the
    // model cannot spend the whole budget reasoning and emit no test; effort:low
    // keeps thinking short so the emission does not starve. max_tokens stays
    // generous so the JSON body is never truncated. The witness model rejects an
    // explicit temperature, so none is sent (recorded via samplingPolicy).
    const response = await client.messages.create({
      model: witnessModel,
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: WITNESS_OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    return {
      text: witnessSourceFromResponse(textOf(response.content)),
      model: witnessModel,
      samplingPolicy: WITNESS_SAMPLING_POLICY,
    };
  };

  const arbiter = (model: string): WitnessArbiter => async (prompt) => {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 128,
        tools: [ARBITER_TOOL],
        tool_choice: { type: 'tool', name: ARBITER_TOOL.name },
        messages: [{ role: 'user', content: prompt }],
      });
      return { yes: toolAnswer(response.content) === 'yes', model };
    } catch (err) {
      log.warn(`arbiter ${model} call failed, failing closed to no: ${String(err)}`);
      return { yes: false, model };
    }
  };

  return { complete, arbiterA: arbiter(arbiterAModel), arbiterB: arbiter(arbiterBModel) };
}
