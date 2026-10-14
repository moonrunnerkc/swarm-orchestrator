/**
 * A disposable stand-in for the model endpoint, for the stop-control tests: it answers
 * `GET /v1/models` with one listed model and nothing else, so a runner can probe it, find the
 * process listening on its port, and watch that process disappear or be replaced. It never
 * generates; a test that needs a generation uses the real server. Usage:
 *
 *   node endpoint-server.mjs <ready-file> [model] [port]
 *
 * When listening it writes `{ port, pid }` to the ready file. Port 0 (the default) asks the
 * operating system for a free one.
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [readyFile, model = "fixture-model", port = "0"] = process.argv.slice(2);
const server = createServer((request, response) => {
  if (request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model" }] }));
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(Number(port), "127.0.0.1", () => {
  writeFileSync(readyFile, JSON.stringify({ port: server.address().port, pid: process.pid }));
});
