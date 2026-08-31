/**
 * Which of the three things an empty assistant turn was, read off the bytes the transport
 * trace kept rather than guessed at from the turn.
 *
 * The three are indistinguishable downstream and want different fixes: a backend that emitted
 * nothing is a backend or a prompt problem, content that reached the wire and not the turn is
 * this client's problem, and reasoning tokens with no answer beside them is the chat template
 * putting the answer in a channel the assembly does not read. Nothing here decides anything
 * about a run; it names what the wire showed, for a person reading a trace.
 */

export type EmptyTurnCause =
  /** The turn carried text or a tool call, so there is nothing to explain. */
  | "not-empty"
  /** Nothing on the wire would have become an assistant turn. */
  | "backend-emitted-nothing"
  /** The wire carried reasoning and no answer: the template's channels and ours disagree. */
  | "reasoning-only"
  /** The wire carried an answer and the turn did not: assembly lost it. */
  | "client-dropped-content"
  /** The body is not a completion this can read, so nothing is attributed either way. */
  | "unreadable-response";

export interface WireContent {
  /** Whether anything in the body parsed as a completion chunk at all. */
  readonly parsed: boolean;
  readonly contentCharacters: number;
  readonly reasoningCharacters: number;
  readonly toolCallFragments: number;
}

/** The assembled turn, as the loop would see it. */
export interface AssembledTurn {
  readonly text: string;
  readonly toolCalls: number;
}

/**
 * Reads both shapes an OpenAI-compatible endpoint answers in: a `data:` stream of deltas, and
 * a single JSON object when nothing asked for a stream.
 */
export function readWireContent(rawResponseBody: string): WireContent {
  const chunks = [...streamChunks(rawResponseBody), ...wholeResponse(rawResponseBody)];
  let contentCharacters = 0;
  let reasoningCharacters = 0;
  let toolCallFragments = 0;

  for (const chunk of chunks) {
    for (const choice of choicesOf(chunk)) {
      // delta for a stream, message for a whole response: the field names differ and
      // everything under them does not.
      const carrier = objectField(choice, "delta") ?? objectField(choice, "message");
      if (carrier === null) {
        continue;
      }
      contentCharacters += textLength(carrier.content);
      reasoningCharacters += textLength(carrier.reasoning_content) + textLength(carrier.reasoning);
      const calls = carrier.tool_calls;
      if (Array.isArray(calls)) {
        toolCallFragments += calls.length;
      }
    }
  }

  return {
    parsed: chunks.length > 0,
    contentCharacters,
    reasoningCharacters,
    toolCallFragments,
  };
}

export function classifyEmptyTurn(wire: WireContent, assembled: AssembledTurn): EmptyTurnCause {
  if (assembled.text.trim().length > 0 || assembled.toolCalls > 0) {
    return "not-empty";
  }
  if (!wire.parsed) {
    return "unreadable-response";
  }
  if (wire.contentCharacters > 0 || wire.toolCallFragments > 0) {
    return "client-dropped-content";
  }
  return wire.reasoningCharacters > 0 ? "reasoning-only" : "backend-emitted-nothing";
}

/** One sentence a person can act on, per cause. */
export function describeEmptyTurnCause(cause: EmptyTurnCause): string {
  switch (cause) {
    case "not-empty":
      return "the turn carried content, so nothing was empty.";
    case "backend-emitted-nothing":
      return "the backend sent a completion carrying no content, no reasoning and no tool call: the empty turn came from the server, not from this client.";
    case "reasoning-only":
      return "the backend sent reasoning tokens and no answer beside them, which is the chat template emitting into a channel the client does not assemble from.";
    case "client-dropped-content":
      return "content reached the wire and did not reach the turn: the loss is in this client's stream assembly.";
    case "unreadable-response":
      return "the response body is not a completion this reader understands, so nothing is attributed to either side.";
  }
}

function* streamChunks(body: string): Iterable<Record<string, unknown>> {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") {
      continue;
    }
    const parsed = parseObject(payload);
    if (parsed !== null) {
      yield parsed;
    }
  }
}

/** A body with no `data:` line at all may still be one non-streamed completion. */
function* wholeResponse(body: string): Iterable<Record<string, unknown>> {
  if (body.includes("data:")) {
    return;
  }
  const parsed = parseObject(body.trim());
  if (parsed !== null) {
    yield parsed;
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function choicesOf(chunk: Record<string, unknown>): readonly Record<string, unknown>[] {
  const choices = chunk.choices;
  if (!Array.isArray(choices)) {
    return [];
  }
  return choices.filter(
    (choice): choice is Record<string, unknown> =>
      typeof choice === "object" && choice !== null && !Array.isArray(choice),
  );
}

function objectField(
  holder: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const value = holder[name];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textLength(value: unknown): number {
  return typeof value === "string" ? value.trim().length : 0;
}
