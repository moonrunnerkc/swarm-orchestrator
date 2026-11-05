// An OpenAI-compatible endpoint for replaying a recorded session: the check author's calls go to
// a live local model, every other call gets the session's next recorded reply, the last repeated.
// Usage: node replay-stub.mjs <replies.json> <port> <author-endpoint> <author-model> <log>
import { appendFileSync, readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";

const post = (url, body) =>
  new Promise((settle, fail) => {
    const outgoing = httpRequest(url, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => settle({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", fail);
    });
    outgoing.on("error", fail);
    outgoing.end(body);
  });

const [file, port, authorEndpoint, authorModel, log] = process.argv.slice(2);
const replies = JSON.parse(readFileSync(file, "utf8"));
let next = 0;
const author = "You write the acceptance checks";
const answer = (content) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 0, completion_tokens: 0 },
});
createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const system = body.messages?.[0]?.content ?? "";
    let out;
    if (system.startsWith(author)) {
      // node:http, not fetch: a long generation outlasts fetch's five-minute header deadline.
      const forwarded = await post(`${authorEndpoint}/chat/completions`, JSON.stringify({ ...body, model: authorModel }));
      out = forwarded.text;
      appendFileSync(log, `author ${forwarded.status}\n`);
    } else {
      const reply = replies[Math.min(next, replies.length - 1)] ?? "";
      appendFileSync(log, `loop ${next + 1} of ${replies.length}\n`);
      next += 1;
      out = JSON.stringify(answer(reply));
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(out);
    } catch (error) {
      appendFileSync(log, `error ${error instanceof Error ? error.message : String(error)}\n`);
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
})
  .on("error", (error) => {
    appendFileSync(log, `server error ${error.message}\n`);
    process.exit(1);
  })
  .listen(Number(port), "127.0.0.1", () => appendFileSync(log, `listening ${port}\n`));
