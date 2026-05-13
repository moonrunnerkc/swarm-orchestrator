import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { type ObligationV1 } from '../types';
import {
  SUBMIT_CONTRACT_INPUT_SCHEMA,
  SUBMIT_CONTRACT_TOOL_DESCRIPTION,
  SUBMIT_CONTRACT_TOOL_NAME,
} from './contract-schema';
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
 *
 * The extractor emits all eight v1 obligation types: the Phase 1 trio
 * (file-must-exist, build-must-pass, test-must-pass) and the Phase 7 set
 * (function-must-have-signature, property-must-hold,
 * import-graph-must-satisfy, coverage-must-exceed,
 * performance-must-not-regress). The system prompt teaches the model when
 * each type applies; the tool's input_schema enforces the shape per type.
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
      // Tolerate the intermittent shape where the model JSON-encodes the
      // array as a string in the tool input (the Anthropic API does not
      // guarantee structured arrays here, even with input_schema set; the
      // model occasionally double-encodes). Try one parse before failing.
      if (typeof blockInput.obligations === 'string') {
        try {
          const parsed = JSON.parse(blockInput.obligations);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Fall through to the structured error below.
        }
      }
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
  '  { "type": "function-must-have-signature",',
  '    "file": "<repo-relative path>", "name": "<function or method name>",',
  '    "signature": "(<params>): <return-type>" }',
  '  { "type": "property-must-hold",',
  '    "predicate": "<shell command, exit 0 ⇒ holds>",',
  '    "target": "<short human-readable label>" }',
  '  { "type": "import-graph-must-satisfy",',
  '    "constraint": "no-cycles" | "no-upward-imports",',
  '    "scope": "<repo-relative directory>" }',
  '  { "type": "coverage-must-exceed",',
  '    "scope": "<repo-relative path to coverage-summary.json>",',
  '    "metric": "lines" | "statements" | "branches" | "functions",',
  '    "threshold": <number 0..100> }',
  '  { "type": "performance-must-not-regress",',
  '    "benchmark": "<shell command whose stdout ends in a number>",',
  '    "baseline": "<repo-relative path to {\\"value\\": number} JSON>",',
  '    "threshold": <number 0..1, fractional regression cap> }',
  '',
  'Hard rules:',
  '- The contract MUST contain at least one test-must-pass obligation.',
  '- Emit build-must-pass ONLY when repoContext.buildCommand is non-null.',
  '  When buildCommand is null (typical for libraries published as source,',
  '  e.g. ESM packages with no build step), OMIT build-must-pass entirely.',
  '  Forcing a synthetic "npm run build" against a repo with no build script',
  '  generates a phantom obligation that can never satisfy.',
  '- Paths are repo-relative. Never absolute. Never start with "/" or a drive letter.',
  '- Commands are non-empty shell strings. Use the repository context\'s buildCommand',
  '  and testCommand verbatim when present; otherwise (for test only) pick a',
  '  reasonable default for the language ("npm test" for TypeScript/JavaScript;',
  '  "pytest" for Python).',
  '- Emit file-must-exist when the goal calls for a new file or module.',
  '  If the goal is purely behavioral (e.g. "fix the off-by-one bug"), file-must-exist',
  '  may be omitted.',
  '- Do not emit duplicate obligations (same path, or same command of the same type,',
  '  or same composite key for Phase 7 types).',
  '',
  'When to emit each Phase 7 type:',
  '- function-must-have-signature: the goal names a specific function/method and the',
  '  shape of its parameters or return type (e.g. "add a handler(req, res) function",',
  '  "the parser must expose parse(input: string): Result"). Pick the file the function',
  '  must live in. The signature must include the parameter list with parens; include',
  '  the return type when the goal mentions one.',
  '  Signature syntax MUST match the target file\'s language. When',
  '  repoContext.language is "javascript" OR the target file extension is one',
  '  of .js / .cjs / .mjs, use parameter names only with NO type annotations',
  '  and NO return type: e.g. "(req, res)". When repoContext.language is',
  '  "typescript" OR the target extension is .ts / .tsx, include parameter',
  '  types and a return type when the goal specifies them:',
  '  e.g. "(req: Request, res: Response): Promise<void>". Never emit',
  '  TypeScript syntax (": void", ": Promise<T>", typed parameters) on a',
  '  JavaScript file — the verifier accepts both but the guidance to the',
  '  patching personas is wrong for JS.',
  '- property-must-hold: the goal asserts a checkable property over the workspace that',
  '  is naturally expressed as a shell predicate (e.g. "no eval() in src/", "every',
  '  exported endpoint is documented", "no file exceeds 500 lines"). Use predicates',
  '  built from common tools: grep -r, ! grep, find ... -size, jq, etc. Exit 0 means',
  '  the property holds. Set target to a short human-readable label.',
  '  Predicates run under bash, but stay simple: prefer plain pipelines and',
  '  short-circuit `&&`/`||`. Avoid process substitution `<(...)`, `[[ ]]`,',
  '  multi-line scripts, and clever quoting — predicates that fail to parse',
  '  count as obligation failures.',
  '  CRITICAL: the predicate MUST exit non-zero against the unmodified',
  '  baseline workspace and exit zero ONLY after the goal\'s changes are',
  '  applied. A predicate that already holds on the baseline is a tautology',
  '  — it measures nothing — and the compiler will drop it. Examples of',
  '  bad predicates that pass on a baseline Express+Jest repo:',
  '    grep -q "401" tests/integration/  (every test file uses 401)',
  '    grep -q "me" src/  (the substring "me" matches "name", "schema", etc.)',
  '    grep -q "catchAsync" src/controllers/  (already present in baseline)',
  '  Examples of good predicates anchored to NEW code:',
  '    grep -q "router\\.get.*\\\'/me\\\'" src/routes/v1/user.route.js',
  '    grep -q "exports.getCurrentUser\\s*=" src/controllers/user.controller.js',
  '    grep -q "describe.*GET /v1/users/me" tests/integration/user.test.js',
  '  Use anchored patterns ("^", "\\b", or full-token grep) and predicates',
  '  that name structural tokens the new code WILL introduce, not English',
  '  words the baseline already contains.',
  '- import-graph-must-satisfy: the goal calls for a module-graph invariant. Use',
  '  "no-cycles" when the goal forbids circular imports anywhere under a directory;',
  '  use "no-upward-imports" when the goal forbids files reaching outside their own',
  '  subtree (e.g. "src/lib/ must not depend on anything above it"). Scope is the',
  '  directory to walk.',
  '- coverage-must-exceed: the goal sets a numeric coverage floor (e.g. "≥ 90% line',
  '  coverage", "branches above 75%"). Default scope to "coverage/coverage-summary.json"',
  '  unless the goal names another path. Pick the metric the goal mentions; default to',
  '  "lines" when the goal just says "coverage".',
  '- performance-must-not-regress: the goal expresses a regression budget against a',
  '  benchmark (e.g. "p95 latency must not regress more than 10%", "the bench script',
  '  must stay within 5% of the baseline"). benchmark is the shell command to run; its',
  '  stdout must end in a number. baseline is a JSON file shaped {"value": <number>}.',
  '  Threshold is a fraction in [0, 1] (0.10 = 10%).',
  '',
  'Do not invent obligation types beyond these eight. Do not emit Phase 7 obligations',
  'speculatively: only emit them when the goal explicitly calls for them. When in doubt,',
  'omit the optional obligation rather than fabricate one.',
  '',
  'Submit your contract by calling the submit_contract tool. Do not write prose.',
].join('\n');

const SUBMIT_CONTRACT_TOOL: Anthropic.Tool = {
  name: SUBMIT_CONTRACT_TOOL_NAME,
  description: SUBMIT_CONTRACT_TOOL_DESCRIPTION,
  input_schema: SUBMIT_CONTRACT_INPUT_SCHEMA,
};
