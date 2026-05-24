// Anthropic Claude Code CLI profile + envelope parser + cost.
// Same-family control arm. AST obligations reuse Copilot's prompt + AST
// candidate runner; `property-must-hold` reuses Codex's prompt + shell
// candidate runner. The cross-adapter comparison is "same task,
// different model family".

import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
  PropertyMustHoldObligation,
} from '../../../contract/types';
import { checkPredicateBaseline } from '../../../verification/predicate-runner';
import type {
  AdapterProfile,
  CliFalsifierOptions,
  FalsifierStrategy,
  ParsedCandidate,
} from '../cli-falsifier';
import type { AdapterAuthMethod } from '../types';
import { checkAstBaseline, runAstCandidate, runShellCandidate } from '../candidate-runners';
import * as path from 'path';
import { buildCopilotPrompt, COPILOT_CANDIDATE_COUNT } from './copilot';
import { buildCodexPrompt, parseCodexCandidates } from './codex';
import { parseFencedCandidates } from '../fenced-json';

const COPILOT_PROMPTS = path.join(__dirname, 'copilot', 'prompts');
const CODEX_PROMPTS = path.join(__dirname, 'codex', 'prompts');

export const CLAUDE_CODE_CANDIDATE_COUNT = COPILOT_CANDIDATE_COUNT;
const DEFAULT_MAX_BUDGET_USD = 1.0;

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

type AstObligation = ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation;

/** Parse the Claude Code JSON envelope. Throws on any structural deviation. */
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
  const usage = (obj.usage ?? {}) as Record<string, unknown>;
  return {
    type: requireString(obj, 'type'),
    subtype: requireString(obj, 'subtype'),
    isError: obj.is_error === true,
    result: typeof obj.result === 'string' ? obj.result : '',
    totalCostUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0,
    inputTokens: numberOrZero(usage.input_tokens),
    outputTokens: numberOrZero(usage.output_tokens),
    cacheReadInputTokens: numberOrZero(usage.cache_read_input_tokens),
    cacheCreationInputTokens: numberOrZero(usage.cache_creation_input_tokens),
    stopReason: typeof obj.stop_reason === 'string' ? obj.stop_reason : null,
    numTurns: numberOrZero(obj.num_turns),
  };
}

/** Extract the fenced candidate document from the agent's reply and validate it. */
export function parseClaudeCodeCandidates(stdout: string): readonly ParsedCandidate[] {
  const envelope = readEnvelopeForCandidates(stdout);
  if (envelope.result.length === 0) {
    throw new Error(
      'Claude Code envelope had empty `result`. Cannot extract candidates from an empty reply.',
    );
  }
  // Reuses the "Copilot" label so the candidate-block error surface
  // matches what the AST strategy already exposes to operators.
  return parseFencedCandidates(envelope.result, {
    label: 'Copilot',
    requiredCount: CLAUDE_CODE_CANDIDATE_COUNT,
  });
}

function readEnvelopeForCandidates(stdout: string): ClaudeCodeEnvelope {
  const envelope = parseClaudeCodeEnvelope(stdout);
  if (envelope.isError) {
    throw new Error(
      `Claude Code envelope reported is_error=true (subtype=${envelope.subtype}); ` +
        `agent reply: ${envelope.result.slice(0, 240)}`,
    );
  }
  return envelope;
}

/** Infer the auth tier from the environment. */
export function detectClaudeCodeAuthMethod(env: NodeJS.ProcessEnv = process.env): AdapterAuthMethod {
  const k = env.ANTHROPIC_API_KEY;
  return typeof k === 'string' && k.length > 0 ? 'api' : 'chatgpt';
}

/** Project the envelope's `total_cost_usd` into the (billed, token-estimate, api-equivalent) triple. */
export function dollarsForEnvelopeByAuth(
  totalCostUsd: number,
  authMethod: AdapterAuthMethod,
): { dollarsBilled: number; dollarsTokenEstimate: number; dollarsApiEquivalent: number } {
  const tokenEstimate = round(totalCostUsd);
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
    dollarsApiEquivalent: tokenEstimate,
  };
}

const astStrategy: FalsifierStrategy<AstObligation> = {
  buildPrompt: buildCopilotPrompt,
  checkBaseline: checkAstBaseline,
  parseCandidates: parseClaudeCodeCandidates,
  runCandidate: (c, o, w) => runAstCandidate(c, o, w, 'Copilot'),
};

const propertyMustHoldStrategy: FalsifierStrategy<PropertyMustHoldObligation> = {
  buildPrompt: buildCodexPrompt,
  checkBaseline: (o, w) => {
    const b = checkPredicateBaseline(o.predicate, w);
    return {
      ok: b.ok,
      detail: b.ok
        ? ''
        : `predicate exited ${b.exitCode} against the unmodified workspace; ` +
          `obligation is pre-tainted. Snapshot a clean SHA or fix the predicate before retrying.`,
    };
  },
  parseCandidates: (stdout) => parseCodexCandidates(readEnvelopeForCandidates(stdout).result),
  runCandidate: (c, o, w) => runShellCandidate(c, o.predicate, w, 'Codex'),
};

export const claudeCodeProfile: AdapterProfile = {
  name: 'claude-code',
  errorLabel: 'claude',
  defaultBinary: 'claude',
  defaultModel: null,
  handles: ['import-graph-must-satisfy', 'function-must-have-signature', 'property-must-hold'],
  strategies: {
    'import-graph-must-satisfy': astStrategy as FalsifierStrategy,
    'function-must-have-signature': astStrategy as FalsifierStrategy,
    'property-must-hold': propertyMustHoldStrategy as FalsifierStrategy,
  },
  promptTemplatePath: {
    'import-graph-must-satisfy': path.join(COPILOT_PROMPTS, 'import-graph-must-satisfy.md'),
    'function-must-have-signature': path.join(COPILOT_PROMPTS, 'function-must-have-signature.md'),
    'property-must-hold': path.join(CODEX_PROMPTS, 'property-must-hold.md'),
  },
  promptDelivery: { kind: 'stdin' },
  maxOutputBytes: 4_000_000,
  notApplicableDetail:
    'claude-code only handles import-graph-must-satisfy, function-must-have-signature, and property-must-hold obligations',
  transientRetry: null,
  loggerScope: 'claude-code-falsifier',
  buildArgs: ({ model, workspaceRoot, options }) => buildClaudeCodeArgs(model, options, workspaceRoot),
  detectAuthMethod: () => detectClaudeCodeAuthMethod(),
  computeCost: ({ stdout, authMethod }) =>
    dollarsForEnvelopeByAuth(parseClaudeCodeEnvelope(stdout).totalCostUsd, authMethod),
  binaryMissingHint:
    'Install the claude-code CLI (npm i -g @anthropic-ai/claude-code) or set CliFalsifierOptions.binaryPath.',
};

function buildClaudeCodeArgs(
  model: string | null,
  options: CliFalsifierOptions,
  workspaceRoot: string,
): readonly string[] {
  const maxBudgetUsd = options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
  const args: string[] = [
    '-p',
    '--output-format',
    'json',
    '--max-budget-usd',
    String(maxBudgetUsd),
    '--add-dir',
    workspaceRoot,
    '--no-session-persistence',
    '--exclude-dynamic-system-prompt-sections',
  ];
  if (model !== null) args.push('--model', model);
  return args;
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

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
