/**
 * Two questions about a model endpoint, kept apart by name so neither can stand in for the other.
 *
 * `endpointListsModels` asks for metadata. It is the right probe for discovery and for recording
 * what a server says it serves, and it is evidence of nothing else: an MLX server whose generation
 * thread has died of GPU memory keeps answering `/models` while every completion hangs until the
 * caller's deadline. Seven mined tasks in a row were recorded as the model writing nothing on the
 * strength of that answer.
 *
 * `endpointGenerates` asks the configured model for a bounded completion. It is the only probe
 * that may decide whether a failed or unchanged result can be charged to the model.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MetadataProbe {
  readonly listed: boolean;
  readonly detail: string;
}

export async function endpointListsModels(
  endpoint: string,
  options: { readonly timeoutMs?: number; readonly fetch?: FetchLike } = {},
): Promise<MetadataProbe> {
  const ask = options.fetch ?? fetch;
  try {
    const asked = await ask(`${endpoint.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    return asked.ok
      ? { listed: true, detail: "" }
      : { listed: false, detail: `HTTP ${asked.status} from ${endpoint}` };
  } catch (cause) {
    return { listed: false, detail: `${describe(cause)} (${endpoint})` };
  }
}

/** Why a generation probe failed. Every one of these is about the endpoint and none about a task. */
export type GenerationFailure =
  | "timeout"
  | "unreachable"
  | "http-error"
  | "unreadable-body"
  | "no-usable-choice";

export type GenerationProbe =
  | { readonly generates: true; readonly failure: null; readonly detail: "" }
  | { readonly generates: false; readonly failure: GenerationFailure; readonly detail: string };

/**
 * Whether the endpoint completes a request for this model, asked with the smallest one there is.
 *
 * A usable choice carries text or a tool call. HTTP 200 with an empty `choices`, or a choice whose
 * content is empty, is a server that accepted the request and produced nothing an agent could act
 * on, which is what a reasoning model served with thinking left on does to every call: the agent
 * would record a cohort of empty turns, each one read as the model.
 */
export async function endpointGenerates(
  endpoint: string,
  model: string,
  options: { readonly timeoutMs?: number; readonly fetch?: FetchLike } = {},
): Promise<GenerationProbe> {
  const ask = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const failed = (failure: GenerationFailure, detail: string): GenerationProbe => ({
    generates: false,
    failure,
    detail: `${detail} (${endpoint}, model ${model})`,
  });
  // One deadline over the request and the body: a server that sends headers and then stalls has
  // not completed anything either.
  const signal = AbortSignal.timeout(timeoutMs);
  let asked: Response;
  try {
    asked = await ask(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say ok." }],
        max_tokens: 4,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal,
    });
  } catch (cause) {
    return timedOut(cause)
      ? failed("timeout", `no completion within ${timeoutMs} ms`)
      : failed("unreachable", describe(cause));
  }
  if (!asked.ok) return failed("http-error", `HTTP ${asked.status}`);
  let body: unknown;
  try {
    body = await asked.json();
  } catch (cause) {
    return timedOut(cause)
      ? failed("timeout", `no completion within ${timeoutMs} ms`)
      : failed("unreadable-body", `the completion was not JSON: ${describe(cause)}`);
  }
  return carriesAUsableChoice(body)
    ? { generates: true, failure: null, detail: "" }
    : failed("no-usable-choice", "HTTP success, and no choice carrying text or a tool call");
}

function carriesAUsableChoice(body: unknown): boolean {
  const choices = (body as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) return false;
  return choices.some((choice) => {
    const message = (choice as { message?: { content?: unknown; tool_calls?: unknown } } | null)
      ?.message;
    return (
      (typeof message?.content === "string" && message.content.trim().length > 0) ||
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0)
    );
  });
}

function timedOut(cause: unknown): boolean {
  const name = (cause as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Whether what an invocation left behind may be read as the agent's answer.
 *
 * An unchanged patch, an empty patch and a broken patch all mean something about the model only
 * if the model could be reached while it was being asked. Two observations settle that, both the
 * harness's own: the probe taken after the invocation, and the ledger's count of model calls that
 * raised before any answer arrived.
 *
 * The second rule asks whether any call was answered, not why the others were not. Generation 1
 * of the reach-pressure run is the case: one call per invocation, in flight against a wedged
 * server until the wall budget cancelled it. An invocation in which the model never answered once
 * holds no behaviour of the model to read, whoever ended the call.
 *
 * A cancelled call among answered ones is different, and is the agent's. Every unknown-usage row
 * of generation 3 is one call in flight when the wall budget ended, after two or three dozen
 * answered ones, on an endpoint that was generating throughout: an agent that ran out of time.
 *
 * The residual, named: a provider error partway through an invocation on an endpoint that then
 * recovers is still charged to the agent. It ends the invocation early, the ledger records it,
 * `endedOnProviderFailure` carries it onto the row, and nothing here can tell a transient fault
 * from a request the agent's own transcript made too large to serve.
 */
export interface ModelCallOutcomes {
  readonly modelCalls: number | null;
  /** Calls that raised before an answer arrived, cancelled ones included. */
  readonly failedCalls: number | null;
}

export type InvocationAttribution =
  | { readonly to: "agent" }
  | {
      readonly to: "infrastructure";
      readonly reason: "endpoint-not-generating" | "no-model-call-answered";
      readonly detail: string;
    };

export function attributeInvocation(input: {
  readonly probe: GenerationProbe;
  readonly calls?: ModelCallOutcomes;
}): InvocationAttribution {
  if (!input.probe.generates) {
    return {
      to: "infrastructure",
      reason: "endpoint-not-generating",
      detail: `the model endpoint stopped generating (${input.probe.failure}): ${input.probe.detail}`,
    };
  }
  const calls = input.calls;
  if (
    calls !== undefined &&
    calls.modelCalls !== null &&
    calls.modelCalls > 0 &&
    calls.failedCalls === calls.modelCalls
  ) {
    return {
      to: "infrastructure",
      reason: "no-model-call-answered",
      detail: `none of the invocation's ${calls.modelCalls} model call(s) was answered`,
    };
  }
  return { to: "agent" };
}
