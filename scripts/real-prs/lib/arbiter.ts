// The independent arbiter. A second LLM, deliberately a different model
// than the in-pipeline judge, reads a finding plus the diff slice it
// points at and classifies it (true-cheat / false-alarm / debatable /
// insufficient-context). The arbiter is independent second-pass signal,
// not ground truth; every consumer of its output labels it as
// arbiter-labeled.

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { SwarmError } from '../../../src/errors';
import { getLogger } from '../../../src/logger';
import type { ArbiterVerdict } from './types';
import type { CostLedger } from './cost';
import { repoRoot } from './paths';

const log = getLogger('real-prs:arbiter');

const VERDICTS: readonly ArbiterVerdict[] = [
  'true-cheat',
  'false-alarm',
  'debatable',
  'insufficient-context',
];

// Used only if the Anthropic models list cannot be reached. The factory
// prefers a model id discovered at runtime so this constant does not rot
// into the harness's behavior.
const FALLBACK_OPUS_MODEL = 'claude-opus-4-8';

export type ArbiterProvider = 'anthropic' | 'local' | 'ollama';

export interface ArbiterInput {
  prTitle: string;
  prBodyExcerpt: string;
  category: string;
  findingMessage: string;
  findingEvidence: string;
  findingRationale: string;
  diffSlice: string;
}

export interface ArbiterOutput {
  verdict: ArbiterVerdict;
  confidence: number;
  reasoning: string;
}

export interface Arbiter {
  readonly modelId: string;
  classify(input: ArbiterInput): Promise<ArbiterOutput>;
}

function loadPromptTemplate(version: string): string {
  // The prompt lives in the source tree (a .md asset, not compiled), so
  // resolve it from the repo root rather than the dist-relative path.
  const candidates = [
    path.join(repoRoot(), 'scripts', 'real-prs', 'arbiter-prompts', `${version}.md`),
    path.resolve(__dirname, '..', 'arbiter-prompts', `${version}.md`),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  throw new SwarmError(
    `arbiter prompt not found: ${candidates.join(' or ')}`,
    'REAL_PRS_NO_ARBITER_PROMPT',
    { remediation: `Add scripts/real-prs/arbiter-prompts/${version}.md.` },
  );
}

function fillPrompt(template: string, input: ArbiterInput): string {
  return template
    .replace('{{CATEGORY}}', input.category)
    .replace('{{PR_TITLE}}', input.prTitle || '(none)')
    .replace('{{PR_BODY}}', input.prBodyExcerpt || '(none)')
    .replace('{{FINDING_MESSAGE}}', input.findingMessage || '(none)')
    .replace('{{FINDING_EVIDENCE}}', input.findingEvidence || '(none)')
    .replace('{{FINDING_RATIONALE}}', input.findingRationale || '(none)')
    .replace('{{DIFF_SLICE}}', input.diffSlice || '(empty)');
}

function parseReply(raw: string): ArbiterOutput {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { verdict: 'insufficient-context', confidence: 0, reasoning: `unparseable: ${raw.slice(0, 300)}` };
  }
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      verdict?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    const verdict = VERDICTS.includes(obj.verdict as ArbiterVerdict)
      ? (obj.verdict as ArbiterVerdict)
      : 'insufficient-context';
    const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : 0;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
    return { verdict, confidence, reasoning };
  } catch (err) {
    return {
      verdict: 'insufficient-context',
      confidence: 0,
      reasoning: `parse error: ${(err as Error).message}; raw: ${raw.slice(0, 200)}`,
    };
  }
}

class AnthropicArbiter implements Arbiter {
  readonly modelId: string;
  private readonly client: Anthropic;
  private readonly template: string;
  private readonly ledger: CostLedger;

  constructor(modelId: string, template: string, ledger: CostLedger) {
    this.modelId = modelId;
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.template = template;
    this.ledger = ledger;
  }

  async classify(input: ArbiterInput): Promise<ArbiterOutput> {
    this.ledger.guardBeforeCall();
    const user = fillPrompt(this.template, input);
    // Newer Opus models reject an explicit temperature; omit it and take
    // the model default.
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 512,
      messages: [{ role: 'user', content: user }],
    });
    const usage = response.usage;
    this.ledger.record(this.modelId, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0);
    const raw = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return parseReply(raw);
  }
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

class LocalArbiter implements Arbiter {
  readonly modelId: string;
  private readonly baseUrl: string;
  private readonly template: string;
  private readonly ledger: CostLedger;

  constructor(modelId: string, baseUrl: string, template: string, ledger: CostLedger) {
    this.modelId = `local:${modelId}`;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.template = template;
    this.ledger = ledger;
  }

