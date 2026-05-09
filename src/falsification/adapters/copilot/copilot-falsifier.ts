/**
 * `CopilotFalsifier` — Phase 3 falsifier adapter.
 *
 * Spawns the real `copilot` binary in non-interactive `-p` mode against an
 * isolated workspace. One strategy: import-graph perturbation and
 * function-signature drift, targeting `import-graph-must-satisfy` and
 * `function-must-have-signature` obligations (disjoint from Codex's
 * `property-must-hold` target).
 *
 * Steps:
 *   1. Build the type-aware Copilot prompt for the obligation.
 *   2. Spawn Copilot as a subprocess inside the isolated workspace.
 *   3. Parse the strict JSON candidate document Copilot returns.
 *   4. For each candidate: snapshot the workspace files the candidate
 *      touches, apply the candidate (allowing overwrites), run the
 *      AST-backed verifier, restore the snapshot.
 *   5. Classify confirmed counter-examples vs. false positives.
 *   6. Return a typed `FalsifyOutcome` with the per-call cost record.
 *
 * Errors from the underlying CLI (binary missing, auth failure, parse
 * failure) are real errors and must be thrown — collapsing them to
 * `no-falsification-found` would hide regressions.
 *
 * Sandbox posture: per the plan's risk register, no `--allow-all-tools`
 * and no `--yolo` outside the env-gated integration test. Production runs
 * use a constrained per-tool permission set; the integration test may
 * relax permissions and documents that in-source.
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
import { buildCopilotPrompt } from './copilot-prompt';
import { parseCopilotCandidates } from './copilot-output-parser';
import { runCandidateAgainstObligation, checkObligationBaseline } from './predicate-runner';
import {
  detectCopilotAuthMethod,
  dollarsForRequestsByAuth,
  parseCopilotPremiumRequests,
} from './copilot-cost';

/** Ceiling on captured stdout/stderr size. Truncated past this. */
const MAX_OUTPUT_BYTES = 1_000_000;

/**
 * Default per-tool permission grants for production runs. The plan
 * forbids `--allow-all-tools` outside test fixtures; this list grants
 * only the tools the candidate-emission strategy needs:
 *   - `view`: read files inside the workspace so the model can see what
 *     it is being asked to perturb.
 * The model is explicitly told in the prompt not to write or run shells.
 */
const DEFAULT_ALLOWED_TOOLS: readonly string[] = ['view'];

/** Options accepted by the Copilot falsifier. */
export interface CopilotFalsifierOptions {
  /** Path to the copilot binary. Defaults to `copilot` on PATH. */
  readonly binaryPath?: string;
  /** Model override; null/undefined lets copilot pick its default. */
  readonly model?: string | null;
  /**
   * Tools the model may invoke without prompting. Defaults to `['view']`.
   * Pass `'all'` (capital-A) only inside the env-gated integration test;
   * production runs leave the default in place.
   */
  readonly allowedTools?: readonly string[] | 'all';
  /**
   * Test seam: replace the subprocess invocation with a synchronous
   * function that produces the same `CopilotInvocationResult`. Production
   * code does not pass this — the adapter must run the real CLI to
   * satisfy Phase 3's "no mocks of the CLI" rule.
   */
  readonly invocationOverride?: (
    request: CopilotInvocationRequest,
  ) => Promise<CopilotInvocationResult>;
  /**
   * Observability hook fired after every real (or overridden) subprocess
   * invocation completes. Side-effect only — the adapter still consumes
   * the same result it returned. The Phase 3 harness uses this to capture
   * raw stdout/stderr per obligation without modifying subprocess
   * behaviour.
   */
  readonly onInvocation?: (
    request: CopilotInvocationRequest,
    result: CopilotInvocationResult,
  ) => void;
  /**
   * Test seam: override the auth-method detector. Production code reads
   * the local copilot install state; tests can pass a constant function
   * to avoid spawning the real binary.
   */
  readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';
  /**
   * Override the premium-request count parser. Test seam only; production
   * uses the stderr/stdout regex match.
   */
  readonly premiumRequestsOverride?: (output: string) => number | null;
}

export interface CopilotInvocationRequest {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;
}

export interface CopilotInvocationResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly wallClockMs: number;
}

type SupportedObligation =
  | ImportGraphMustSatisfyObligation
  | FunctionMustHaveSignatureObligation;

/** Public Copilot falsifier adapter. */
export class CopilotFalsifier implements FalsifierAdapter {
  readonly name = 'copilot';
  readonly handles: readonly ObligationType[] = [
    'import-graph-must-satisfy',
    'function-must-have-signature',
  ];
  private readonly binaryPath: string;
  private readonly model: string | null;
  private readonly allowedTools: readonly string[] | 'all';
  private readonly invocationOverride?: (
    req: CopilotInvocationRequest,
  ) => Promise<CopilotInvocationResult>;
  private readonly onInvocation?: (
    req: CopilotInvocationRequest,
    res: CopilotInvocationResult,
  ) => void;
  private readonly authMethodOverride?: () => 'chatgpt' | 'api' | 'unknown';
  private readonly premiumRequestsOverride?: (output: string) => number | null;

