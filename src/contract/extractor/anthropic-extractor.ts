import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { type ObligationV1 } from '../types';
import { type Extractor, type ExtractorInput, type ExtractorOutput } from './types';

/**
 * Default Sonnet-tier model used by Phase 1 per impl guide §4.
 *
 * Phase 1 picks `claude-sonnet-4-6`. Tier (Sonnet) is locked by spec; the
 * exact model id is configurable via constructor option in case operators
 * want to pin a specific snapshot.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

/** Default temperature: zero so contract identity is as stable as possible. */
export const DEFAULT_TEMPERATURE = 0;

/** Default max output tokens for the contract submission. */
export const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicExtractorOptions {
  /** API key. Falls back to env ANTHROPIC_API_KEY when unset. */
  apiKey?: string;
  /** Model id override. */
  model?: string;
  /** Sampling temperature override. */
  temperature?: number;
  /** Max output tokens. */
  maxTokens?: number;
  /** Inject a pre-built client (test seam). */
  client?: Anthropic;
}

/**
 * Production extractor: a single Anthropic Sonnet call that emits a list of
 * obligations via tool-use, per impl guide §4 ("a single LLM call (Sonnet
 * tier) to extract obligations").
 *
 * Tool-use is used instead of free-form JSON parsing so the API enforces the
 * shape; the validator then re-checks for the cross-cutting rules (no
 * duplicate paths/commands, ≥1 build, ≥1 test) the JSON schema cannot
 * express.
 *
 * The call is single-shot: no retries on validation failure here. Phase 1
 * surfaces invalid output as an error; the user retries by re-running
 * `swarm v8 compile`. (Repair-loop semantics are explicitly deleted in v8;
 * see overhaul guide §4.2.)
 */
export class AnthropicExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(options: AnthropicExtractorOptions = {}) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const systemPrompt = SYSTEM_PROMPT;
    const userPrompt = buildUserPrompt(input);
    const promptSha = sha256(`${systemPrompt}\n---\n${userPrompt}`);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      tools: [SUBMIT_CONTRACT_TOOL],
      tool_choice: { type: 'tool', name: SUBMIT_CONTRACT_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const obligations = extractToolUseObligations(message.content);
    return {
      obligations: obligations as ObligationV1[],
      provenance: {
        name: 'anthropic',
        model: this.model,
        temperature: this.temperature,
        promptSha256: promptSha,
      },
    };
  }
}

function buildUserPrompt(input: ExtractorInput): string {
  return [
    `Goal:`,
    input.goal,
    '',
    `Repository context (JSON):`,
    JSON.stringify(input.repoContext, null, 2),
  ].join('\n');
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function extractToolUseObligations(content: Anthropic.ContentBlock[]): unknown[] {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === SUBMIT_CONTRACT_TOOL.name) {
      const blockInput = block.input as { obligations?: unknown };
      if (Array.isArray(blockInput.obligations)) return blockInput.obligations;
      throw new Error(
        `Anthropic extractor tool_use payload missing "obligations" array; got: ${JSON.stringify(blockInput)}`,
      );
    }
  }
  throw new Error(
    'Anthropic extractor returned no tool_use block; the model may have refused. ' +
      'Refine the goal and retry, or check API access.',
  );
}

const SYSTEM_PROMPT = [
  'You compile natural-language software goals into machine-checkable contracts',
  'for the swarm-orchestrator v8 build pipeline.',
  '',
  'A contract is a list of obligations. Each obligation is exactly one of:',
  '',
  '  { "type": "file-must-exist", "path": "<repo-relative path>" }',
  '  { "type": "build-must-pass", "command": "<shell command>" }',
  '  { "type": "test-must-pass",  "command": "<shell command>" }',
  '',
  'Hard rules:',
  '- The contract MUST contain at least one build-must-pass and at least one',
  '  test-must-pass obligation.',
  '- Paths are repo-relative. Never absolute. Never start with "/" or a drive letter.',
  '- Commands are non-empty shell strings. Use the repository context\'s buildCommand',
  '  and testCommand verbatim when present; otherwise pick a reasonable default for',
  '  the language (e.g. "npm run build" / "npm test" for TypeScript/JavaScript;',
  '  "pytest" for Python).',
  '- Emit at least one file-must-exist when the goal calls for a new file or module.',
  '  If the goal is purely behavioral (e.g. "fix the off-by-one bug"), file-must-exist',
  '  may be omitted; build-must-pass and test-must-pass alone are valid.',
  '- Do not invent extra obligation types. The three above are the only types',
  '  Phase 1 understands.',
  '- Do not emit duplicate obligations (same path, or same command of the same type).',
  '',
  'Submit your contract by calling the submit_contract tool. Do not write prose.',
].join('\n');

const SUBMIT_CONTRACT_TOOL: Anthropic.Tool = {
  name: 'submit_contract',
  description: 'Submit the compiled list of contract obligations for the user goal.',
  input_schema: {
    type: 'object',
    required: ['obligations'],
    properties: {
      obligations: {
        type: 'array',
        minItems: 1,
        items: {
          oneOf: [
            {
              type: 'object',
              required: ['type', 'path'],
              additionalProperties: false,
              properties: {
                type: { const: 'file-must-exist' },
                path: { type: 'string', minLength: 1 },
              },
            },
            {
              type: 'object',
              required: ['type', 'command'],
              additionalProperties: false,
              properties: {
                type: { const: 'build-must-pass' },
                command: { type: 'string', minLength: 1 },
              },
            },
            {
              type: 'object',
              required: ['type', 'command'],
              additionalProperties: false,
              properties: {
                type: { const: 'test-must-pass' },
                command: { type: 'string', minLength: 1 },
              },
            },
          ],
        },
      },
    },
  },
};
