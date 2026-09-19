import type { Clock } from "./clock.ts";
import { compactConversation, estimateTokens } from "./compaction.ts";
import { type RepeatedTail, repeatedTail } from "./degenerate-output.ts";
import type { LoopEvent } from "./loop-events.ts";
import { withModelCancellation } from "./model-cancellation.ts";
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

/**
 * How much of the conversation is resent. Well under a small local model's window, because the
 * budget that matters is the one the smallest backend a run might route to actually has.
 */
export const defaultContextTokens = 60_000;

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
  /** How much conversation is resent per call. Defaults to `defaultContextTokens`. */
  readonly contextTokens?: number;
}

export interface AgentLoopOutcome {
  readonly stopReason: StopReason;
  readonly steps: number;
  /** Steps whose response carried something: text, a tool call, or both. */
  readonly answeredSteps: number;
  readonly tokensUsed: number;
  /**
   * Answered calls whose provider reported no usage. `tokensUsed` counts those as nothing, so
   * where this is above zero it is a lower bound and not the total.
   */
  readonly callsWithUnknownUsage: number;
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
  const deadline = startedAt + deps.budget.maxWallTimeMs;
  const messages: ConversationMessage[] = [...(deps.history ?? []), { role: "user", text: task }];
  let lastCompactedAt = 0;
  let steps = 0;
  let answeredSteps = 0;
  let tokensUsed = 0;
  let callsWithUnknownUsage = 0;
  let plan = "";