  constructor(options: CopilotFalsifierOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'copilot';
    this.model = options.model === undefined ? null : options.model;
    this.allowedTools = options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    if (options.invocationOverride !== undefined) {
      this.invocationOverride = options.invocationOverride;
    }
    if (options.onInvocation !== undefined) {
      this.onInvocation = options.onInvocation;
    }
    if (options.authMethodOverride !== undefined) {
      this.authMethodOverride = options.authMethodOverride;
    }
    if (options.premiumRequestsOverride !== undefined) {
      this.premiumRequestsOverride = options.premiumRequestsOverride;
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
        : detectCopilotAuthMethod(this.binaryPath);

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
          authMethod,
          counterExamplesFound: 0,
          falsePositives: 0,
        },
      };
    }

    const prompt = buildCopilotPrompt(obligation);
    const args = buildCopilotArgs(this.model, this.allowedTools);
    const invocation: CopilotInvocationRequest = {
      binaryPath: this.binaryPath,
      args,
      cwd: input.workspaceRoot,
      prompt,
      timeoutMs: input.timeBudgetMs,
      env: process.env,
    };
    const subprocess = await this.runCopilot(invocation);
    if (subprocess.exitCode !== 0) {
      throw new Error(
        `copilot exec failed with exit code ${subprocess.exitCode}. ` +
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
    const candidates = parseCopilotCandidates(subprocess.stdout);
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
    const combinedOutput = `${subprocess.stdout}\n${subprocess.stderr}`;
    const requestsParser = this.premiumRequestsOverride ?? parseCopilotPremiumRequests;
    const premiumRequests = requestsParser(combinedOutput);
    const { dollarsBilled, dollarsTokenEstimate } =
      premiumRequests === null
        ? { dollarsBilled: 0, dollarsTokenEstimate: 0 }
        : dollarsForRequestsByAuth(premiumRequests, authMethod);
    const cost: AdapterCostRecord = {
      adapterName: this.name,
      obligationType: obligation.type,
      wallClockMs,
      dollarsSpent: dollarsTokenEstimate,
      dollarsBilled,
      dollarsTokenEstimate,
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

  private async runCopilot(req: CopilotInvocationRequest): Promise<CopilotInvocationResult> {
    const result =
      this.invocationOverride !== undefined
        ? await this.invocationOverride(req)
        : await spawnCopilot(req);
    if (this.onInvocation !== undefined) {
      this.onInvocation(req, result);
    }
    return result;
  }
}

function buildCopilotArgs(
  model: string | null,
  allowedTools: readonly string[] | 'all',
): readonly string[] {
  // Argument shape per `copilot --help` (CLI 1.0.44):
  //   -p <prompt>                          non-interactive prompt mode
  //   --no-ask-user                        do not prompt the operator
  //   --output-format text                 plain text reply (JSON envelope is JSONL,
  //                                        which complicates fenced-block extraction)
  //   --allow-tool <name>                  per-tool permission grant
  //   --allow-all-paths                    allow read across the workspace tree
  //   --no-color                           strip ANSI from captured stdout
  // The plan forbids `--allow-all-tools` outside test fixtures; the
  // adapter passes per-tool grants from `allowedTools`. The integration
  // test seam may set `allowedTools = 'all'`, which expands to
  // `--allow-all-tools`.
  //
  // Note: `-s/--silent` is intentionally *omitted*. With --silent the
  // CLI suppresses the trailing `Requests N Premium (Ts)` stats line —
  // which is the only surface the cost-aggregator can read to map a
  // call to dollars. The brace-balanced JSON extractor in
  // copilot-output-parser.ts terminates at the matching close-brace and
  // ignores everything after, so the stats trailer cannot leak into the
  // candidate document.
  const args: string[] = [
    '--no-ask-user',
    '--no-color',
    '--output-format',
    'text',
    '--allow-all-paths',
  ];
  if (allowedTools === 'all') {
    args.push('--allow-all-tools');
  } else {
    for (const tool of allowedTools) {
      args.push('--allow-tool', tool);
    }
  }
  if (model !== null) {
    args.push('--model', model);
  }
  // -p <prompt> last so the prompt body cannot accidentally be parsed as a
  // flag argument. The spawn layer passes args via execve, not a shell, so
  // shell injection is not a concern here.
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
      detail: `${adapterName} only handles import-graph-must-satisfy and function-must-have-signature obligations`,
    },
    cost: {
      adapterName,
      obligationType,
      wallClockMs: Date.now() - startedAt,
      dollarsSpent: 0,
      dollarsBilled: 0,
      dollarsTokenEstimate: 0,
      authMethod: 'unknown',
      counterExamplesFound: 0,
      falsePositives: 0,
    },
  };
}

function spawnCopilot(req: CopilotInvocationRequest): Promise<CopilotInvocationResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(req.binaryPath, [...req.args, '-p', req.prompt], {
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
          `failed to spawn copilot binary "${req.binaryPath}": ${err.message}. ` +
            `Install the copilot CLI (npm i -g @github/copilot) or set CopilotFalsifierOptions.binaryPath.`,
          { cause: err },
        ),
      );
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `copilot exec exceeded the ${req.timeoutMs}ms time budget; the call was killed. ` +
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
