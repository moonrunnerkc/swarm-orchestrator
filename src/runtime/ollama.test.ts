import { describe, expect, it } from "vitest";
import type { Post } from "../agent/model.ts";
import { ollamaChat } from "./ollama.ts";

const turn = { maxTokens: 100 };
const hangUp = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
const refused = () => Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
const answered = {
  status: 200,
  text: JSON.stringify({
    message: { content: "```bash\nls\n```" },
    prompt_eval_count: 10,
    eval_count: 5,
    done_reason: "stop",
  }),
};

function client(outcomes: readonly (Error | typeof answered)[]) {
  let calls = 0;
  const post: Post = async () => {
    const next = outcomes[calls] ?? outcomes.at(-1);
    calls += 1;
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("no outcome scripted");
    return next;
  };
  const chat = ollamaChat({
    base: "http://localhost:11434",
    model: "q",
    contextTokens: 8192,
    post,
  });
  return { chat, calls: () => calls };
}

describe("Ollama's native chat", () => {
  it("sends a turn again after the connection dropped mid-turn, and counts the retry", async () => {
    const { chat, calls } = client([hangUp(), answered]);
    const reply = await chat.complete([{ role: "user", content: "go" }], turn);
    expect(reply).toMatchObject({ content: "```bash\nls\n```", retries: 1 });
    expect(calls()).toBe(2);
  });

  it("says how to start Ollama when it went away during a turn", async () => {
    const { chat, calls } = client([hangUp(), refused()]);
    await expect(chat.complete([], turn)).rejects.toThrow(
      "Ollama is not answering at http://localhost:11434: start it with `ollama serve` (or open the Ollama app), then run again",
    );
    expect(calls()).toBe(2);
    const again = client([hangUp(), refused()]);
    await expect(again.chat.complete([], turn)).rejects.toMatchObject({ retries: 1 });
  });

  it("stops on the third dropped connection in a row with the step to take", async () => {
    const { chat, calls } = client([hangUp()]);
    await expect(chat.complete([], turn)).rejects.toThrow(
      "Ollama dropped the connection at http://localhost:11434 (socket hang up, three attempts in a row): check that `ollama serve` is running and that q loads (`ollama run q`), then run again",
    );
    expect(calls()).toBe(3);
  });

  it("stops the run on a reply that is not JSON instead of crashing it", async () => {
    const { chat } = client([{ status: 200, text: "<html>proxy error</html>" }]);
    await expect(chat.complete([], turn)).rejects.toThrow(
      "the reply is not an Ollama chat response: <html>proxy error</html>",
    );
    await expect(chat.complete([], turn)).rejects.toMatchObject({ name: "ModelError" });
  });
});
