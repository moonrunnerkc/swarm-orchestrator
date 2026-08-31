import { appendFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "../evidence/canonical-json.ts";
import { scrubJson } from "../evidence/scrub.ts";

/**
 * What a local backend was actually sent and what it actually sent back, written down before
 * anything parses it.
 *
 * Two calibration bundles came back holding assistant turns with nothing in them, and the
 * three things that produce that are indistinguishable from the assembled turn alone: the
 * backend emitted no content, the client lost the content while assembling the stream, or the
 * chat template put the answer somewhere the assembly does not read. Only the bytes on the
 * wire separate them, and by the time a ModelResponse exists the bytes are gone.
 *
 * Off unless a path is named, because a trace holds the whole prompt and the whole completion
 * and there is no reason for a normal run to write that twice.
 */

export type TransportTraceWriter = (entry: JsonValue) => void;

/** One direction of one exchange, as it went over the wire. */
export type TransportTracePhase = "request" | "response" | "transport-error";

/**
 * Appends one JSON object per line, in call order. Ordered by a promise chain rather than by
 * awaiting the caller: a trace must not change the timing of the stream it is describing, and
 * time to first token is a calibration dimension.
 */
export function createTransportTraceFile(path: string): TransportTraceWriter {
  let queue = Promise.resolve();
  return (entry) => {
    queue = queue.then(
      () => appendFile(path, `${canonicalJson(entry)}\n`, "utf8"),
      // A debug artifact that cannot be written is not worth failing a run over, and a
      // rejected chain would take every later entry with it.
      () => {},
    );
  };
}

/**
 * Wraps a fetch so every exchange through it is written down raw. The response body is passed
 * through a transform that copies bytes as they arrive rather than buffered and replayed: a
 * consumer that waits for the whole body before seeing the first chunk is a different
 * transport from the one being diagnosed.
 */
export function createTracingFetch(
  inner: typeof globalThis.fetch,
  write: TransportTraceWriter,
): typeof globalThis.fetch {
  let exchange = 0;

  return async (input, init) => {
    exchange += 1;
    const id = exchange;
    write(
      scrubbed({
        exchange: id,
        phase: "request",
        url: urlOf(input),
        method: methodOf(input, init),
        headers: headersOf(init?.headers),
        body: bodyOf(init?.body),
      }),
    );

    let response: Response;
    try {
      response = await inner(input, init);
    } catch (cause) {
      write(
        scrubbed({
          exchange: id,
          phase: "transport-error",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      throw cause;
    }

    return copyBodyInto(response, (raw) => {
      write(
        scrubbed({
          exchange: id,
          phase: "response",
          status: response.status,
          headers: headersOf(response.headers),
          body: raw,
        }),
      );
    });
  };
}

/**
 * The same detector the ledger scrub uses, so a trace cannot become the one place a bearer
 * token is written in the clear.
 */
function scrubbed(entry: JsonValue): JsonValue {
  return scrubJson(entry).value;
}

function copyBodyInto(response: Response, record: (raw: string) => void): Response {
  // A status that may carry no body cannot be rebuilt around a stream, and there is nothing
  // to copy out of one anyway.
  if (response.body === null || response.status === 204 || response.status === 304) {
    record("");
    return response;
  }

  const decoder = new TextDecoder();
  let raw = "";
  const passthrough = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      raw += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    flush() {
      raw += decoder.decode();
      record(raw);
    },
  });

  return new Response(response.body.pipeThrough(passthrough), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function methodOf(
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit | undefined,
): string {
  if (init?.method !== undefined) {
    return init.method;
  }
  return typeof input === "string" || input instanceof URL ? "GET" : input.method;
}

function headersOf(headers: RequestInit["headers"] | Headers | undefined): JsonValue {
  if (headers === undefined) {
    return {};
  }
  const named: Record<string, JsonValue> = {};
  for (const [name, value] of new Headers(headers)) {
    named[name] = value;
  }
  return named;
}

/**
 * The body as the transport holds it, or a note saying what shape it was. A stream body is
 * named rather than drained: draining it here would consume the request.
 */
function bodyOf(body: RequestInit["body"]): JsonValue {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  return { unread: body.constructor?.name ?? typeof body };
}