  async classify(input: ArbiterInput): Promise<ArbiterOutput> {
    this.ledger.guardBeforeCall();
    const user = fillPrompt(this.template, input);
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId.replace(/^local:/, ''),
        temperature: 0,
        max_tokens: 512,
        messages: [{ role: 'user', content: user }],
        // rapidmlx and similar local servers expose a thinking toggle; off
        // for a terse, parseable JSON reply.
        enable_thinking: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new SwarmError(
        `local arbiter request failed (${res.status}): ${body.slice(0, 200)}`,
        'REAL_PRS_LOCAL_ARBITER_FAILED',
        { remediation: 'Confirm the local OpenAI-compatible server is running at the base URL.' },
      );
    }
    const json = (await res.json()) as OpenAiChatResponse;
    this.ledger.record(this.modelId, 0, 0);
    const raw = json.choices?.[0]?.message?.content ?? '';
    return parseReply(raw.trim());
  }
}

export interface CreateArbiterOptions {
  provider: ArbiterProvider;
  ledger: CostLedger;
  promptVersion?: string;
  anthropicModel?: string;
  localBaseUrl?: string;
  localModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

/**
 * An arbiter backed by an Ollama model through the native /api/chat
 * endpoint with `format: json` and `think: false`. Ollama's /v1 OpenAI
 * shim returns empty content for several reasoning-capable models (the
 * answer lands in a separate reasoning field), so the native endpoint with
 * forced JSON is the reliable path. Free and local; records zero cost.
 */
class OllamaArbiter implements Arbiter {
  readonly modelId: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly template: string;
  private readonly ledger: CostLedger;

  constructor(model: string, baseUrl: string, template: string, ledger: CostLedger) {
    this.model = model;
    this.modelId = `ollama:${model}`;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.template = template;
    this.ledger = ledger;
  }

  async classify(input: ArbiterInput): Promise<ArbiterOutput> {
    this.ledger.guardBeforeCall();
    const user = fillPrompt(this.template, input);
    // node:http, not fetch: with stream:false Ollama sends headers only when
    // generation completes, and a long prompt on a partially-offloaded model
    // can exceed fetch's fixed 300s header timeout ("fetch failed" with no
    // useful cause). A request with an explicit generous timeout is the
    // reliable path for a local server.
    const body = await this.post(
      JSON.stringify({
        model: this.model,
        think: false,
        format: 'json',
        stream: false,
        options: { temperature: 0, num_predict: 512 },
        messages: [{ role: 'user', content: user }],
      }),
    );
    const json = JSON.parse(body) as OllamaChatResponse;
    this.ledger.record(this.modelId, 0, 0);
    return parseReply((json.message?.content ?? '').trim());
  }

  private post(payload: string, timeoutMs = 30 * 60 * 1000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        `${this.baseUrl}/api/chat`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 300) {
              reject(
                new SwarmError(
                  `ollama arbiter request failed (${res.statusCode}): ${text.slice(0, 200)}`,
                  'REAL_PRS_OLLAMA_ARBITER_FAILED',
                  { remediation: 'Confirm `ollama serve` is running and the model is pulled.' },
                ),
              );
            } else resolve(text);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`ollama request exceeded ${timeoutMs}ms`)));
      req.on('error', (err) =>
        reject(
          new SwarmError(`ollama arbiter request failed: ${err.message}`, 'REAL_PRS_OLLAMA_ARBITER_FAILED', {
            remediation: 'Confirm `ollama serve` is running and the model is pulled.',
            cause: err,
          }),
        ),
      );
      req.end(payload);
    });
  }
}

/** Resolve an Opus model id from the Anthropic models list at runtime so
 *  the harness tracks the current largest model rather than a pinned id.
 *  Falls back to a recent default if the list is unreachable. */
async function resolveOpusModel(explicit?: string): Promise<string> {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const list = await client.models.list({ limit: 50 });
    const opus = list.data.find((m) => m.id.toLowerCase().includes('opus'));
    if (opus !== undefined) return opus.id;
  } catch (err) {
    log.warn(`could not list Anthropic models, using fallback: ${(err as Error).message}`);
  }
  return FALLBACK_OPUS_MODEL;
}

export async function createArbiter(options: CreateArbiterOptions): Promise<Arbiter> {
  const version = options.promptVersion ?? process.env.ARBITER_PROMPT_VERSION ?? 'v1';
  const template = loadPromptTemplate(version);
  if (options.provider === 'local') {
    const baseUrl = options.localBaseUrl ?? 'http://localhost:8000';
    const model = options.localModel ?? process.env.RAPIDMLX_MODEL ?? 'local-model';
    return new LocalArbiter(model, baseUrl, template, options.ledger);
  }
  if (options.provider === 'ollama') {
    const baseUrl = options.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const model = options.ollamaModel ?? process.env.OLLAMA_ARBITER_MODEL ?? 'kimi-k2.6:cloud';
    return new OllamaArbiter(model, baseUrl, template, options.ledger);
  }
  if (process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY.length === 0) {
    throw new SwarmError('ANTHROPIC_API_KEY not set for the Anthropic arbiter', 'REAL_PRS_NO_ANTHROPIC_KEY', {
      remediation:
        'set ANTHROPIC_API_KEY in .env, or pass --arbiter-provider local to use a local server.',
    });
  }
  const modelId = await resolveOpusModel(options.anthropicModel);
  return new AnthropicArbiter(modelId, template, options.ledger);
}
