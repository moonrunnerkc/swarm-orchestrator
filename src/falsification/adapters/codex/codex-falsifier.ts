/**
 * `CodexFalsifier` — Phase 1 falsifier adapter.
 *
 * Spawns the real `codex` binary in `workspace-write` sandbox mode with
 * approval policy `never`. One strategy: adversarial test input
 * generation against `property-must-hold` obligations. The adapter:
 *   1. builds the Codex prompt for the obligation,
 *   2. spawns Codex as a subprocess with the safe sandbox flags,
 *   3. parses the JSON candidate document Codex returns,
 *   4. applies and re-runs each candidate locally,
 *   5. classifies confirmed counter-examples vs. false positives,
 *   6. returns a typed `FalsifyOutcome` and a populated cost record.
 *
 * Sequential dispatch only. No scheduling, no bandit. Errors from the
 * underlying CLI (binary missing, auth failure, parse failure) are
 * thrown — the dispatcher surfaces them; collapsing them to
 * `no-falsification-found` would hide real regressions per
 * `docs/adapter-integration.md`.
 */

import { spawn } from 'child_process';
import type { ObligationType, PropertyMustHoldObligation } from '../../../contract/types';
import type {
  AdapterCostRecord,
  CounterExampleInput,
  FalsificationInput,
  FalsifierAdapter,
  FalsifyOutcome,
} from '../types';
import { noFalsification } from '../no-falsification';
import { buildCodexPrompt } from './codex-prompt';
import { parseCodexCandidates } from './codex-output-parser';
import { runCandidateAgainstPredicate, checkPredicateBaseline } from './predicate-runner';
import { dollarsForUsageByAuth, detectCodexAuthMethod, parseCodexUsage } from './codex-cost';

/**
 * Sentinel value meaning "do not pass `--model` to codex; let the user's
 * `~/.codex/config.toml` (or the binary's own default) pick the model".
 * Hard-coding a model previously broke ChatGPT-auth setups where the
 * pinned model (e.g. o4-mini) is not available to the account.
 */
const MODEL_FROM_CODEX_CONFIG = null;

/** Ceiling on captured stdout/stderr size. Truncated past this. */
const MAX_OUTPUT_BYTES = 1_000_000;

/** Options accepted by the Codex falsifier. Test seams only — production
 *  code uses defaults. */
export interface CodexFalsifierOptions {
  /** Path to the codex binary. Defaults to `codex` on PATH. */
  readonly binaryPath?: string;
  /** Model override; falls back to `DEFAULT_MODEL`. */
  readonly model?: string;
  /**
   * Test seam: replace the subprocess invocation with a synchronous
   * function that produces the same `CodexInvocationResult`. Production
   * code does not pass this — the adapter must run the real CLI to
   * satisfy Phase 1's "no mocks of the CLI" rule.
   */
  readonly invocationOverride?: (request: CodexInvocationRequest) => Promise<CodexInvocationResult>;
  /**
   * Observability hook fired after every real (or overridden) subprocess
   * invocation completes, with the raw `CodexInvocationResult`. Side-effect
   * only — the adapter still consumes the same result it returned. The
   * Phase 1 dev-gate runner uses this to capture raw stdout/stderr per
   * obligation without modifying subprocess behaviour. Not a mock seam.
   */
  readonly onInvocation?: (request: CodexInvocationRequest, result: CodexInvocationResult) => void;
  /**
   * Test seam: override the auth-method detector. Production code reads
   * `codex login status`; tests can pass a constant function to avoid
   * spawning the real binary.
   */
  readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';
}

export interface CodexInvocationRequest {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}

export interface CodexInvocationResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly wallClockMs: number;
}

/** Public Codex falsifier adapter. */
export class CodexFalsifier implements FalsifierAdapter {
  readonly name = 'codex';
  readonly handles: readonly ObligationType[] = ['property-must-hold'];
  private readonly binaryPath: string;
  private readonly model: string | null;
  private readonly invocationOverride?: (req: CodexInvocationRequest) => Promise<CodexInvocationResult>;
  private readonly onInvocation?: (req: CodexInvocationRequest, res: CodexInvocationResult) => void;
  private readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';

