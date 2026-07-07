// Anthropic-backed LLM providers for the claim-differential proof: a Completer
// that writes the witness test and two independent WitnessArbiters that gate it.
// Kept out of claim-witness.ts so that module stays deterministic under test with
// injected stubs; only this file talks to a model.
//
// Temperature 0 and pinned model ids so a replayed measurement folds the exact
// call it was scored against. The arbiter gate wants two independent models; this
// environment has only Anthropic, so it uses two distinct Anthropic tiers, and the
// model ids ride into the record. A cross-vendor second family is a config swap.

import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from '../../logger';
import type { Completer, WitnessArbiter } from './claim-witness';

const log = getLogger('audit:execution-grounded:claim-llm');

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
    const response = await client.messages.create({
      model: witnessModel,
      max_tokens: 1500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: textOf(response.content), model: witnessModel };
  };

  const arbiter = (model: string): WitnessArbiter => async (prompt) => {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 128,
        temperature: 0,
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
