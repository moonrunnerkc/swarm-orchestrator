/**
 * `ClaudeCodeFalsifier` — Phase 4 falsifier adapter.
 *
 * Wraps the `claude` binary (`@anthropic-ai/claude-code`). Same family
 * as the v8 producer (Anthropic Claude); built deliberately as the
 * control arm for Phase 4's cross-family-diversity question. If
 * ClaudeCode finds nothing Codex+Copilot already found, that confirms
 * cross-family diversity is doing the work; if it finds plenty, the
 * diversity story is weaker than the architecture assumes.
 *
 * Strategy: same import-graph + function-signature perturbation
 * strategy as Copilot, applied to the same two obligation types. The
 * prompt body is shared with Copilot via `claude-code-prompt.ts` so
 * both adapters describe the task identically; the candidate runner
 * is shared with Copilot so verification is identical. The only
 * adapter-specific pieces are subprocess invocation, JSON-envelope
 * parsing, and cost mapping.
 *
 * Sandbox posture: spawn `claude -p ... --output-format json
 * --add-dir <workspace>` against the isolated workspace. No
 * `--dangerously-skip-permissions`, no `--allow-dangerously-skip-permissions`.
 * The model is instructed in the prompt not to write or run shells —
 * only to emit a fenced ```json``` block describing candidates. The
 * orchestrator (not the model) applies and rolls back each candidate.
 */

import { spawn } from 'child_process';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
  ObligationType,
} from '../../../contract/types';
import type {
  AdapterCostRecord,
  CounterExampleInput,
  FalsificationInput,
  FalsifierAdapter,
  FalsifyOutcome,
  NoFalsificationFoundResult,
} from '../types';
import { buildClaudeCodePrompt } from './claude-code-prompt';
import { parseClaudeCodeCandidates } from './claude-code-output-parser';
import {
  runCandidateAgainstObligation,
  checkObligationBaseline,
} from './predicate-runner';
import { detectClaudeCodeAuthMethod, dollarsForEnvelopeByAuth } from './claude-code-cost';
import { parseClaudeCodeEnvelope } from './claude-code-output-parser';

const MAX_OUTPUT_BYTES = 4_000_000;

export interface ClaudeCodeFalsifierOptions {
  readonly binaryPath?: string;
  readonly model?: string | null;
  /**
   * Per-call dollar budget passed via `--max-budget-usd`. Default 1.00.
   * Mirrors the Phase 4 protocol's per-obligation cap of $1.00.
   */
  readonly maxBudgetUsd?: number;
  readonly invocationOverride?: (
    request: ClaudeCodeInvocationRequest,
  ) => Promise<ClaudeCodeInvocationResult>;
  readonly onInvocation?: (
    request: ClaudeCodeInvocationRequest,
    result: ClaudeCodeInvocationResult,
  ) => void;
  readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';
}

export interface ClaudeCodeInvocationRequest {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}

export interface ClaudeCodeInvocationResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly wallClockMs: number;
}

type SupportedObligation =
  | ImportGraphMustSatisfyObligation
  | FunctionMustHaveSignatureObligation;

const DEFAULT_MAX_BUDGET_USD = 1.0;

export class ClaudeCodeFalsifier implements FalsifierAdapter {
  readonly name = 'claude-code';
  readonly handles: readonly ObligationType[] = [
    'import-graph-must-satisfy',
    'function-must-have-signature',
  ];
  private readonly binaryPath: string;
  private readonly model: string | null;
  private readonly maxBudgetUsd: number;
  private readonly invocationOverride?: (
    req: ClaudeCodeInvocationRequest,
  ) => Promise<ClaudeCodeInvocationResult>;
  private readonly onInvocation?: (
    req: ClaudeCodeInvocationRequest,
    res: ClaudeCodeInvocationResult,
  ) => void;
  private readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';

  constructor(options: ClaudeCodeFalsifierOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'claude';
    this.model = options.model === undefined ? null : options.model;
    this.maxBudgetUsd = options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
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
    if (
      input.obligation.type !== 'import-graph-must-satisfy' &&
      input.obligation.type !== 'function-must-have-signature'
    ) {
      return notApplicableOutcome(this.name, input.obligation.type, startedAt);
    }
    const obligation = input.obligation as SupportedObligation;
    const authMethod =
      this.authMethodOverride !== undefined
        ? this.authMethodOverride()
        : detectClaudeCodeAuthMethod();

    const baseline = checkObligationBaseline(obligation, input.workspaceRoot);
    if (!baseline.ok) {
      const wallClockMs = Date.now() - startedAt;
      return {
        result: {
          kind: 'no-falsification-found',
          obligationType: obligation.type,
          reason: 'baseline-predicate-failed',
          attempts: 0,
          detail:
            `obligation already unsatisfied against the unmodified workspace: ${baseline.detail}; ` +
            `obligation is pre-tainted. Snapshot a clean fixture or fix the obligation before retrying.`,
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

    const prompt = buildClaudeCodePrompt(obligation);
    const args = buildClaudeCodeArgs(this.model, this.maxBudgetUsd, input.workspaceRoot);
    const invocation: ClaudeCodeInvocationRequest = {
      binaryPath: this.binaryPath,
      args,
      cwd: input.workspaceRoot,
      prompt,
      timeoutMs: input.timeBudgetMs,
      env: process.env,
    };
    const subprocess = await this.runClaudeCode(invocation);
    if (subprocess.exitCode !== 0) {
      throw new Error(
        `claude exec failed with exit code ${subprocess.exitCode}. ` +
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
    // Parse envelope first to capture cost even when candidate parsing
    // throws downstream; the throw still surfaces, but cost is recorded
    // on the way out for the caller via the next phase of work. (Today
    // the throw bubbles past, so cost would not reach the cost record;
    // that is acceptable because a parse failure is a real bug and the
    // operator will inspect the captured stdout / stderr files.)
    const envelope = parseClaudeCodeEnvelope(subprocess.stdout);
    const candidates = parseClaudeCodeCandidates(subprocess.stdout);
    const confirmed: CounterExampleInput[] = [];
    let falsePositives = 0;
    for (const candidate of candidates) {
      const result = runCandidateAgainstObligation(candidate, obligation, input.workspaceRoot);
      if (result.falsified && result.counterExample !== null) {
        confirmed.push(result.counterExample);
      } else {
        falsePositives += 1;
      }
    }
    const wallClockMs = Date.now() - startedAt;
    const { dollarsBilled, dollarsTokenEstimate, dollarsApiEquivalent } =
      dollarsForEnvelopeByAuth(envelope.totalCostUsd, authMethod);
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
        result: noFalsification(
          obligation.type,
          candidates.length,
          'no-counter-example-discovered',
        ),
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

  private async runClaudeCode(
    req: ClaudeCodeInvocationRequest,
  ): Promise<ClaudeCodeInvocationResult> {
    const result =
      this.invocationOverride !== undefined
        ? await this.invocationOverride(req)
        : await spawnClaudeCode(req);
    if (this.onInvocation !== undefined) {
      this.onInvocation(req, result);
    }
    return result;
  }
}

function buildClaudeCodeArgs(
  model: string | null,
  maxBudgetUsd: number,
  workspaceRoot: string,
): readonly string[] {
  // Argument shape per `claude --help` (CLI 2.1.138):
  //   -p / --print                       non-interactive mode
  //   --output-format json               single JSON envelope on stdout
  //   --max-budget-usd <amount>          per-call $ cap
  //   --add-dir <path>                   grant tool access to the workspace dir
  //   --no-session-persistence           do not persist this session to disk
  //   --exclude-dynamic-system-prompt-sections
  //                                      strip per-machine context for stable
  //                                      caching across runs
  //   --model <name>                     model override (optional)
  //
  // Permission posture: no --dangerously-skip-permissions, no
  // --allow-dangerously-skip-permissions. The prompt forbids tool use.
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
  if (model !== null) {
    args.push('--model', model);
  }
  return args;
}

function noFalsification(
  obligationType: ObligationType,
  attempts: number,
  reason: 'time-budget-exhausted' | 'no-counter-example-discovered',
): NoFalsificationFoundResult {
  return {
    kind: 'no-falsification-found',
    obligationType,
    reason,
    attempts,
  };
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
      detail:
        `${adapterName} only handles import-graph-must-satisfy and function-must-have-signature obligations`,
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

function spawnClaudeCode(
  req: ClaudeCodeInvocationRequest,
): Promise<ClaudeCodeInvocationResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // Pass the prompt via stdin rather than as a positional arg so very
    // long prompts do not bump into ARG_MAX. claude's -p mode reads the
    // initial user message from stdin when no positional prompt is
    // provided.
    const child = spawn(req.binaryPath, [...req.args], {
      cwd: req.cwd,
      env: req.env,
      stdio: ['pipe', 'pipe', 'pipe'],
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
          `failed to spawn claude binary "${req.binaryPath}": ${err.message}. ` +
            `Install the claude-code CLI (npm i -g @anthropic-ai/claude-code) or set ` +
            `ClaudeCodeFalsifierOptions.binaryPath.`,
          { cause: err },
        ),
      );
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `claude exec exceeded the ${req.timeoutMs}ms time budget; the call was killed. ` +
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
    child.stdin.write(req.prompt);
    child.stdin.end();
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}