  constructor(options: CodexFalsifierOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'codex';
    this.model = options.model === undefined ? MODEL_FROM_CODEX_CONFIG : options.model;
    if (options.invocationOverride !== undefined) {
      this.invocationOverride = options.invocationOverride;
    }
    if (options.onInvocation !== undefined) {
      this.onInvocation = options.onInvocation;
    }
    if (options.authMethodOverride !== undefined) {
      this.authMethodOverride = options.authMethodOverride;
    }
  }

  async falsify(input: FalsificationInput): Promise<FalsifyOutcome> {
    const startedAt = Date.now();
    if (input.obligation.type !== 'property-must-hold') {
      return notApplicableOutcome(this.name, input.obligation.type, startedAt);
    }
    const obligation = input.obligation as PropertyMustHoldObligation;
    const authMethod =
      this.authMethodOverride !== undefined
        ? this.authMethodOverride()
        : detectCodexAuthMethod(this.binaryPath);

    // Baseline check: a property-must-hold obligation must pass against
    // the clean workspace. If it already fails, every codex candidate
    // trivially "falsifies" and the spend is wasted. Skip codex entirely
    // and return a structured outcome.
    const baseline = checkPredicateBaseline(obligation.predicate, input.workspaceRoot);
    if (!baseline.ok) {
      const wallClockMs = Date.now() - startedAt;
      return {
        result: {
          kind: 'no-falsification-found',
          obligationType: obligation.type,
          reason: 'baseline-predicate-failed',
          attempts: 0,
          detail:
            `predicate exited ${baseline.exitCode} against the unmodified workspace; ` +
            `obligation is pre-tainted. Snapshot a clean SHA or fix the predicate before retrying.`,
        },
        cost: {
          adapterName: this.name,
          obligationType: obligation.type,
          wallClockMs,
          dollarsSpent: 0,
          dollarsBilled: 0,
          dollarsTokenEstimate: 0,
          dollarsApiEquivalent: 0,
          authMethod,
          counterExamplesFound: 0,
          falsePositives: 0,
        },
      };
    }

    const prompt = buildCodexPrompt(obligation);
    const args = buildCodexArgs(this.model);
    const modelForCost = this.model;
    const invocation: CodexInvocationRequest = {
      binaryPath: this.binaryPath,
      args,
      cwd: input.workspaceRoot,
      prompt,
      timeoutMs: input.timeBudgetMs,
      env: process.env,
    };
    const subprocess = await this.runCodex(invocation);
    if (subprocess.exitCode !== 0) {
      throw new Error(
        `codex exec failed with exit code ${subprocess.exitCode}. ` +
          `stderr: ${truncate(subprocess.stderr, 1024)} — ` +
          `surface the failure rather than treating it as no-falsification-found.`,
        {
          cause: {
            exitCode: subprocess.exitCode,
            stderr: subprocess.stderr,
            stdout: subprocess.stdout,
          },
        },
      );
    }
    const candidates = parseCodexCandidates(subprocess.stdout);
    const confirmed: CounterExampleInput[] = [];
    let falsePositives = 0;
    for (const candidate of candidates) {
      const result = runCandidateAgainstPredicate(
        candidate,
        obligation.predicate,
        input.workspaceRoot,
      );
      if (result.falsified && result.counterExample !== null) {
        confirmed.push(result.counterExample);
      } else {
        falsePositives += 1;
      }
    }
    const wallClockMs = Date.now() - startedAt;
    // Prefer the model name codex reports in its own banner over our
    // configured default; under ChatGPT auth the runtime model can differ
    // from any value we pre-configured.
    const observedModel = extractModelFromBanner(`${subprocess.stdout}\n${subprocess.stderr}`);
    const modelForUsage = observedModel ?? modelForCost ?? 'unknown';
    const usage = parseCodexUsage(`${subprocess.stdout}\n${subprocess.stderr}`, modelForUsage);
    const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
      usage === null
        ? { dollarsBilled: 0, dollarsTokenEstimate: 0, dollarsApiEquivalent: 0 }
        : dollarsForUsageByAuth(usage, authMethod);
    const cost: AdapterCostRecord = {
      adapterName: this.name,
      obligationType: obligation.type,
      wallClockMs,
      dollarsSpent: dollarsTokenEstimate,
      dollarsBilled,
      dollarsTokenEstimate,
      dollarsApiEquivalent,
      authMethod,
      counterExamplesFound: confirmed.length,
      falsePositives,
    };
    if (confirmed.length === 0) {
      return {
        result: noFalsification(obligation.type, candidates.length, 'no-counter-example-discovered'),
        cost,
      };
    }
    return {
      result: {
        kind: 'counter-example-input',
        obligationType: obligation.type,
        inputs: confirmed,
      },
      cost,
    };
  }

