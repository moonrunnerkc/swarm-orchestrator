#!/usr/bin/env node
/**
 * The forwarder a local arm reaches its backend through: an HTTP relay on the internal
 * network that hands every request to the backend on the host and streams the answer back.
 * It rewrites one header. Ollama refuses a request whose Host names anything but the
 * loopback it listens on, and a TCP relay carries the container's name in that header, so
 * the relay names the loopback instead; rapid-mlx does not check and is unaffected. Nothing
 * else about the request or the response is read or changed, and bodies are streamed both
 * ways, since the backend's answer is a stream the client times.
 *
 *   node forwarder.mjs <port> <upstream host>
 *
 * Plain node, node: builtins only, so it runs from the campaign image with nothing added.
 */
import { createServer, request as httpRequest } from "node:http";

/** The headers the backend sees: the caller's, with Host naming the backend's own loopback. */
export function upstreamHeaders(headers, port) {
  return { ...headers, host: `127.0.0.1:${port}` };
}

export function startForwarder({ port, upstreamHost, listenPort = port, log = () => {} }) {
  const server = createServer((incoming, outgoing) => {
    const relayed = httpRequest(
      {
        host: upstreamHost,
        port,
        method: incoming.method,
        path: incoming.url,
        headers: upstreamHeaders(incoming.headers, port),
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    relayed.on("error", (cause) => {
      log(`relay to ${upstreamHost}:${port} failed: ${cause.message}`);
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { "content-type": "text/plain" });
      }
      outgoing.end(`the forwarder could not reach ${upstreamHost}:${port}: ${cause.message}\n`);
    });
    incoming.pipe(relayed);
  });
  return new Promise((settle, reject) => {
    server.on("error", reject);
    server.listen(listenPort, "0.0.0.0", () => {
      log(`forwarding :${server.address().port} to ${upstreamHost}:${port}`);
      settle(server);
    });
  });
}

if (import.meta.filename === process.argv[1]) {
  const port = Number(process.argv[2]);
  const upstreamHost = process.argv[3];
  if (!Number.isInteger(port) || upstreamHost === undefined) {
    console.error("usage: node forwarder.mjs <port> <upstream host>");
    process.exit(2);
  }
  startForwarder({ port, upstreamHost, log: (line) => console.log(line) }).catch((cause) => {
    console.error(cause.message);
    process.exit(1);
  });
}
