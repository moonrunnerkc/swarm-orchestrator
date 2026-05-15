// Profile type system for `CliFalsifier`. Lives apart so the class
// file stays close to its control flow and adapter authors can skim
// the contract surface in one focused place.

import type { ObligationType, ObligationV1 } from '../../contract/types';
import type { AdapterAuthMethod, CounterExampleInput } from './types';

export interface ParsedCandidate {
  readonly name: string;
  readonly rationale: string;
  readonly files: readonly ParsedCandidateFile[];
}
export interface ParsedCandidateFile {
  readonly relPath: string;
  readonly bytes: string;
}

export interface CliInvocationRequest {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}
export interface CliInvocationResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly wallClockMs: number;
}

// Each CLI's preferred prompt-delivery mode has its own correctness
// trap: copilot's `-p` must be last; codex takes a positional after
// `exec`; claude-code reads stdin so very long prompts don't bump
// ARG_MAX. The shape is pinned here so spawnCli enforces it once.
export type PromptDelivery =
  | { readonly kind: 'positional' }
  | { readonly kind: 'flag'; readonly flag: string }
  | { readonly kind: 'stdin' };

export interface FalsificationVerdict {
  readonly falsified: boolean;
  readonly counterExample: CounterExampleInput | null;
}

export interface FalsifierStrategy<T extends ObligationV1 = ObligationV1> {
  readonly buildPrompt: (obligation: T) => string;
  readonly checkBaseline: (
    obligation: T,
    workspaceRoot: string,
  ) => { readonly ok: boolean; readonly detail: string };
  readonly parseCandidates: (stdout: string) => readonly ParsedCandidate[];
  readonly runCandidate: (
    candidate: ParsedCandidate,
    obligation: T,
    workspaceRoot: string,
  ) => FalsificationVerdict;
}

export type StrategyMap = { readonly [K in ObligationType]?: FalsifierStrategy };

export interface CostBreakdown {
  readonly dollarsBilled: number;
  readonly dollarsTokenEstimate: number;
  readonly dollarsApiEquivalent: number;
}

export interface AdapterProfile {
  readonly name: string;
  // Short label woven into exec-error messages (typically the binary's basename).
  readonly errorLabel: string;
  readonly defaultBinary: string;
  readonly defaultModel: string | null;
  readonly handles: readonly ObligationType[];
  readonly strategies: StrategyMap;
  // Absolute paths to the .md prompt templates this profile serves,
  // keyed by obligation kind. The profile reads each file at
  // module-init and the strategy closures use the cached contents;
  // this field is the source of truth for what got loaded.
  readonly promptTemplatePath: { readonly [K in ObligationType]?: string };
  readonly promptDelivery: PromptDelivery;
  readonly maxOutputBytes: number;
  readonly notApplicableDetail: string;
  readonly transientRetry: { readonly maxAttempts: number } | null;
  readonly loggerScope: string;
  readonly buildArgs: (p: {
    readonly model: string | null;
    readonly workspaceRoot: string;
    readonly options: CliFalsifierOptions;
  }) => readonly string[];
  readonly detectAuthMethod: (p: { readonly env: NodeJS.ProcessEnv; readonly binaryPath: string }) => AdapterAuthMethod;
  readonly computeCost: (p: {
    readonly stdout: string;
    readonly stderr: string;
    readonly authMethod: AdapterAuthMethod;
    readonly options: CliFalsifierOptions;
    readonly model: string | null;
  }) => CostBreakdown;
  readonly binaryMissingHint: string;
}

export interface CliFalsifierOptions {
  readonly binaryPath?: string;
  readonly model?: string | null;
  readonly invocationOverride?: (req: CliInvocationRequest) => Promise<CliInvocationResult>;
  readonly onInvocation?: (req: CliInvocationRequest, res: CliInvocationResult) => void;
  readonly authMethodOverride?: () => AdapterAuthMethod;
  // Profile-specific extras — only honored by the matching profile.
  readonly allowedTools?: readonly string[] | 'all';
  readonly premiumRequestsOverride?: (output: string) => number | null;
  readonly maxBudgetUsd?: number;
}
