#!/usr/bin/env node
/**
 * How much of one verbose command reaches the model's later requests, measured through a build's
 * own chokepoint, ledger and loop (compaction included), with no model: C1's recorded `npm test`
 * output (113,537 characters, call_dvr6ym76) is returned by a stand-in shell, and a scripted model
 * then makes six more small calls, as C1's worker did before the output left its window.
 *
 *   node context-size.mjs <source checkout> <restored comparison/sessions> > result.json
 *
 * Run once on the build before the bounded view and once on the build with it. Token counts are the
 * loop's own estimate (four characters to a token); C1's server counted the real ones, and those
 * are in c1-timeline.json. Nothing here measures speed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [sourceRoot, sessions] = process.argv.slice(2);
const src = resolve(sourceRoot, "src");
const { z } = await import(resolve(sourceRoot, "node_modules/zod/index.js"));
const { createToolChokepoint } = await import(`${src}/tools/chokepoint.ts`);
const { createLedgerChokepointRecorder } = await import(`${src}/tools/chokepoint-record.ts`);
const { createPolicyGuard } = await import(`${src}/tools/policy-guard.ts`);
const { defineTool } = await import(`${src}/tools/tool-definition.ts`);
const { openEvidenceSession } = await import(`${src}/evidence/session.ts`);
const { runAgentLoop } = await import(`${src}/core/loop.ts`);
const { estimateTokens } = await import(`${src}/core/compaction.ts`);

// The recorded output and facts, read from C1's own chain.
const name = "20261019T155523-5be681";
const ledger = readFileSync(join(sessions, `${name}.ledger.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const recorded = ledger
  .filter((record) => record.type === "tool-call")
  .map((record) => JSON.parse(readFileSync(join(sessions, `${name}.blobs`, `${record.payloadDigest.slice(7)}.json`), "utf8")))
  .find((payload) => payload.callId === "call_dvr6ym76" && payload.decision === "allowed");

const root = await mkdtemp(join(tmpdir(), "context-size-"));
const clock = { now: () => 1_792_425_000_000, sleep: () => Promise.resolve() };
const evidence = await openEvidenceSession({ root, sessionId: "measure", clock });
const guard = createPolicyGuard({ workspaceRoot: "/work/repo", homeDir: "/home/dev", shellAllowlist: ["npm", "git"], deniedRoots: [], realpath: (path) => path });
const shell = defineTool({
  name: "shell",
  description: "replays C1's recorded npm test output",
  inputSchema: z.object({ command: z.string() }),
  kind: "shell",
  pathsFrom: () => [],
  execute: (input) => Promise.resolve(input.command === "npm test 2>&1" ? { text: recorded.output, facts: recorded.facts } : { text: "exit code: 0\nstdout:\nok", facts: { exitCode: 0 } }),
});
const toolInvoker = createToolChokepoint({ definitions: [shell], guard, confirm: () => Promise.resolve("yes"), recorder: createLedgerChokepointRecorder(evidence) });

const requests = [];
const call = (callId, command) => ({ text: "", toolCalls: [{ callId, toolName: "shell", input: { command } }], finishReason: "tool-calls", inputTokens: 0, outputTokens: 0 });
const model = {
  modelId: "measure",
  generate: (request) => {
    requests.push(request);
    const step = requests.length;
    return Promise.resolve(step === 1 ? call("npm", "npm test 2>&1") : step <= 7 ? call(`small-${step}`, "git status") : { text: "done", toolCalls: [], finishReason: "stop", inputTokens: 0, outputTokens: 0 });
  },
};
await runAgentLoop("the task", {
  model,
  toolInvoker,
  toolSchemas: [shell],
  clock,
  random: { next: () => 0.5 },
  emit: () => {},
  budget: { maxSteps: 20, maxTokens: 10_000_000, maxWallTimeMs: 3_600_000 },
  abortSignal: new AbortController().signal,
  systemPrompt: "measure",
  maxOutputTokens: 8192,
  retryPolicy: { attempts: 1, baseDelayMs: 0, maxJitterRatio: 0 },
  stall: false,
});
await rm(root, { recursive: true, force: true });

const largestToolOutput = (request) =>
  Math.max(0, ...request.messages.filter((one) => one.role === "tool").flatMap((one) => one.outcomes.map((outcome) => outcome.output.length)));
console.log(JSON.stringify({
  recordedOutputCharacters: recorded.output.length,
  recordedFacts: recorded.facts,
  laterRequests: requests.slice(1, 7).map((request, index) => ({
    call: index + 2,
    messageCharacters: JSON.stringify(request.messages).length,
    estimatedTokens: estimateTokens(request.messages),
    largestToolOutputCharacters: largestToolOutput(request),
  })),
}, null, 2));
