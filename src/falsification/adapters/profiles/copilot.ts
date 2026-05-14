// GitHub Copilot CLI profile + parser + cost. Strategy: import-graph
// perturbation and function-signature drift. Prompt templates live in
// `prompts/*.md` next to this file and are eager-loaded at module
// init via __dirname-relative fs.readFileSync. The integration test
// relaxes the per-tool grant set to `--allow-all-tools`; production
// leaves the default `['view']` in place because the prompt forbids
// tool use.

import * as fs from 'fs';
import * as path from 'path';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../../contract/types';
import {
  substituteTemplate,
  type AdapterProfile,
  type CliFalsifierOptions,
  type FalsifierStrategy,
  type ParsedCandidate,
} from '../cli-falsifier';
import type { AdapterAuthMethod } from '../types';
import { checkAstBaseline, runAstCandidate } from '../candidate-runners';
import { parseFencedCandidates } from '../fenced-json';

export const COPILOT_CANDIDATE_COUNT = 3;
const DEFAULT_ALLOWED_TOOLS: readonly string[] = ['view'];
const PRO_PLUS_USD_PER_REQUEST = 0.026;
const API_EQUIV_USD_PER_REQUEST = 0.05;
const REQUEST_LINE_RE = /^\s*Requests\s+(\d+)\s+Premium\b/m;

const PROMPTS_DIR = path.join(__dirname, 'copilot', 'prompts');
const PATH_IMPORT_GRAPH = path.join(PROMPTS_DIR, 'import-graph-must-satisfy.md');
const PATH_SIGNATURE = path.join(PROMPTS_DIR, 'function-must-have-signature.md');
const PATH_NO_CYCLES = path.join(PROMPTS_DIR, 'no-cycles.md');
const PATH_NO_UPWARD = path.join(PROMPTS_DIR, 'no-upward-imports.md');
const TPL_IMPORT_GRAPH = fs.readFileSync(PATH_IMPORT_GRAPH, 'utf8');
const TPL_SIGNATURE = fs.readFileSync(PATH_SIGNATURE, 'utf8');
const TPL_NO_CYCLES = fs.readFileSync(PATH_NO_CYCLES, 'utf8');
const TPL_NO_UPWARD = fs.readFileSync(PATH_NO_UPWARD, 'utf8');

type AstObligation = ImportGraphMustSatisfyObligation | FunctionMustHaveSignatureObligation;

/** Parse Copilot's stdout into a candidate list. Throws on any deviation. */
export function parseCopilotCandidates(rawOutput: string): readonly ParsedCandidate[] {
  return parseFencedCandidates(rawOutput, { label: 'Copilot', requiredCount: COPILOT_CANDIDATE_COUNT });
}

/** Build the Copilot prompt for an AST-backed obligation. */
export function buildCopilotPrompt(obligation: AstObligation): string {
  if (obligation.type === 'import-graph-must-satisfy') {
    const constraintExplanation =
      obligation.constraint === 'no-cycles' ? TPL_NO_CYCLES : TPL_NO_UPWARD;
    return substituteTemplate(TPL_IMPORT_GRAPH, {
      constraint: obligation.constraint,
      scope: obligation.scope,
      candidateCount: String(COPILOT_CANDIDATE_COUNT),
      constraintExplanation,
    });
  }
  return substituteTemplate(TPL_SIGNATURE, {
    file: obligation.file,
    name: obligation.name,
    signature: obligation.signature,
    candidateCount: String(COPILOT_CANDIDATE_COUNT),
  });
}

/** Per-Premium-request USD rate (env-overridable). */
export function copilotUsdPerPremiumRequest(env: NodeJS.ProcessEnv = process.env): number {
  return readEnvUsdRate(env, 'COPILOT_USD_PER_PREMIUM_REQUEST', PRO_PLUS_USD_PER_REQUEST);
}

