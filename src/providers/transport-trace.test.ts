import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "../evidence/canonical-json.ts";
import { createTracingFetch, createTransportTraceFile } from "./transport-trace.ts";

const sseBody = [
  'data: {"choices":[{"delta":{"content":"he"}}]}',
  'data: {"choices":[{"delta":{"content":"llo"}}]}',
  "data: [DONE]",
  "",
].join("\n");

function streaming(body: string, status = 200): Response {
  const encoder = new TextEncoder();
  const chunks = body.split("\n").map((line) => encoder.encode(`${line}\n`));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

async function drain(response: Response): Promise<string> {
  return await response.text();
}

describe("the raw bytes of a local exchange", () => {
  it("writes the request body as it was sent, before anything parses it", async () => {
    const written: JsonValue[] = [];
    const fetch = createTracingFetch(
      async () => streaming(sseBody),
      (entry) => {
        written.push(entry);
      },
    );

    await drain(
      await fetch("http://127.0.0.1:8000/v1/chat/completions", {
        method: "POST",
        body: '{"model":"qwen","messages":[]}',
      }),
    );

    const request = written.find(
      (entry) => (entry as { phase?: unknown }).phase === "request",
    ) as Record<string, JsonValue>;
    expect(request.body).toBe('{"model":"qwen","messages":[]}');
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://127.0.0.1:8000/v1/chat/completions");
  });

  it("writes the response body as it arrived, and hands the same bytes on unchanged", async () => {
    const written: JsonValue[] = [];
    const fetch = createTracingFetch(
      async () => streaming(sseBody),
      (entry) => {
        written.push(entry);
      },
    );

    const seen = await drain(await fetch("http://127.0.0.1:8000/", { method: "POST", body: "{}" }));

    const response = written.find(
      (entry) => (entry as { phase?: unknown }).phase === "response",
    ) as Record<string, JsonValue>;
    expect(response.body).toBe(seen);
    expect(response.body).toContain('"content":"llo"');
    expect(response.status).toBe(200);
  });

  it("records an empty completion, which is the case it exists for", async () => {
    const written: JsonValue[] = [];
    const empty = ['data: {"choices":[{"delta":{}}]}', "data: [DONE]", ""].join("\n");
    const fetch = createTracingFetch(
      async () => streaming(empty),
      (entry) => {
        written.push(entry);
      },
    );

    await drain(await fetch("http://127.0.0.1:8000/", { method: "POST", body: "{}" }));

    const response = written.find(
      (entry) => (entry as { phase?: unknown }).phase === "response",
    ) as Record<string, JsonValue>;
    expect(response.body).toContain('"delta":{}');
  });

  it("redacts a credential in a header rather than making the trace the one place it is legible", async () => {
    const written: JsonValue[] = [];
    const fetch = createTracingFetch(
      async () => streaming(sseBody),
      (entry) => {
        written.push(entry);
      },
    );

    await drain(
      await fetch("http://127.0.0.1:8000/", {
        method: "POST",
        body: "{}",
        headers: { authorization: "Bearer sk-live-9f2c4a7d1e" },
      }),
    );

    const request = written.find(
      (entry) => (entry as { phase?: unknown }).phase === "request",
    ) as Record<string, JsonValue>;
    expect(JSON.stringify(request)).not.toContain("sk-live-9f2c4a7d1e");
  });

  it("records a transport failure rather than losing the exchange with it", async () => {
    const written: JsonValue[] = [];
    const fetch = createTracingFetch(
      () => Promise.reject(new Error("terminated")),
      (entry) => {
        written.push(entry);
      },
    );

    await expect(fetch("http://127.0.0.1:8000/", { method: "POST", body: "{}" })).rejects.toThrow(
      "terminated",
    );
    expect(written.map((entry) => (entry as { phase?: unknown }).phase)).toEqual([
      "request",
      "transport-error",
    ]);
  });

  it("numbers exchanges in call order, so a request and its response can be paired", async () => {
    const written: JsonValue[] = [];
    const fetch = createTracingFetch(
      async () => streaming(sseBody),
      (entry) => {
        written.push(entry);
      },
    );

    await drain(await fetch("http://127.0.0.1:8000/", { method: "POST", body: "a" }));
    await drain(await fetch("http://127.0.0.1:8000/", { method: "POST", body: "b" }));

    expect(written.map((entry) => (entry as { exchange?: unknown }).exchange)).toEqual([
      1, 1, 2, 2,
    ]);
  });
});

describe("the trace artifact", () => {
  it("appends one JSON object per line, in order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "swarm-trace-"));
    const path = join(directory, "wire.jsonl");
    const write = createTransportTraceFile(path);

    write({ exchange: 1, phase: "request" });
    write({ exchange: 1, phase: "response" });
    // The writer queues rather than awaiting, so the file is read after the queue drains.
    await new Promise((settled) => setTimeout(settled, 50));

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).phase)).toEqual(["request", "response"]);
  });
});
