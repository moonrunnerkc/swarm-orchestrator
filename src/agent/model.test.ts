import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ModelError, openAiCompatible } from "./model.ts";

const answer = async (body: unknown, status = 200) => ({ status, text: JSON.stringify(body) });
const turn = { maxTokens: 100 };

describe("the chat client", () => {
  it("speaks plain HTTP to a real server, answered only when generation ends", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () =>
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ choices: [{ message: { content: "done" } }] }));
        }, 50),
      );
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const { port } = server.address() as AddressInfo;
    const client = openAiCompatible({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: "m",
      apiKey: null,
    });
    expect((await client.complete([{ role: "user", content: "go" }], turn)).content).toBe("done");
    server.close();
  });

  it("returns the content without a reasoning preamble, and the tokens reported", async () => {
    const sent: unknown[] = [];
    const client = openAiCompatible({
      endpoint: "http://model.test/v1/",
      model: "m",
      apiKey: "k",
      post: async (url, _headers, body) => {
        sent.push([url, JSON.parse(body)]);
        return answer({
          choices: [{ message: { content: "<think>hmm</think>\n```bash\nls\n```" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      },
    });
    const reply = await client.complete([{ role: "user", content: "go" }], turn);
    expect(reply).toEqual({ content: "```bash\nls\n```", tokens: 15, truncated: false });
    expect(sent[0]).toEqual([
      "http://model.test/v1/chat/completions",
      {
        model: "m",
        messages: [{ role: "user", content: "go" }],
        temperature: 0,
        stream: false,
        max_tokens: 100,
      },
    ]);
  });

  it("reports no tokens where the endpoint reports no usage", async () => {
    const client = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      post: async () => answer({ choices: [{ message: { content: "x" } }] }),
    });
    expect((await client.complete([], turn)).tokens).toBeNull();
  });

  it("retries a server error and fails plainly on a client error", async () => {
    let calls = 0;
    const flaky = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      post: async () => {
        calls += 1;
        return calls === 1
          ? answer({}, 503)
          : answer({ choices: [{ message: { content: "ok" } }] });
      },
    });
    expect((await flaky.complete([], turn)).content).toBe("ok");
    const refused = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      post: async () => answer({ error: "no such model" }, 404),
    });
    await expect(refused.complete([], turn)).rejects.toThrow(ModelError);
  });

  it("fails at once on a refused connection, and on the third server error in a row", async () => {
    const failing = (problem: () => Promise<{ status: number; text: string }>) => {
      let calls = 0;
      const client = openAiCompatible({
        endpoint: "http://model.test/v1",
        model: "m",
        apiKey: null,
        post: () => {
          calls += 1;
          return problem();
        },
      });
      return { client, calls: () => calls };
    };
    const refused = failing(async () => {
      throw Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
    });
    await expect(refused.client.complete([], turn)).rejects.toThrow(/connection refused at/);
    expect(refused.calls()).toBe(1);
    const down = failing(() => answer({}, 502));
    await expect(down.client.complete([], turn)).rejects.toThrow(/three attempts in a row/);
    expect(down.calls()).toBe(3);
  });

  it("waits out rate limiting instead of failing, and flags a reply cut off at the cap", async () => {
    const waited: number[] = [];
    let calls = 0;
    const client = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      sleep: async (ms) => {
        waited.push(ms);
      },
      post: async () => {
        calls += 1;
        return calls <= 4
          ? answer({}, 429)
          : answer({ choices: [{ message: { content: "```bash\nls" }, finish_reason: "length" }] });
      },
    });
    expect(await client.complete([], turn)).toMatchObject({ truncated: true });
    expect(waited).toEqual([2000, 4000, 8000, 16000]);
  });
});