/** API-equivalent per-Premium-request rate (env-overridable). */
export function copilotApiEquivalentUsdPerPremiumRequest(env: NodeJS.ProcessEnv = process.env): number {
  return readEnvUsdRate(env, 'COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV', API_EQUIV_USD_PER_REQUEST);
}

/** Compute (billed, token-estimate, api-equivalent) for `premiumRequests`. */
export function dollarsForRequestsByAuth(
  premiumRequests: number,
  authMethod: AdapterAuthMethod,
  env: NodeJS.ProcessEnv = process.env,
): { dollarsBilled: number; dollarsTokenEstimate: number; dollarsApiEquivalent: number } {
  const tokenEstimate = round(premiumRequests * copilotUsdPerPremiumRequest(env));
  const apiEquivalent = round(premiumRequests * copilotApiEquivalentUsdPerPremiumRequest(env));
  return {
    dollarsBilled: authMethod === 'chatgpt' ? 0 : tokenEstimate,
    dollarsTokenEstimate: tokenEstimate,
    dollarsApiEquivalent: apiEquivalent,
  };
}

/** Extract Premium-request count from Copilot output; null when absent. */
export function parseCopilotPremiumRequests(rawOutput: string): number | null {
  if (rawOutput.length === 0) return null;
  const m = REQUEST_LINE_RE.exec(rawOutput);
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Auth-method probe. Copilot CLI is subscription-only today. */
export function detectCopilotAuthMethod(): AdapterAuthMethod {
  return 'chatgpt';
}

const astStrategy: FalsifierStrategy<AstObligation> = {
  buildPrompt: buildCopilotPrompt,
  checkBaseline: checkAstBaseline,
  parseCandidates: parseCopilotCandidates,
  runCandidate: (c, o, w) => runAstCandidate(c, o, w, 'Copilot'),
};

export const copilotProfile: AdapterProfile = {
  name: 'copilot',
  errorLabel: 'copilot',
  defaultBinary: 'copilot',
  defaultModel: null,
  handles: ['import-graph-must-satisfy', 'function-must-have-signature'],
  strategies: {
    'import-graph-must-satisfy': astStrategy as FalsifierStrategy,
    'function-must-have-signature': astStrategy as FalsifierStrategy,
  },
  promptTemplatePath: {
    'import-graph-must-satisfy': PATH_IMPORT_GRAPH,
    'function-must-have-signature': PATH_SIGNATURE,
  },
  promptDelivery: { kind: 'flag', flag: '-p' },
  maxOutputBytes: 1_000_000,
  notApplicableDetail:
    'copilot only handles import-graph-must-satisfy and function-must-have-signature obligations',
  transientRetry: { maxAttempts: 3 },
  loggerScope: 'copilot-falsifier',
  buildArgs: ({ options }) => buildCopilotArgs(options),
  detectAuthMethod: detectCopilotAuthMethod,
  computeCost: ({ stdout, stderr, authMethod, options }) => {
    const combined = `${stdout}\n${stderr}`;
    const parser = options.premiumRequestsOverride ?? parseCopilotPremiumRequests;
    const n = parser(combined);
    if (n === null) return { dollarsBilled: 0, dollarsTokenEstimate: 0, dollarsApiEquivalent: 0 };
    return dollarsForRequestsByAuth(n, authMethod);
  },
  binaryMissingHint:
    'Install the copilot CLI (npm i -g @github/copilot) or set CliFalsifierOptions.binaryPath.',
};

function buildCopilotArgs(options: CliFalsifierOptions): readonly string[] {
  const allowedTools = options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const args: string[] = ['--no-ask-user', '--no-color', '--output-format', 'text', '--allow-all-paths'];
  if (allowedTools === 'all') args.push('--allow-all-tools');
  else for (const tool of allowedTools) args.push('--allow-tool', tool);
  if (options.model !== undefined && options.model !== null) args.push('--model', options.model);
  return args;
}

function readEnvUsdRate(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
