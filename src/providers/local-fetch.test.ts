import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalFetch } from "./local-fetch.ts";

/** Headers straight away, then silence, then the rest: what a buffered tool call looks like. */
let server: Server;
let url = "";
const silenceMs = 1_500;

beforeEach(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: {}\n\n");
    setTimeout(() => {
      response.write("data: [DONE]\n\n");
      response.end();
    }, silenceMs);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterEach(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
});

async function readAll(response: { body: unknown }): Promise<number> {
  let bytes = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    bytes += chunk.length;
  }
  return bytes;
}

describe("a body that goes quiet while the model writes", () => {
  it("gives up when a body timeout is in force, which is what killed a run", async () => {
    // Node's own fetch carries a five minute one. A tool call parser emits nothing until the
    // call is complete, so at around 17 tokens a second a long file write outlives it, and the
    // run died with "terminated, caused by Body Timeout Error, caused by UND_ERR_BODY_TIMEOUT".
    const impatient = new Agent({ bodyTimeout: silenceMs / 3 });

    await expect(
      undiciFetch(url, { method: "POST", body: "{}", dispatcher: impatient }).then(readAll),
    ).rejects.toThrow(/terminated|timeout/i);
  });

  it("waits, because a local endpoint going quiet is it working", async () => {
    const response = await createLocalFetch()(url, { method: "POST", body: "{}" });

    expect(await readAll(response)).toBeGreaterThan(0);
  });
});