  const finish = (stopReason: StopReason, completionClaim: string): AgentLoopOutcome => {
    deps.emit({ type: "stopped", reason: stopReason, steps, tokensUsed });
    return {
      stopReason,
      steps,
      answeredSteps,
      tokensUsed,
      callsWithUnknownUsage,
      plan,
      completionClaim,
      messages,
    };
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

    // Said once per compaction rather than per call, so a long run reports that its memory was
    // shortened without saying so forty times.
    const context = compactConversation(messages, {
      maxTokens: deps.contextTokens ?? defaultContextTokens,
    });
    if (context.compacted && context.droppedMessages > lastCompactedAt) {
      lastCompactedAt = context.droppedMessages;
      deps.emit({
        type: "compacted",
        droppedMessages: context.droppedMessages,
        droppedTokens: context.droppedTokens,
      });
    }

    deps.emit({ type: "model-call", step: steps + 1, modelId: deps.model.modelId });

    let response: ModelResponse;
    try {
      response = await callModelWithRetry(
        deps,
        {
          ...buildRequest(deps, messages),
          maxOutputTokens: Math.max(
            1,
            Math.min(deps.maxOutputTokens, deps.budget.maxTokens - tokensUsed),
          ),
          onText: (text) => {
            deps.emit({ type: "model-text", step: steps + 1, text });
          },
        },
        steps + 1,
        deadline,
        (response) => {
          tokensUsed += response.inputTokens + response.outputTokens;
          if (response.usageStatus === "unknown") callsWithUnknownUsage += 1;
        },
        () => deps.budget.maxTokens - tokensUsed,
      );
    } catch (cause) {
      if (cause instanceof ModelTokenBudgetError) return finish("max-tokens", "");
      if (cause instanceof ModelCallDeadlineError) {
        return finish("max-wall-time", "");
      }
      return finish(deps.abortSignal.aborted ? "interrupted" : "model-error", "");
    }

    steps += 1;
    const answered = response.text.trim().length > 0 || response.toolCalls.length > 0;
    if (answered) {
      answeredSteps += 1;
    }
    if (deps.abortSignal.aborted) return finish("interrupted", "");
    if (deps.clock.now() >= deadline) return finish("max-wall-time", "");
    if (tokensUsed >= deps.budget.maxTokens) return finish("max-tokens", "");
    messages.push({
      role: "assistant",
      text: response.text,
      toolCalls: response.toolCalls,
    });

    // Only a first turn states a plan. A later turn in a session is continuing one, and
    // re-emitting would overwrite the plan pane with an answer to a follow-up. A turn the cap
    // cut off is not a plan either: it is what the loop is about to stop on.
    if (steps === 1 && (deps.history ?? []).length === 0 && !spentTheCapWithoutActing(response)) {
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

    if (spentTheCapWithoutActing(response)) {
      // Text that the cap cut off is not the model's account of finishing, however much of it
      // there is: every sample of this step was cut off before a tool was called, and reading
      // the last one as a completion ended a live run "work accepted" with nothing written.
      return finish("output-cap", "");
    }

    if (response.toolCalls.length === 0) {
      deps.emit({ type: "claim", text: response.text, verified: false });
      return finish("completed", response.text);
    }

    const outcomes: ToolCallOutcome[] = [];
    for (const call of response.toolCalls) {
      if (deps.abortSignal.aborted || deps.clock.now() >= deadline) {
        const remaining = response.toolCalls.slice(outcomes.length);
        messages.push({
          role: "tool",
          outcomes: [
            ...outcomes,
            ...remaining.map((pending) => ({
              callId: pending.callId,
              toolName: pending.toolName,
              failed: true,
              output: "not dispatched: run stopped",
            })),
          ],
        });
        return finish(deps.abortSignal.aborted ? "interrupted" : "max-wall-time", "");
      }
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
  // Compacted here rather than in the loop's own list, so the ledger and the screen keep the
  // whole conversation and only what is resent is shortened. What falls out is chosen: the
  // task and the recent turns are kept, and the model is told how much went rather than
  // quietly having a hole in its memory.
  const overhead =
    Math.ceil(
      (deps.systemPrompt.length +
        JSON.stringify(
          deps.toolSchemas.map((tool) => ({
            name: tool.name,
            description: tool.description,
            schema: tool.inputSchema.toJSONSchema(),
          })),
        ).length) /
        4,
    ) + deps.maxOutputTokens;
  const available = Math.max(0, (deps.contextTokens ?? defaultContextTokens) - overhead);
  const held = compactConversation(messages, { maxTokens: available });
  if (estimateTokens(held.messages) > available) throw new ModelTokenBudgetError();
  return {
    system: deps.systemPrompt,
    // Snapshot: the loop keeps appending, and a provider must see the turn it was given.
    messages: [...held.messages],
    tools: deps.toolSchemas,
    maxOutputTokens: deps.maxOutputTokens,
    ...(deps.sampling === undefined ? {} : { sampling: deps.sampling }),
    abortSignal: deps.abortSignal,
  };
}

/**
 * A turn cut off at the output cap having emitted neither text nor a tool call. A reasoning
 * model that spirals inside its own thinking produces exactly this, and it is the call failing
 * rather than the model answering: the surrounding steps of the same run cost a few hundred
 * tokens each, so the next sample of the same request usually lands.
 */
function carriesNothing(response: ModelResponse): boolean {
  return response.text.trim().length === 0 && response.toolCalls.length === 0;
}

function spentTheCapOnNothing(response: ModelResponse): boolean {
  return response.finishReason === "length" && carriesNothing(response);
}

/**
 * A turn cut off at the cap without having called a tool, whether or not text arrived. The
 * text is whatever the model had said when the cap fell, which is not its account of
 * finishing: a live run's only turn was a marker repeated to the cap around a fragment of a
 * plan, and it was read as the completion claim of a run that wrote nothing.
 */
function spentTheCapWithoutActing(response: ModelResponse): boolean {
  return response.finishReason === "length" && response.toolCalls.length === 0;
}

/**
 * A turn with neither text nor a tool call and a finish reason other than the cap is the
 * runtime dropping output, which is a transport failure wearing a response's shape. It is
 * sampled again the way a refused connection is, because one such turn used to end a
 * forty-step run on the spot: two campaign runs stopped that way with their work half done.
 */
function arrivedEmpty(response: ModelResponse): boolean {
  return response.finishReason !== "length" && carriesNothing(response);
}

/**
 * The wall budget ran out inside a call. Distinct from a failed call because it is not
 * retried and the loop stops for the budget's reason rather than the model's.
 */
class ModelTokenBudgetError extends Error {}

class ModelCallDeadlineError extends Error {
  constructor(remainingMs: number) {
    super(`the model call did not return within the ${remainingMs} ms left of the wall budget`);
    this.name = "ModelCallDeadlineError";
  }
}

/**
 * One call, bounded by what is left of the wall budget. The budget was checked between
 * steps only, so a call that never returned held a run until something outside killed it,
 * with no gates, no bundle and no reason recorded. The deadline is armed on the injected
 * clock and let go of the moment the call returns, so it costs nothing on the calls that do.
 */
async function callWithinBudget(
  deps: AgentLoopDependencies,
  request: ModelRequest,
  remainingMs: number,
  attemptSignal?: AbortSignal,
): Promise<ModelResponse> {
  if (remainingMs <= 0) throw new ModelCallDeadlineError(remainingMs);
  deps.abortSignal.throwIfAborted();
  const controller = new AbortController();
  const forward = () => controller.abort();
  deps.abortSignal.addEventListener("abort", forward, { once: true });
  attemptSignal?.addEventListener("abort", forward, { once: true });
  const armed = deps.clock.now();
  const release = new AbortController();
  let expired = false;
  void deps.clock.sleep(remainingMs, release.signal).then(() => {
    if (!release.signal.aborted && deps.clock.now() - armed >= remainingMs) {
      expired = true;
      controller.abort();
    }
  });
  try {
    const pending = deps.model.generate({ ...request, abortSignal: controller.signal });
    return await (deps.model.recordsCancellation === true
      ? pending
      : withModelCancellation(pending, controller.signal));
  } catch (cause) {
    throw expired ? new ModelCallDeadlineError(remainingMs) : cause;
  } finally {
    release.abort();
    deps.abortSignal.removeEventListener("abort", forward);
    attemptSignal?.removeEventListener("abort", forward);
  }
}

async function callModelWithRetry(
  deps: AgentLoopDependencies,
  request: ModelRequest,
  step: number,
  deadline: number,
  account: (response: ModelResponse) => void,
  remainingTokens: () => number,
): Promise<ModelResponse> {
  const { attempts, baseDelayMs, maxJitterRatio } = deps.retryPolicy;
  let lastCause: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    deps.abortSignal.throwIfAborted();
    if (deps.clock.now() >= deadline) throw new ModelCallDeadlineError(0);
    if (remainingTokens() <= 0) throw new ModelTokenBudgetError();
    let willRetry = attempt < attempts - 1 && !deps.abortSignal.aborted;
    // One attempt's stream, watched for a unit repeating itself. Cut off here rather than at
    // the cap: the cap is minutes away at a local model's pace, and nothing after the repeats
    // is going to be a tool call.
    const spiral = new AbortController();
    const stream: { text: string; repeated: RepeatedTail | null } = { text: "", repeated: null };
    const watchText = (text: string): void => {
      request.onText?.(text);
      if (stream.repeated !== null) return;
      stream.text += text;
      stream.repeated = repeatedTail(stream.text);
      if (stream.repeated !== null) {
        spiral.abort();
      }
    };
    try {
      const response = await callWithinBudget(
        deps,
        {
          ...request,
          maxOutputTokens: Math.max(1, Math.min(request.maxOutputTokens, remainingTokens())),
          onText: watchText,
        },
        deadline - deps.clock.now(),
        spiral.signal,
      );
      account(response);
      if (deps.clock.now() >= deadline) throw new ModelCallDeadlineError(0);
      if (remainingTokens() <= 0) return response;
      // The last attempt's truncation or silence is returned rather than thrown, so the loop
      // stops as output-cap or empty-response and names which. A call-failed error there would
      // say less about more.
      if (!(spentTheCapWithoutActing(response) || arrivedEmpty(response)) || !willRetry) {
        return response;
      }
      deps.emit({
        type: "model-error",
        step,
        message: spentTheCapOnNothing(response)
          ? `the model spent all ${response.outputTokens} output tokens without emitting text or a tool call`
          : spentTheCapWithoutActing(response)
            ? `the model was cut off at the ${response.outputTokens}-token output cap before it called a tool; a turn the cap cut off is not its account of finishing`
            : `the runtime answered with neither text nor a tool call (finish reason ${response.finishReason})`,
        willRetry: true,
      });
    } catch (cause) {
      if (stream.repeated !== null && !deps.abortSignal.aborted) {
        // The stream was cut off here, on purpose, and the cause is the transport's word for
        // that. Named for what it was, and sampled again the way a spiral to the cap is.
        lastCause = cause;
        deps.emit({
          type: "model-error",
          step,
          message: `the model repeated ${JSON.stringify(stream.repeated.unit)} ${stream.repeated.repeats} times in a row and was cut off after ${stream.text.length} characters`,
          willRetry,
        });
        if (!willRetry) {
          throw new ModelCallFailedError(deps.model.modelId, lastCause);
        }
        const backoffMs = baseDelayMs * 2 ** attempt;
        await deps.clock.sleep(
          Math.max(0, Math.min(deadline - deps.clock.now(), backoffMs)),
          deps.abortSignal,
          "delay",
        );
        continue;
      }
      // The budget's expiry is not the model's failure, and there is nothing left to retry in.
      if (cause instanceof ModelCallDeadlineError) {
        deps.emit({ type: "model-error", step, message: cause.message, willRetry: false });
        throw cause;
      }
      if (cause instanceof ModelTokenBudgetError) throw cause;
      const status = (cause as { statusCode?: number }).statusCode;
      willRetry &&=
        (cause as { isRetryable?: boolean }).isRetryable !== false &&
        !(
          status !== undefined &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        );
      lastCause = cause;
      deps.emit({
        type: "model-error",
        step,
        message: deps.abortSignal.aborted
          ? stoppedWhileWaiting(deps.abortSignal.reason)
          : describeUnknownError(cause),
        willRetry,
      });
      if (!willRetry) {
        throw new ModelCallFailedError(deps.model.modelId, lastCause);
      }
    }
    const backoffMs = baseDelayMs * 2 ** attempt;
    const delay = Math.min(
      deadline - deps.clock.now(),
      Math.round(backoffMs * (1 + deps.random.next() * maxJitterRatio)),
    );
    await deps.clock.sleep(Math.max(0, delay), deps.abortSignal, "delay");
  }

  throw new ModelCallFailedError(deps.model.modelId, lastCause);
}

/**
 * What stopped the run, in the words the stopper gave, rather than the transport's own words
 * for a cancelled request: "This operation was aborted" told a person nothing about who did.
 */
function stoppedWhileWaiting(reason: unknown): string {
  const named =
    typeof reason === "string"
      ? reason
      : reason instanceof Error && reason.name !== "AbortError"
        ? reason.message
        : "the run was cancelled";
  return `the run was stopped while waiting for the model: ${named}`;
}
