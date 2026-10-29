#!/usr/bin/env node
// A Model Context Protocol server over stdio with one tool, verify, which runs this package's
// own `swarm-verify verify --json` and returns its predicate. It implements nothing of the
// verifier: a client gets exactly what the command line would print, and nothing else.
//
//   node mcp.mjs            (an MCP client starts it; messages are newline-delimited JSON-RPC)

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./dist/swarm-verify.js", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const tool = {
  name: "verify",
  description:
    "Rerun the repository's declared checks on a change in a clean checkout of its base, run its held-out checks, and sign the verdict. Returns the predicate: verdict, reasons, every check, the base run, held-out results, protected paths, coverage, mutation and what was not measured.",
  inputSchema: {
    type: "object",
    properties: {
      workspace: {
        type: "string",
        description: "The repository; the server's directory if left out.",
      },
      base: { type: "string", description: "The base ref; HEAD if left out." },
      patch: { type: "string", description: "A patch file to verify instead of the working tree." },
      range: {
        type: "string",
        description: "A ref range such as main..feature to verify instead.",
      },
    },
    additionalProperties: false,
  },
};

function runVerify(input) {
  const args = [cli, "verify", "--json"];
  for (const name of ["workspace", "base", "patch", "range"]) {
    if (typeof input[name] === "string") args.push(`--${name}`, input[name]);
  }
  return new Promise((settle) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

async function callTool(params) {
  if (params?.name !== tool.name)
    throw Object.assign(new Error(`no tool named ${params?.name}`), { code: -32602 });
  const ran = await runVerify(params.arguments ?? {});
  let printed = null;
  try {
    printed = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    // No verdict came back: reported below as a tool error with what the command printed.
  }
  if (printed === null) {
    const text = `swarm-verify exited ${ran.code} without a verdict:\n${`${ran.stderr}${ran.stdout}`.trim()}`;
    return { content: [{ type: "text", text }], isError: true };
  }
  const summary = `verdict ${printed.verdict}; attestation ${printed.bundle}`;
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(printed.predicate) },
    ],
    structuredContent: printed.predicate,
    isError: false,
  };
}

const handlers = {
  initialize: async (params) => ({
    protocolVersion: params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "swarm-verify", version },
  }),
  ping: async () => ({}),
  "tools/list": async () => ({ tools: [tool] }),
  "tools/call": callTool,
};

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (line.trim() === "") return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "the line is not JSON" } });
    return;
  }
  // A notification gets no answer.
  if (message.id === undefined) return;
  const handler = handlers[message.method];
  if (handler === undefined) {
    send({ id: message.id, error: { code: -32601, message: `no method ${message.method}` } });
    return;
  }
  try {
    send({ id: message.id, result: await handler(message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
