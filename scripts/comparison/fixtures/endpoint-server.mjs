/**
 * A disposable stand-in for the model endpoint, for the stop-control and readiness tests. It
 * answers `GET /v1/models` with one listed model, so a runner can probe it, find the process
 * listening on its port, and watch that process disappear or be replaced; and it answers
 * `POST /v1/chat/completions` the way its behaviour says, so the runner's inference probe and an
 * arm's own request meet a server that is healthy, slow, half-working, malformed or wedged. It
 * never generates: every answer is scripted. Usage:
 *
 *   node endpoint-server.mjs <ready-file> [model] [port] [behaviour] [request-log]
 *
 * When listening it writes `{ port, pid }` to the ready file. Port 0 (the default) asks the
 * operating system for a free one. Every request is appended to the request log, one JSON line
 * `{ at, method, path, kind }`, where `kind` reads the chat body: `chat`, `tool-call` or
 * `tool-result`; a test reads it to see which requests reached the server and when.
 *
 * Behaviours (`listing-only` is the default and the server's old shape):
 *
 * - `listing-only`: chat is 404; only the model listing answers;
 * - `chat-never`: chat requests are accepted and never answered (the socket stays open);
 * - `plain-only`: a plain chat answers with text; a request carrying tools answers with text
 *   and no tool call, the shape of a server whose tool path does not work;
 * - `healthy`: the complete round trip: text, a well-formed call of the requested tool, text;
 * - `cut`: the stream starts and ends before its terminator;
 * - `slow:<ms>`: `healthy`, holding each answer for that long before its first byte;
 * - `wedge-after:<n>`: `healthy` for the first n chat requests, then `chat-never` for the rest,
 *   while the listing keeps answering: a server that stops completing inference mid-launch.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [readyFile, model = "fixture-model", port = "0", behaviour = "listing-only", requestLog] =
  process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const kindOf = (body) =>
  body.tools === undefined
    ? "chat"
    : body.messages?.some((one) => one.role === "tool")
      ? "tool-result"
      : "tool-call";

const chunk = (choice, extra = {}) =>
  `data: ${JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion.chunk", model, choices: choice === null ? [] : [choice], ...extra })}\n\n`;
const usage = { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 };

/** The streamed answer for a request of the kind, by behaviour; null means never answer. */
function answerFor(kind, body, mode) {
  if (mode === "chat-never") return null;
  const text = (words) =>
    [
      chunk({ index: 0, delta: { role: "assistant", content: words }, finish_reason: null }),
      chunk({ index: 0, delta: {}, finish_reason: "stop" }),
      chunk(null, { usage }),
      "data: [DONE]\n\n",
    ].join("");
  if (mode === "cut")
    return chunk({ index: 0, delta: { role: "assistant", content: "rea" }, finish_reason: null });
  if (kind === "tool-call" && mode !== "plain-only") {
    const tool = body.tools[0].function.name;
    return [
      chunk({
        index: 0,
        delta: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: "call_fixture_1",
              type: "function",
              function: { name: tool, arguments: JSON.stringify({ word: "ready" }) },
            },
          ],
        },
        finish_reason: null,
      }),
      chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }),
      chunk(null, { usage }),
      "data: [DONE]\n\n",
    ].join("");
  }
  if (kind === "tool-call") return text("I would call the tool now.");
  return text(kind === "tool-result" ? "done" : "ready");
}

let chatRequests = 0;
const server = createServer((request, response) => {
  const log = (kind) => {
    if (requestLog)
      appendFileSync(
        requestLog,
        `${JSON.stringify({ at: Date.now(), method: request.method, path: request.url, kind })}\n`,
      );
  };
  if (request.method === "GET" && request.url === "/v1/models") {
    log("models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model" }] }));
    return;
  }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    const parts = [];
    request.on("data", (part) => parts.push(part));
    request.on("end", async () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(parts).toString());
      } catch {}
      const kind = kindOf(body);
      log(kind);
      chatRequests += 1;
      if (behaviour === "listing-only") {
        response.writeHead(404);
        response.end();
        return;
      }
      let mode = behaviour;
      let delay = 0;
      if (behaviour.startsWith("slow:")) {
        mode = "healthy";
        delay = Number(behaviour.slice(5));
      } else if (behaviour.startsWith("wedge-after:")) {
        mode = chatRequests <= Number(behaviour.slice(12)) ? "healthy" : "chat-never";
      }
      const answer = answerFor(kind, body, mode);
      if (answer === null) return;
      await sleep(delay);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.end(answer);
    });
    return;
  }
  log("other");
  response.writeHead(404);
  response.end();
});
server.listen(Number(port), "127.0.0.1", () => {
  writeFileSync(readyFile, JSON.stringify({ port: server.address().port, pid: process.pid }));
});