  private async runCodex(req: CodexInvocationRequest): Promise<CodexInvocationResult> {
    const result =
      this.invocationOverride !== undefined ? await this.invocationOverride(req) : await spawnCodex(req);
    if (this.onInvocation !== undefined) {
      this.onInvocation(req, result);
    }
    return result;
  }
}

function buildCodexArgs(model: string | null): readonly string[] {
  // Argument order matches codex CLI 0.130.0's grammar: `--ask-for-approval`
  // and `--sandbox` are root-level flags and must precede the `exec`
  // subcommand. `--skip-git-repo-check` is an exec-level flag. `--model`
  // is omitted when null so codex falls back to the user's
  // `~/.codex/config.toml` default — necessary because ChatGPT-auth
  // accounts cannot use API-only models like `o4-mini`.
  const args: string[] = [
    '--ask-for-approval',
    'never',
    '--sandbox',
    'workspace-write',
    'exec',
    '--skip-git-repo-check',
  ];
  if (model !== null) {
    args.push('--model', model);
  }
  return args;
}

/**
 * Pull the actual model name out of codex's invocation banner. The
 * banner format under codex 0.130.0 is a `model: <name>` line in the
 * stderr preamble. Returns null if no banner line is present.
 */
function extractModelFromBanner(output: string): string | null {
  const match = /(^|\n)\s*model:\s*(\S+)/.exec(output);
  return match !== null ? match[2] ?? null : null;
}


function notApplicableOutcome(
  adapterName: string,
  obligationType: ObligationType,
  startedAt: number,
): FalsifyOutcome {
  return {
    result: {
      kind: 'no-falsification-found',
      obligationType,
      reason: 'strategy-not-applicable',
      attempts: 0,
      detail: `${adapterName} only handles property-must-hold obligations`,
    },
    cost: {
      adapterName,
      obligationType,
      wallClockMs: Date.now() - startedAt,
      dollarsSpent: 0,
      dollarsBilled: 0,
      dollarsTokenEstimate: 0,
      dollarsApiEquivalent: 0,
      authMethod: 'unknown',
      counterExamplesFound: 0,
      falsePositives: 0,
    },
  };
}

function spawnCodex(req: CodexInvocationRequest): Promise<CodexInvocationResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(req.binaryPath, [...req.args, req.prompt], {
      cwd: req.cwd,
      env: req.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, req.timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdout += chunk;
        stdoutBytes += chunk.length;
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderr += chunk;
        stderrBytes += chunk.length;
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `failed to spawn codex binary "${req.binaryPath}": ${err.message}. ` +
            `Install the codex CLI or set CodexFalsifierOptions.binaryPath.`,
          { cause: err },
        ),
      );
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `codex exec exceeded the ${req.timeoutMs}ms time budget; the call was killed. ` +
              `Increase FalsificationInput.timeBudgetMs if the obligation legitimately needs more time.`,
          ),
        );
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        wallClockMs: Date.now() - startedAt,
      });
    });
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}
