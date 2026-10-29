import { describe, expect, it } from "vitest";
import { ModelError, openAiCompatible } from "./model.ts";

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the chat client", () => {
  it("returns the content without a reasoning preamble, and the tokens reported", async () => {
    const sent: unknown[] = [];
    const client = openAiCompatible({
      endpoint: "http://model.test/v1/",
      model: "m",
      apiKey: "k",
      fetch: async (url, init) => {
        sent.push([url, JSON.parse(String(init?.body))]);
        return answer({
          choices: [{ message: { content: "<think>hmm</think>\n```bash\nls\n```" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      },
    });
    const reply = await client.complete([{ role: "user", content: "go" }]);
    expect(reply).toEqual({ content: "```bash\nls\n```", tokens: 15 });
    expect(sent[0]).toEqual([
      "http://model.test/v1/chat/completions",
      { model: "m", messages: [{ role: "user", content: "go" }], temperature: 0, stream: false },
    ]);
  });

  it("reports no tokens where the endpoint reports no usage", async () => {
    const client = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      fetch: async () => answer({ choices: [{ message: { content: "x" } }] }),
    });
    expect((await client.complete([])).tokens).toBeNull();
  });

  it("retries a server error and fails plainly on a client error", async () => {
    let calls = 0;
    const flaky = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? answer({}, 503)
          : answer({ choices: [{ message: { content: "ok" } }] });
      },
    });
    expect((await flaky.complete([])).content).toBe("ok");
    const refused = openAiCompatible({
      endpoint: "http://model.test/v1",
      model: "m",
      apiKey: null,
      fetch: async () => answer({ error: "no such model" }, 404),
    });
    await expect(refused.complete([])).rejects.toThrow(ModelError);
  });
});
