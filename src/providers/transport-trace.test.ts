import { describe, expect, it } from "vitest";
import { createTracingFetch, type TransportTraceEntry } from "./transport-trace.ts";

function collectingSink(): {
  entries: TransportTraceEntry[];
  write: (e: TransportTraceEntry) => Promise<void>;
} {
  const entries: TransportTraceEntry[] = [];
  return {
    entries,
    write(entry) {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

function streamOf(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

/** What the sink saw, in order, so a test can assert on the shape of a whole call. */
function events(entries: readonly TransportTraceEntry[]): readonly string[] {
  return entries.map((entry) => entry.event);
}

async function settle(): Promise<void> {
  await new Promise((resume) => setTimeout(resume, 0));
}

describe("tracing a local call", () => {
  it("records the request body exactly as it was handed to the transport", async () => {
    const sink = collectingSink();
    const body = JSON.stringify({ model: "qwen3.6:35b-a3b", seed: 522856934, temperature: 0.7 });
    const traced = createTracingFetch({
      inner: () => Promise.resolve(new Response(streamOf(["data: [DONE]\n\n"]))),
      sink,
      now: () => 1,
    });

    await traced("http://127.0.0.1:11434/v1/chat/completions", { method: "POST", body });

    const request = sink.entries.find((entry) => entry.event === "request");
    expect(request).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:11434/v1/chat/completions",
      body,
    });
  });

  it("redacts a credential header and keeps the fact that one was sent", async () => {
    const sink = collectingSink();
    const traced = createTracingFetch({
      inner: () => Promise.resolve(new Response(null, { status: 204 })),
      sink,
      now: () => 1,
    });

    await traced("http://127.0.0.1:8000/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sk-live-not-a-real-key",
        "content-type": "application/json",
      },
    });

    const request = sink.entries.find((entry) => entry.event === "request");
    expect(request?.event === "request" && request.headers).toMatchObject({
      authorization: "[redacted]",
      "content-type": "application/json",
    });
  });

  it("records every response frame before anything parses it", async () => {
    const sink = collectingSink();
    const frames = ['data: {"choices":[{"delta":{"content":"he"}}]}\n\n', "data: [DONE]\n\n"];
    const traced = createTracingFetch({
      inner: () => Promise.resolve(new Response(streamOf(frames))),
      sink,
      now: () => 1,
    });

    const response = await traced("http://127.0.0.1:11434/v1/chat/completions", { method: "POST" });
    expect(await response.text()).toBe(frames.join(""));
    await settle();

    const chunks = sink.entries.filter((entry) => entry.event === "response-chunk");
    expect(chunks.map((chunk) => (chunk.event === "response-chunk" ? chunk.text : ""))).toEqual(
      frames,
    );
    expect(events(sink.entries)).toEqual([
      "request",
      "response-head",
      "response-chunk",
      "response-chunk",
      "response-end",
    ]);
  });

  it("shows an empty body as an empty body, which is the whole point of the trace", async () => {
    // The shape the 2026-08-24 calibration hit: a 200 whose stream carried no frame at all,
    // which reaches the loop indistinguishable from a model that chose to say nothing.
    const sink = collectingSink();
    const traced = createTracingFetch({
      inner: () => Promise.resolve(new Response(streamOf([]))),
      sink,
      now: () => 1,
    });

    await (await traced("http://127.0.0.1:11434/v1/chat/completions", { method: "POST" })).text();
    await settle();

    const end = sink.entries.find((entry) => entry.event === "response-end");
    expect(end).toMatchObject({ chunks: 0, bytes: 0 });
  });

  it("hands the caller the same status and headers it was given", async () => {
    const sink = collectingSink();
    const traced = createTracingFetch({
      inner: () =>
        Promise.resolve(
          new Response(streamOf(["nope"]), {
            status: 400,
            statusText: "Bad Request",
            headers: { "content-type": "application/json" },
          }),
        ),
      sink,
      now: () => 1,
    });

    const response = await traced("http://127.0.0.1:11434/v1/chat/completions", { method: "POST" });

    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe("nope");
  });

  it("records a transport failure and still raises it", async () => {
    const sink = collectingSink();
    const traced = createTracingFetch({
      inner: () => Promise.reject(new Error("terminated")),
      sink,
      now: () => 1,
    });

    await expect(traced("http://127.0.0.1:11434/v1/chat/completions")).rejects.toThrow(
      "terminated",
    );
    expect(sink.entries.at(-1)).toMatchObject({ event: "transport-error", message: "terminated" });
  });
});
