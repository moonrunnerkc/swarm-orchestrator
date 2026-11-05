// Serves a recorded session's replies in order and keeps every request body it is sent, so the
// prompts two versions of the loop build from the same replies can be compared and replayed.
// The check author's calls (17.0.0 only) are answered with a kind and no check.
// Usage: node capture-stub.mjs <replies.json> <port> <bodies.jsonl>
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const [file, port, bodies] = process.argv.slice(2);
const replies = JSON.parse(readFileSync(file, "utf8"));
let next = 0;
createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const send = (value) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url?.endsWith("/models")) return send({ data: [{ id: "replay" }] });
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const author = (body.messages?.[0]?.content ?? "").startsWith("You write the acceptance checks");
    if (!author) appendFileSync(bodies, `${JSON.stringify(body.messages)}\n`);
    const content = author ? "kind: other" : (replies[Math.min(next++, replies.length - 1)] ?? "");
    send({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0 } });
  });
}).listen(Number(port), "127.0.0.1", () => appendFileSync(`${bodies}.ready`, "listening\n"));
