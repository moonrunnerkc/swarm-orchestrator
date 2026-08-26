import type { Clock } from "./clock.ts";
import type { LoopEvent } from "./loop-events.ts";
import {
  type ConversationMessage,
  describeUnknownError,
  ModelCallFailedError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type SamplingSettings,
  type ToolCallOutcome,
  type ToolSchema,
} from "./model-client.ts";
import type { RandomSource } from "./random-source.ts";
import { findExhaustedLimit, type LoopBudget, type StopReason } from "./termination.ts";
import type { ToolInvoker } from "./tool-invoker.ts";

interface ModelRetryPolicy {
  /** Total attempts per step, including the first. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  /** Upper bound on the fraction added to a backoff delay, spreading retries across callers. */
  readonly maxJitterRatio: number;
}

export interface AgentLoopDependencies {
  readonly model: ModelClient;
  readonly toolInvoker: ToolInvoker;
  readonly toolSchemas: readonly ToolSchema[];
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly emit: (event: LoopEvent) => void;
  readonly budget: LoopBudget;
  readonly abortSignal: AbortSignal;
  readonly systemPrompt: string;
  readonly maxOutputTokens: number;
  /** Absent leaves decoding to the backend, which is what an ordinary task run does. */
  readonly sampling?: SamplingSettings;
  readonly retryPolicy: ModelRetryPolicy;
  /**
   * What was already said, for a session where the person types a second task with the first
   * still in mind. Absent is the ordinary case and starts clean, which is what a single run
   * does and what the gate-resolve path deliberately keeps doing: a retry that inherited the
   * reasoning which produced the failure is a retry that repeats it.
   */
  readonly history?: readonly ConversationMessage[];
}

export interface AgentLoopOutcome {
  readonly stopReason: StopReason;
  readonly steps: number;
  /** Steps whose response carried something: text, a tool call, or both. */
  readonly answeredSteps: number;
  readonly tokensUsed: number;
  /** The plan the model stated on its first turn, as unverified prose. */
  readonly plan: string;
  /** The model's account of finishing. Unverified here: gates decide, not the model (invariant 1). */
  readonly completionClaim: string;
  readonly messages: readonly ConversationMessage[];
}

/**
 * Plan, act, verify. The first turn states a plan, later turns act through the tool
 * chokepoint, and a turn with no tool calls is a completion claim the harness records
 * without believing.
 */
export async function runAgentLoop(
  task: string,
  deps: AgentLoopDependencies,
): Promise<AgentLoopOutcome> {
  const startedAt = deps.clock.now();
  const messages: ConversationMessage[] = [...(deps.history ?? []), { role: "user", text: task }];
  let steps = 0;
  let answeredSteps = 0;
  let tokensUsed = 0;
  let plan = "";

  const finish = (stopReason: StopReason, completionClaim: string): AgentLoopOutcome => {
    deps.emit({ type: "stopped", reason: stopReason, steps, tokensUsed });
    return { stopReason, steps, answeredSteps, tokensUsed, plan, completionClaim, messages };
  };

  for (;;) {
    const exhausted = findExhaustedLimit(
      {
        steps,
        tokensUsed,
        elapsedMs: deps.clock.now() - startedAt,
        interrupted: deps.abortSignal.aborted,
      },
      deps.budget,
    );
    if (exhausted !== null) {
      return finish(exhausted, "");
    }

    deps.emit({ type: "model-call", step: steps + 1, modelId: deps.model.modelId });

    let response: ModelResponse;
    try {
      response = await callModelWithRetry(
        deps,
        {
          ...buildRequest(deps, messages),
          onText: (text) => {
            deps.emit({ type: "model-text", step: steps + 1, text });
          },
        },
        steps + 1,
      );
    } catch {
      return finish(deps.abortSignal.aborted ? "interrupted" : "model-error", "");
    }

    steps += 1;
    const answered = response.text.trim().length > 0 || response.toolCalls.length > 0;
    if (answered) {
      answeredSteps += 1;
    }
    tokensUsed += response.inputTokens + response.outputTokens;
    messages.push({
      role: "assistant",
      text: response.text,
      toolCalls: response.toolCalls,
    });

    // Only a first turn states a plan. A later turn in a session is continuing one, and
    // re-emitting would overwrite the plan pane with an answer to a follow-up.
    if (steps === 1 && (deps.history ?? []).length === 0) {
      plan = response.text;
      deps.emit({ type: "plan", text: response.text });
    }

    if (!answered) {
      // No claim is emitted: there is no text to claim anything, and recording an empty
      // string as the model's account of finishing would be the harness writing the claim.
      // Which of the two it was comes off the finish reason rather than a guess: a turn cut
      // off at the cap and a turn that arrived empty look identical from the content alone.
      return finish(response.finishReason === "length" ? "output-cap" : "empty-response", "");
    }

    if (response.toolCalls.length === 0) {
      deps.emit({ type: "claim", text: response.text, verified: false });
      return finish("completed", response.text);
    }

    const outcomes: ToolCallOutcome[] = [];
    for (const call of response.toolCalls) {
      deps.emit({
        type: "tool-call",
        callId: call.callId,
        toolName: call.toolName,
        input: call.input,
      });
      const outcome = await deps.toolInvoker.invoke({ ...call, provenance: "model" });
      deps.emit({
        type: "tool-outcome",
        callId: outcome.callId,
        toolName: outcome.toolName,
        failed: outcome.failed,
        output: outcome.output,
      });
      outcomes.push(outcome);
    }
    messages.push({ role: "tool", outcomes });
  }
}

function buildRequest(
  deps: AgentLoopDependencies,
  messages: readonly ConversationMessage[],
): ModelRequest {
  return {
    system: deps.systemPrompt,
    // Snapshot: the loop keeps appending, and a provider must see the turn it was given.
    messages: [...messages],
    tools: deps.toolSchemas,
    maxOutputTokens: deps.maxOutputTokens,
    ...(deps.sampling === undefined ? {} : { sampling: deps.sampling }),
    abortSignal: deps.abortSignal,
  };
}

async function callModelWithRetry(
  deps: AgentLoopDependencies,
  request: ModelRequest,
  step: number,
): Promise<ModelResponse> {
  const { attempts, baseDelayMs, maxJitterRatio } = deps.retryPolicy;
  let lastCause: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await deps.model.generate(request);
    } catch (cause) {
      lastCause = cause;
      const willRetry = attempt < attempts - 1 && !deps.abortSignal.aborted;
      deps.emit({
        type: "model-error",
        step,
        message: describeUnknownError(cause),
        willRetry,
      });
      if (!willRetry) {
        break;
      }
      const backoffMs = baseDelayMs * 2 ** attempt;
      await deps.clock.sleep(Math.round(backoffMs * (1 + deps.random.next() * maxJitterRatio)));
    }
  }

  throw new ModelCallFailedError(deps.model.modelId, lastCause);
}

/** One short phrase naming what a tool call is about, for the activity line while it runs. */
function describeToolInput(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return "";
  }
  const fields = input as Record<string, unknown>;
  for (const key of ["command", "path", "pattern", "query"]) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}
