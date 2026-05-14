// Parameterized falsifier that drives the built-in CLI agents through
// one pipeline (build prompt → spawn → parse → apply → classify →
// cost). Per-CLI divergence (argument layout, prompt delivery, output
// framing, candidate verification, cost mapping) flows in via
// `AdapterProfile`.

import type { ObligationType } from '../../contract/types';
import { getLogger } from '../../logger';
import { invokeWithTransientRetry, isTransientApiError } from './transient-retry';
import { spawnCli, truncate } from './spawn-cli';
import type {
  AdapterAuthMethod,
  AdapterCostRecord,
  CounterExampleInput,
  FalsificationInput,
  FalsifierAdapter,
  FalsifyOutcome,
  NoFalsificationFoundResult,
} from './types';
import type {
  AdapterProfile,
  CliFalsifierOptions,
  CliInvocationRequest,
  CliInvocationResult,
} from './adapter-profile';

export type * from './adapter-profile';

const ZERO_COST = { dollarsBilled: 0, dollarsTokenEstimate: 0, dollarsApiEquivalent: 0 } as const;

/**
 * Substitute `${key}` placeholders in `template` with values from
 * `vars`. Used by profile modules to splice obligation-specific text
 * into prompt templates loaded from `.md` files at module init.
 */
export function substituteTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split('${' + k + '}').join(v);
  return out;
}

/**
 * Profile-driven falsifier. Each instance pairs an `AdapterProfile`
 * with per-instance overrides (binary, model, test seams).
 */
export class CliFalsifier implements FalsifierAdapter {
  readonly name: string;
  readonly handles: readonly ObligationType[];
  private readonly profile: AdapterProfile;
  private readonly options: CliFalsifierOptions;
  private readonly binaryPath: string;
  private readonly model: string | null;

  constructor(profile: AdapterProfile, options: CliFalsifierOptions = {}) {
    this.profile = profile;
    this.options = options;
    this.name = profile.name;
    this.handles = profile.handles;
    this.binaryPath = options.binaryPath ?? profile.defaultBinary;
    this.model = options.model === undefined ? profile.defaultModel : options.model;
  }

  /**
   * Run the underlying CLI once. CLI errors (missing binary, non-zero
   * exit, malformed output) surface as thrown `Error`s rather than
   * `no-falsification-found` so the dispatcher records them honestly.
   */
  async falsify(input: FalsificationInput): Promise<FalsifyOutcome> {
    const startedAt = Date.now();
    const strategy = this.profile.strategies[input.obligation.type];
    if (strategy === undefined) {
      return zeroCostOutcome(this.profile, input.obligation.type, startedAt, {
        reason: 'strategy-not-applicable',
        detail: this.profile.notApplicableDetail,
        authMethod: 'unknown',
      });
    }
    const authMethod = this.resolveAuthMethod();
    const baseline = strategy.checkBaseline(input.obligation, input.workspaceRoot);
    if (!baseline.ok) {
      return zeroCostOutcome(this.profile, input.obligation.type, startedAt, {
        reason: 'baseline-predicate-failed',
        detail: baseline.detail,
        authMethod,
      });
    }
    const sub = await this.runCli({
      binaryPath: this.binaryPath,
      args: this.profile.buildArgs({
        model: this.model,
        workspaceRoot: input.workspaceRoot,
        options: this.options,
      }),
      cwd: input.workspaceRoot,
      prompt: strategy.buildPrompt(input.obligation),
      timeoutMs: input.timeBudgetMs,
      env: process.env,
    });
    if (sub.exitCode !== 0) {
      throw new Error(
        `${this.profile.errorLabel} exec failed with exit code ${sub.exitCode}. ` +
          `stderr: ${truncate(sub.stderr, 1024)} — ` +
          `surface the failure rather than treating it as no-falsification-found.`,
        { cause: { exitCode: sub.exitCode, stderr: sub.stderr, stdout: sub.stdout } },
      );
    }
    const candidates = strategy.parseCandidates(sub.stdout);
    const confirmed: CounterExampleInput[] = [];
    let falsePositives = 0;
    for (const c of candidates) {
      const v = strategy.runCandidate(c, input.obligation, input.workspaceRoot);
      if (v.falsified && v.counterExample !== null) confirmed.push(v.counterExample);
      else falsePositives += 1;
    }
    const breakdown = this.profile.computeCost({
      stdout: sub.stdout,
      stderr: sub.stderr,
      authMethod,
      options: this.options,
      model: this.model,
    });
    const cost: AdapterCostRecord = {
      adapterName: this.profile.name,
      obligationType: input.obligation.type,
      wallClockMs: Date.now() - startedAt,
      dollarsSpent: breakdown.dollarsTokenEstimate,
      dollarsBilled: breakdown.dollarsBilled,
      dollarsTokenEstimate: breakdown.dollarsTokenEstimate,
      dollarsApiEquivalent: breakdown.dollarsApiEquivalent,
      authMethod,
      counterExamplesFound: confirmed.length,
      falsePositives,
    };
    if (confirmed.length === 0) {
      const result: NoFalsificationFoundResult = {
        kind: 'no-falsification-found',
        obligationType: input.obligation.type,
        reason: 'no-counter-example-discovered',
        attempts: candidates.length,
      };
      return { result, cost };
    }
    return {
      result: { kind: 'counter-example-input', obligationType: input.obligation.type, inputs: confirmed },
      cost,
    };
  }

  private resolveAuthMethod(): AdapterAuthMethod {
    if (this.options.authMethodOverride !== undefined) return this.options.authMethodOverride();
    return this.profile.detectAuthMethod({ env: process.env, binaryPath: this.binaryPath });
  }

  private async runCli(req: CliInvocationRequest): Promise<CliInvocationResult> {
    const invoke = (): Promise<CliInvocationResult> =>
      this.options.invocationOverride !== undefined
        ? this.options.invocationOverride(req)
        : spawnCli(req, this.profile);
    const policy = this.profile.transientRetry;
    if (policy === null) {
      const result = await invoke();
      if (this.options.onInvocation !== undefined) this.options.onInvocation(req, result);
      return result;
    }
    return invokeWithTransientRetry(invoke, {
      maxAttempts: policy.maxAttempts,
      onAttempt: (result, attempt) => {
        if (this.options.onInvocation !== undefined) this.options.onInvocation(req, result);
        if (attempt < policy.maxAttempts && isTransientApiError(result)) {
          getLogger(this.profile.loggerScope).warn(
            `${this.profile.name} transient API error on attempt ${attempt}/${policy.maxAttempts}; re-spawning`,
          );
        }
      },
    });
  }
}

function zeroCostOutcome(
  profile: AdapterProfile,
  obligationType: ObligationType,
  startedAt: number,
  s: {
    readonly reason: 'strategy-not-applicable' | 'baseline-predicate-failed';
    readonly detail: string;
    readonly authMethod: AdapterAuthMethod;
  },
): FalsifyOutcome {
  return {
    result: { kind: 'no-falsification-found', obligationType, reason: s.reason, attempts: 0, detail: s.detail },
    cost: {
      adapterName: profile.name,
      obligationType,
      wallClockMs: Date.now() - startedAt,
      dollarsSpent: 0,
      ...ZERO_COST,
      authMethod: s.authMethod,
      counterExamplesFound: 0,
      falsePositives: 0,
    },
  };
}
