import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startForwarder, upstreamHeaders } from "./forwarder.mjs";

const servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((settle) => server.close(settle));
  }
});

function listen(server) {
  servers.push(server);
  return new Promise((settle) => server.listen(0, "127.0.0.1", () => settle(server.address().port)));
}

describe("the headers the backend sees", () => {
  it("are the caller's, with Host naming the backend's own loopback", () => {
    expect(upstreamHeaders({ host: "campaign-backend-11434:11434", "content-type": "application/json" }, 11434)).toEqual({
      host: "127.0.0.1:11434",
      "content-type": "application/json",
    });
  });
});

describe("the relay", () => {
  it("hands the request on with the loopback as Host and streams the answer back", async () => {
    const seen = [];
    const upstreamPort = await listen(
      createServer((incoming, outgoing) => {
        let body = "";
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.on("end", () => {
          seen.push({ host: incoming.headers.host, method: incoming.method, url: incoming.url, body });
          outgoing.writeHead(200, { "content-type": "text/event-stream" });
          outgoing.write("data: one\n\n");
          setTimeout(() => {
            outgoing.write("data: two\n\n");
            outgoing.end();
          }, 20);
        });
      }),
    );
    const forwarder = await startForwarder({ port: upstreamPort, upstreamHost: "127.0.0.1", listenPort: 0 });
    servers.push(forwarder);

    const answer = await fetch(`http://127.0.0.1:${forwarder.address().port}/v1/chat/completions`, {
      method: "POST",
      headers: { host: "campaign-backend-11434:11434", "content-type": "application/json" },
      body: '{"model":"x"}',
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("text/event-stream");
    expect(await answer.text()).toBe("data: one\n\ndata: two\n\n");
    expect(seen).toEqual([{ host: `127.0.0.1:${upstreamPort}`, method: "POST", url: "/v1/chat/completions", body: '{"model":"x"}' }]);
  });

  it("answers 502 and says so where the backend is not there", async () => {
    const forwarder = await startForwarder({ port: 1, upstreamHost: "127.0.0.1", listenPort: 0 });
    servers.push(forwarder);

    const answer = await fetch(`http://127.0.0.1:${forwarder.address().port}/v1/models`);

    expect(answer.status).toBe(502);
    expect(await answer.text()).toContain("could not reach 127.0.0.1:1");
  });
});
