import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTraceSink } from "./transport-trace-file.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-trace-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the trace artifact", () => {
  it("writes one JSON object per line, in the order the calls happened", async () => {
    const path = join(root, "nested", "trace.jsonl");
    const sink = createFileTraceSink(path);

    await sink.write({
      event: "request",
      call: 1,
      at: 10,
      method: "POST",
      url: "http://127.0.0.1:11434/v1/chat/completions",
      headers: {},
      body: '{"seed":1}',
    });
    await sink.write({ event: "response-end", call: 1, at: 20, chunks: 0, bytes: 0 });

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["request", "response-end"]);
    expect(JSON.parse(lines[0] ?? "").body).toBe('{"seed":1}');
  });

  it("keeps every line whole when writes are not awaited one at a time", async () => {
    const path = join(root, "trace.jsonl");
    const sink = createFileTraceSink(path);

    await Promise.all(
      Array.from({ length: 40 }, (_unused, index) =>
        sink.write({
          event: "response-chunk",
          call: 1,
          at: index,
          index,
          bytes: 4,
          text: "data",
        }),
      ),
    );

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(40);
    expect(() => lines.map((line) => JSON.parse(line))).not.toThrow();
  });

  it("does not take the run down when the artifact cannot be written", async () => {
    // The path is a directory, so every append fails. Instrumentation failing is not the
    // model call failing, and a debug flag must not be able to end a run.
    const sink = createFileTraceSink(root);

    await expect(
      sink.write({ event: "response-end", call: 1, at: 1, chunks: 0, bytes: 0 }),
    ).resolves.toBeUndefined();
  });
});
