/**
 * The model endpoint exercised the way the product uses it, before an arm is given a task. The
 * `/v1/models` probe in endpoint.mjs says a server process is answering; it said so throughout
 * the launch of 2026-10-20 03:04 UTC whose chat requests the same server never completed, so a
 * listing is not readiness. Readiness here is a bounded sequence of at most three chat
 * completions in the exact wire shape the product sends to a local endpoint (streamed, usage
 * requested, thinking off, the OpenAI tool and tool-result encoding), each answer read as it
 * streams and checked for structure: a plain answer, a tool call with parseable arguments, and
 * the answer after the tool's result. It uses no repository task, no evaluator and no reference
 * solution, and it has no side effect beyond the request itself.
 *
 * A successful sequence is evidence that the endpoint completed inference at that moment, not a
 * guarantee that it will go on doing so; the wall and the stall watch cover what happens after.
 * The probe never runs beside an arm's request: a second request on this server during a long
 * prompt evaluation is what killed it in the comparison's third pass, so the lease below refuses
 * a probe while an invocation holds it, and the refusal is recorded rather than the request sent.
 */

/** How long each probe request may take, end to end, unless the manifest says otherwise. */
export const readinessRequestDeadlineMs = 30_000;
/** How long one readiness sequence (at most three requests) may take. */
export const readinessSequenceDeadlineMs = 90_000;
/** How many sequences may be tried before a launch is refused. */
export const readinessSequences = 2;
/** The most of a streamed answer that is read; a probe answer is a few hundred bytes. */
export const probeMaxBytes = 64 * 1024;
/** The output cap on each probe request, in tokens. */
export const probeMaxTokens = 64;

const probeToolName = "record_probe_word";
const probeTool = {
  type: "function",
  function: {
    name: probeToolName,
    description: "Records the probe word. Call it exactly once with the word you were given.",
    parameters: {
      type: "object",
      properties: { word: { type: "string" } },
      required: ["word"],
      additionalProperties: false,
    },
  },
};
const systemPrompt =
  "You are being checked for readiness. Follow the instruction exactly and briefly.";

/**
 * The lease: who holds the endpoint for inference right now. An invocation holds it for its
 * whole run; a probe asked for while it is held is refused without a request.
 */
export function createInferenceLease() {
  let holder = null;
  return {
    get holder() {
      return holder;
    },
    hold(label) {
      if (holder !== null) throw new Error(`inference is already held by ${holder}`);
      holder = label;
      return () => {
        if (holder === label) holder = null;
      };
    },
  };
}

/** The body the product sends, field for field, with the probe's own messages in it. */
export function probeRequestBody(model, messages, tools) {
  return {
    model,
    max_tokens: probeMaxTokens,
    enable_thinking: false,
    chat_template_kwargs: { enable_thinking: false },
    reasoning_effort: "none",
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    ...(tools === null ? {} : { tools, tool_choice: "auto" }),
    stream: true,
    stream_options: { include_usage: true },
  };
}

/** The three requests of a sequence, each built from what the one before it answered. */
const requestKinds = ["chat", "tool-call", "tool-result"];

function nextRequest(kind, model, previous) {
  if (kind === "chat")
    return probeRequestBody(
      model,
      [{ role: "user", content: "Reply with the single word: ready" }],
      null,
    );
  if (kind === "tool-call")
    return probeRequestBody(
      model,
      [
        {
          role: "user",
          content: `Call the ${probeToolName} tool with the word ready. Do not answer in prose.`,
        },
      ],
      [probeTool],
    );
  const call = previous.toolCalls[0];
  return probeRequestBody(
    model,
    [
      {
        role: "user",
        content: `Call the ${probeToolName} tool with the word ready. Do not answer in prose.`,
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          },
        ],
      },
      { role: "tool", tool_call_id: call.id, content: "recorded ready" },
      { role: "user", content: "The word is recorded. Reply with the single word: done" },
    ],
    [probeTool],
  );
}

/**
 * Reads one streamed chat completion up to `maxBytes`, parsing every `data:` line, and returns
 * what it carried: text, tool calls assembled by index, finish reason, usage, whether the
 * terminator arrived, and the first problem seen in the structure (null when none).
 */
