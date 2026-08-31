/**
 * Raw request and response bodies for a local backend, written before anything parses them.
 *
 * Off unless a path is named, because the artifact holds whole prompts and whole completions
 * and is the wrong thing to leave running. It exists for one question that the assembled
 * response cannot answer: when a turn arrives empty, was the body empty on the wire, did the
 * stream carry content the client then dropped, or did the backend answer with a stream that
 * ended before it said anything. Those three look identical by the time a ModelResponse
 * exists, and they have three different fixes.
 *
 * The response body is teed rather than buffered. Reading it whole and replaying it would
 * make every local call arrive at once, which is the behaviour `createLocalFetch` exists to
 * avoid, and would destroy the first-token timing calibration measures.
 */

export interface TransportTraceSink {
  write(entry: TransportTraceEntry): Promise<void>;
}

export type TransportTraceEntry =
  | {
      readonly event: "request";
      readonly call: number;
      readonly at: number;
      readonly method: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      /** Exactly what was handed to the transport, unparsed. Null when the call carried none. */
      readonly body: string | null;
    }
  | {
      readonly event: "response-head";
      readonly call: number;
      readonly at: number;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly hasBody: boolean;
    }
  | {
      readonly event: "response-chunk";
      readonly call: number;
      readonly at: number;
      readonly index: number;
      readonly bytes: number;
      /** The chunk decoded as UTF-8, which is what an SSE frame is. */
      readonly text: string;
    }
  | {
      readonly event: "response-end";
      readonly call: number;
      readonly at: number;
      readonly chunks: number;
      readonly bytes: number;
    }
  | {
      readonly event: "transport-error";
      readonly call: number;
      readonly at: number;
      readonly message: string;
    };

/**
 * Names that carry a credential on some backends. Redacted rather than dropped, so the trace
 * still says a header was sent: an authorization header that never arrived is itself a cause
 * worth being able to see.
 */
const credentialHeaders: ReadonlySet<string> = new Set([
  "authorization",
  "api-key",
  "x-api-key",
  "proxy-authorization",
]);

function headersOf(source: Headers | undefined): Record<string, string> {
  const collected: Record<string, string> = {};
  if (source === undefined) {
    return collected;
  }
  source.forEach((value, name) => {
    collected[name] = credentialHeaders.has(name.toLowerCase()) ? "[redacted]" : value;
  });
  return collected;
}

/** What was sent, as text, without consuming a stream the transport still needs. */
async function bodyText(init: RequestInit | undefined): Promise<string | null> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  // A stream body would have to be teed to be read, and nothing this project sends is one.
  return `[unreadable body: ${Object.prototype.toString.call(body)}]`;
}

interface TracingFetchDependencies {
  readonly inner: typeof globalThis.fetch;
  readonly sink: TransportTraceSink;
  readonly now: () => number;
}

/**
 * Wraps a fetch so every call leaves its raw bodies in the sink. The returned fetch behaves
 * exactly as the one it wraps: same status, same headers, same streaming timing.
 */
export function createTracingFetch(deps: TracingFetchDependencies): typeof globalThis.fetch {
  let calls = 0;

  type FetchInput = Parameters<typeof globalThis.fetch>[0];

  const traced = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    calls += 1;
    const call = calls;
    await deps.sink.write({
      event: "request",
      call,
      at: deps.now(),
      method: init?.method ?? "GET",
      url: typeof input === "string" ? input : input.toString(),
      headers: headersOf(init?.headers === undefined ? undefined : new Headers(init.headers)),
      body: await bodyText(init),
    });

    let response: Response;
    try {
      response = await deps.inner(input, init);
    } catch (cause) {
      await deps.sink.write({
        event: "transport-error",
        call,
        at: deps.now(),
        message: cause instanceof Error ? cause.message : String(cause),
      });
      throw cause;
    }

    await deps.sink.write({
      event: "response-head",
      call,
      at: deps.now(),
      status: response.status,
      statusText: response.statusText,
      headers: headersOf(response.headers),
      hasBody: response.body !== null,
    });

    if (response.body === null) {
      await deps.sink.write({ event: "response-end", call, at: deps.now(), chunks: 0, bytes: 0 });
      return response;
    }

    const [forCaller, forTrace] = response.body.tee();
    void drain(forTrace, call, deps);
    return new Response(forCaller, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return traced as typeof globalThis.fetch;
}

/**
 * Read eagerly and in the background. A tee whose second branch nobody reads buffers the whole
 * response in memory, which would turn a debug flag into a memory leak on a long completion.
 */
async function drain(
  stream: ReadableStream<Uint8Array>,
  call: number,
  deps: TracingFetchDependencies,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let chunks = 0;
  let bytes = 0;

  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) {
        break;
      }
      chunks += 1;
      bytes += step.value.length;
      await deps.sink.write({
        event: "response-chunk",
        call,
        at: deps.now(),
        index: chunks,
        bytes: step.value.length,
        text: decoder.decode(step.value, { stream: true }),
      });
    }
    await deps.sink.write({ event: "response-end", call, at: deps.now(), chunks, bytes });
  } catch (cause) {
    await deps.sink.write({
      event: "transport-error",
      call,
      at: deps.now(),
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    reader.releaseLock();
  }
}
