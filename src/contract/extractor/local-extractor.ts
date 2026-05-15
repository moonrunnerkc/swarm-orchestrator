import { type ObligationV1 } from '../types';
import { SUBMIT_CONTRACT_INPUT_SCHEMA, type ContractEnvelope } from './contract-schema';
import { sha256Hex, stripJsonFences, truncate } from './scan-pipeline';
import { type Extractor, type ExtractorInput, type ExtractorOutput } from './types';
import { type LocalBackend } from '../../inference/local/backend';
import { getLogger } from '../../logger';

const logger = getLogger('contract:local-extractor');

export interface LocalExtractorOptions {
  backend: LocalBackend;
  model: string;
  /**
   * Grammar mode: `auto` asks the backend what it supports and picks the
   * best (json-schema preferred). `none` skips grammar entirely; the
   * caller takes responsibility for parsing the model's text output.
   */
  grammar?: 'auto' | 'json-schema' | 'none';
  temperature?: number;
  seed?: number;
  maxTokens?: number;
}

/**
 * Extractor backed by a local inference endpoint. Issues a single chat
 * completion against the configured backend with a grammar-constrained
 * decoding request targeting the contract envelope schema; falls back to
 * soft-prompt parsing when the backend doesn't support json-schema
 * grammar (still strict — invalid JSON surfaces as an error).
 *
 * Determinism: every call passes `temperature: 0` and a configurable
 * seed, captured in the provenance via the prompt sha256. Same goal +
 * same workspace + same seed + same model + same backend produces an
 * identical contract hash.
 */
export class LocalExtractor implements Extractor {
  private readonly backend: LocalBackend;
  private readonly model: string;
  private readonly grammar: 'auto' | 'json-schema' | 'none';
  private readonly temperature: number;
  private readonly seed: number;
  private readonly maxTokens: number;

  constructor(options: LocalExtractorOptions) {
    this.backend = options.backend;
    this.model = options.model;
    this.grammar = options.grammar ?? 'auto';
    this.temperature = options.temperature ?? 0;
    this.seed = options.seed ?? 0;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const systemPrompt = LOCAL_SYSTEM_PROMPT;
    const userPrompt = buildUserPrompt(input);
    const promptSha = sha256Hex(`${systemPrompt}\n---\n${userPrompt}`);
    const useGrammar = this.shouldUseGrammar();

    const response = await this.backend.chat({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      seed: this.seed,
      ...(useGrammar
        ? { grammar: { kind: 'json-schema', schema: SUBMIT_CONTRACT_INPUT_SCHEMA } }
        : {}),
    });

    const envelope = parseEnvelopeOrThrow(response.text, this.backend.name, useGrammar);
    return {
      obligations: envelope.obligations,
      provenance: {
        name: 'local',
        model: this.model,
        temperature: this.temperature,
        promptSha256: promptSha,
      },
    };
  }

  private shouldUseGrammar(): boolean {
    if (this.grammar === 'none') return false;
    const supported = this.backend.supportsGrammar();
    if (supported.includes('json-schema')) return true;
    if (this.grammar === 'json-schema') {
      logger.warn(
        `local extractor requested json-schema grammar but backend "${this.backend.name}" ` +
          `advertises [${supported.join(', ')}]; falling back to soft-prompt parsing`,
      );
    }
    return false;
  }
}

function buildUserPrompt(input: ExtractorInput): string {
  return [
    `Goal:`,
    input.goal,
    '',
    `Repository context (JSON):`,
    JSON.stringify(input.repoContext, null, 2),
    '',
    `Respond with a JSON object matching the obligations envelope schema. ` +
      `Do not include any prose, markdown, or commentary — only the JSON.`,
  ].join('\n');
}

function parseEnvelopeOrThrow(
  text: string,
  backendName: string,
  grammarApplied: boolean,
): ContractEnvelope {
  const stripped = stripJsonFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `local extractor: ${backendName} returned text that is not valid JSON ` +
        `(grammar: ${grammarApplied ? 'json-schema' : 'soft-prompt'}). ` +
        `Head of response: ${truncate(stripped, 200)}. ` +
        `Underlying parse error: ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as ContractEnvelope).obligations)
  ) {
    throw new Error(
      `local extractor: ${backendName} returned JSON without an obligations array. ` +
        `Got: ${truncate(JSON.stringify(parsed), 200)}`,
    );
  }
  return {
    obligations: (parsed as { obligations: ObligationV1[] }).obligations,
  };
}

const LOCAL_SYSTEM_PROMPT = [
  'You compile natural-language software goals into machine-checkable contracts.',
  '',
  'Return a JSON object with shape { "obligations": [ ... ] }. Each obligation',
  'is one of the eight discriminated union members:',
  '',
  '  { "type": "file-must-exist", "path": "<repo-relative path>" }',
  '  { "type": "build-must-pass", "command": "<shell command>" }',
  '  { "type": "test-must-pass",  "command": "<shell command>" }',
  '  { "type": "function-must-have-signature", "file": "...", "name": "...", "signature": "..." }',
  '  { "type": "property-must-hold", "predicate": "...", "target": "..." }',
  '  { "type": "import-graph-must-satisfy", "constraint": "no-cycles" | "no-upward-imports", "scope": "..." }',
  '  { "type": "coverage-must-exceed", "scope": "...", "metric": "lines"|"statements"|"branches"|"functions", "threshold": <0..100> }',
  '  { "type": "performance-must-not-regress", "benchmark": "...", "baseline": "...", "threshold": <0..1> }',
  '',
  'Hard rules:',
  '- Output JSON only. No prose, no markdown, no fences.',
  '- The contract MUST contain at least one test-must-pass obligation.',
  '- Paths are repo-relative; never absolute.',
  '- Do not emit obligations the goal does not call for.',
  '- Do not include any field not listed for the obligation type.',
].join('\n');