export async function readCompletionStream(body, { maxBytes = probeMaxBytes, onFirstByte } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seen = { text: "", toolCalls: new Map(), finishReason: null, usage: null, done: false };
  let problem = null;
  let bytes = 0;
  let buffered = "";
  let first = true;
  const take = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      seen.done = true;
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      problem ??= `a stream chunk was not JSON: ${payload.slice(0, 80)}`;
      return;
    }
    if (chunk?.error !== undefined) {
      problem ??= `the stream carried an error: ${JSON.stringify(chunk.error).slice(0, 200)}`;
      return;
    }
    if (chunk?.usage && typeof chunk.usage === "object") {
      seen.usage = {
        input: Number(chunk.usage.prompt_tokens ?? 0),
        output: Number(chunk.usage.completion_tokens ?? 0),
      };
    }
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
    if (choice === undefined) return;
    if (typeof choice.delta?.content === "string") seen.text += choice.delta.content;
    for (const call of choice.delta?.tool_calls ?? []) {
      const index = Number(call.index ?? 0);
      const current = seen.toolCalls.get(index) ?? { id: null, name: "", arguments: "" };
      if (typeof call.id === "string" && call.id !== "") current.id = call.id;
      if (typeof call.function?.name === "string") current.name += call.function.name;
      if (typeof call.function?.arguments === "string")
        current.arguments += call.function.arguments;
      seen.toolCalls.set(index, current);
    }
    if (choice.finish_reason != null) seen.finishReason = String(choice.finish_reason);
  };
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    if (first) {
      first = false;
      onFirstByte?.();
    }
    bytes += step.value.byteLength;
    if (bytes > maxBytes) {
      problem ??= `the stream exceeded ${maxBytes} bytes`;
      await reader.cancel().catch(() => undefined);
      break;
    }
    buffered += decoder.decode(step.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) take(line.replace(/\r$/, ""));
  }
  if (buffered.trim() !== "") take(buffered.trim());
  if (!seen.done) problem ??= "the stream ended without [DONE]";
  return {
    text: seen.text,
    toolCalls: [...seen.toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call),
    finishReason: seen.finishReason,
    usage: seen.usage,
    done: seen.done,
    problem,
  };
}

/** What a request of each kind must have answered with, or the first way it did not. */
export function judgeAnswer(kind, answer) {
  if (answer.problem !== null) return answer.problem;
  if (answer.finishReason === null) return "no finish reason arrived";
  if (kind === "tool-call") {
    if (answer.toolCalls.length === 0)
      return `the model answered without a tool call (finish reason ${answer.finishReason}, ${answer.text.length} characters of text)`;
    const call = answer.toolCalls[0];
    if (call.name !== probeToolName)
      return `the tool call named ${call.name}, not ${probeToolName}`;
    if (call.id === null) return "the tool call carried no id";
    let parsed;
    try {
      parsed = JSON.parse(call.arguments);
    } catch {
      return `the tool call's arguments were not JSON: ${call.arguments.slice(0, 80)}`;
    }
    if (typeof parsed?.word !== "string") return "the tool call's arguments carried no word";
    return null;
  }
  if (answer.text.trim() === "")
    return `the model answered with no text (finish reason ${answer.finishReason}${answer.toolCalls.length > 0 ? ", a tool call" : ""})`;
  return null;
}

/**
 * One readiness sequence: the three requests in order, stopping at the first that fails, each
 * under the request deadline and all under the sequence deadline. Returns the sequence record,
 * which is what the attempt record, the halt and the launch ledger keep.
 */
