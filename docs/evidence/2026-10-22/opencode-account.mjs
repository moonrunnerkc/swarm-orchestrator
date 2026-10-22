#!/usr/bin/env node
/**
 * One OpenCode launch's account from its recorded output stream, with no model: steps, tool calls,
 * the time its tools ran (each tool part's own start and end) and the rest of the arm wall, which
 * is model and client time together (OpenCode records no per-request model timing). Tokens are
 * the runner's own reading of the same stream.
 *
 *   node opencode-account.mjs <runner record.json> <blob directory>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [recordPath, blobs] = process.argv.slice(2);
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const invocation = record.invocations[0];
const stream = readFileSync(join(blobs, invocation.stdoutDigest.slice(7)), "utf8")
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line));
const tools = stream.filter((event) => event.type === "tool_use");
const toolMs = tools.reduce(
  (sum, event) => sum + Math.max(0, (event.part?.state?.time?.end ?? 0) - (event.part?.state?.time?.start ?? 0)),
  0,
);
console.log(
  JSON.stringify({
    task: record.task,
    steps: stream.filter((event) => event.type === "step_start").length,
    toolCalls: tools.length,
    wallSeconds: Math.round(invocation.wallMs / 100) / 10,
    toolSeconds: Math.round(toolMs / 100) / 10,
    modelAndClientSeconds: Math.round((invocation.wallMs - toolMs) / 100) / 10,
    tokens: invocation.tokens,
    usage: invocation.usage,
    completion: invocation.completion,
  }),
);
