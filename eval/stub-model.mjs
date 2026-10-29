import { createServer } from "node:http";

/** The one reply the stub gives to every request: a fixed, harmless command. */
export const stubReply = "```bash\nls\n```";

/**
 * An OpenAI-compatible chat endpoint that always answers with the same command, so the harness
 * can run end to end with no model. Nothing it produces is a model result.
 */
export function startStubModel(port = 0) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const json = (status, value) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.method === "GET" && request.url?.endsWith("/models")) {
        return json(200, { object: "list", data: [{ id: "stub", object: "model" }] });
      }
      if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
        return json(404, { error: { message: `no route ${request.method} ${request.url}` } });
      }
      const promptTokens = Math.ceil(body.length / 4);
      const usage = {
        prompt_tokens: promptTokens,
        completion_tokens: 4,
        total_tokens: promptTokens + 4,
      };
      const message = { role: "assistant", content: stubReply };
      let streamed = false;
      try {
        streamed = JSON.parse(body).stream === true;
      } catch {
        // An unreadable body still gets the one answer.
      }
      if (!streamed) {
        return json(200, {
          id: "stub",
          object: "chat.completion",
          model: "stub",
          choices: [{ index: 0, finish_reason: "stop", message }],
          usage,
        });
      }
      // Clients that stream read server-sent chunks and need a finish reason to stop.
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (choice, extra = {}) =>
        response.write(
          `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", model: "stub", choices: [choice], ...extra })}\n\n`,
        );
      chunk({ index: 0, delta: message, finish_reason: null });
      chunk({ index: 0, delta: {}, finish_reason: "stop" }, { usage });
      response.end("data: [DONE]\n\n");
    });
  });
  return new Promise((settle) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      settle({ port: address.port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}