export async function probeInference({
  endpoint,
  model,
  purpose = "readiness",
  lease = null,
  fetchImplementation = fetch,
  requestDeadlineMs = readinessRequestDeadlineMs,
  sequenceDeadlineMs = readinessSequenceDeadlineMs,
  maxBytes = probeMaxBytes,
  now = () => Date.now(),
}) {
  const startedAt = new Date(now()).toISOString();
  const began = now();
  const configuration = {
    endpoint,
    model,
    stream: true,
    includeUsage: true,
    thinking: false,
    maxTokens: probeMaxTokens,
    requestDeadlineMs,
    sequenceDeadlineMs,
  };
  const sequence = {
    purpose,
    startedAt,
    wallMs: 0,
    ok: false,
    problem: null,
    configuration,
    requests: [],
  };
  if (lease !== null && lease.holder !== null) {
    sequence.problem = `refused: inference is held by ${lease.holder}; no probe request was sent`;
    sequence.requests.push({
      kind: "chat",
      wallMs: 0,
      firstByteMs: null,
      status: null,
      outcome: "refused",
      problem: sequence.problem,
      usage: null,
    });
    return sequence;
  }
  const release = lease === null ? () => {} : lease.hold(`probe (${purpose})`);
  try {
    let previous = null;
    for (const kind of requestKinds) {
      const left = sequenceDeadlineMs - (now() - began);
      if (left <= 0) {
        sequence.problem = `the sequence deadline of ${sequenceDeadlineMs} ms was spent before the ${kind} request`;
        break;
      }
      const request = {
        kind,
        wallMs: 0,
        firstByteMs: null,
        status: null,
        outcome: "failed",
        problem: null,
        usage: null,
      };
      sequence.requests.push(request);
      const requestBegan = now();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("the request deadline passed")),
        Math.min(requestDeadlineMs, left),
      );
      try {
        const response = await fetchImplementation(
          `${endpoint.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(nextRequest(kind, model, previous)),
            signal: controller.signal,
          },
        );
        request.status = response.status;
        if (!response.ok) {
          request.problem = `HTTP ${response.status}`;
        } else if (response.body === null) {
          request.problem = "the response had no body";
        } else {
          const answer = await readCompletionStream(response.body, {
            maxBytes,
            onFirstByte: () => {
              request.firstByteMs = now() - requestBegan;
            },
          });
          request.usage = answer.usage;
          request.problem = judgeAnswer(kind, answer);
          previous = answer;
        }
      } catch (cause) {
        request.problem = controller.signal.aborted
          ? `no complete answer within ${Math.min(requestDeadlineMs, left)} ms`
          : (cause?.message ?? String(cause));
      } finally {
        clearTimeout(timer);
      }
      request.wallMs = now() - requestBegan;
      if (request.problem === null) request.outcome = "answered";
      else {
        sequence.problem = `the ${kind} request failed: ${request.problem}`;
        break;
      }
    }
  } finally {
    release();
  }
  sequence.ok = sequence.problem === null;
  sequence.wallMs = now() - began;
  return sequence;
}

/**
 * Readiness: up to `sequences` sequences, stopping at the first that succeeds. Returns every
 * sequence tried and whether the last one succeeded. A refused sequence (the lease was held)
 * is not retried: nothing about the endpoint was learned.
 */
export async function establishReadiness(options, sequences = readinessSequences) {
  const tried = [];
  for (let attempt = 0; attempt < sequences; attempt += 1) {
    const sequence = await probeInference(options);
    tried.push(sequence);
    if (sequence.ok || sequence.requests.some((one) => one.outcome === "refused")) break;
  }
  return { ok: tried.at(-1)?.ok === true, sequences: tried };
}

/**
 * The usage and wall the probes of a record spent, kept apart from the task's own. The token
 * total is a lower bound where a request answered without usage or never answered; how many
 * requests that was is said beside it, as the invocations' totals say it.
 */
export function probeTotals(sequences) {
  let tokens = 0;
  let withoutUsage = 0;
  let requests = 0;
  let wallMs = 0;
  for (const sequence of sequences) {
    wallMs += sequence.wallMs;
    for (const request of sequence.requests) {
      if (request.outcome === "refused") continue;
      requests += 1;
      if (request.usage === null) withoutUsage += 1;
      else tokens += request.usage.input + request.usage.output;
    }
  }
  return {
    probeRequests: requests,
    probeRequestsWithoutUsage: withoutUsage,
    probeTokens: tokens,
    probeWallMs: wallMs,
  };
}
