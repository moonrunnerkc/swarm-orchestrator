"use strict";

/**
 * The adapter-output boundary: what a model returned, arriving at the one path that is
 * allowed to run it. A tool call's input is whatever the provider handed back, so it is
 * arbitrary JSON, and the chokepoint has to hold for all of it. What is under test is
 * invariant 3, that no tool runs outside this path and nothing runs unrecorded:
 *
 *   - invoke settles rather than throwing, whatever the model sent
 *   - exactly two records per call, the request one before anything runs
 *   - a tool executes only on input its own schema accepted
 *   - everything recorded canonicalizes, or the ledger could not have taken it
 *
 * The tools here are inert doubles. Nothing this harness runs touches the filesystem.
 */

const { strict: assert } = require("node:assert");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { z } = require("zod");

const { canonicalJson, digestOfJson, digestPattern } = require(
  "../.swarm/fuzz-build/evidence/canonical-json.js",
);
const { createToolChokepoint } = require("../.swarm/fuzz-build/tools/chokepoint.js");
const { createPolicyGuard } = require("../.swarm/fuzz-build/tools/policy-guard.js");
const { defineTool } = require("../.swarm/fuzz-build/tools/tool-definition.js");

const workspace = mkdtempSync(join(tmpdir(), "swarm-fuzz-workspace-"));

/** Set by a tool double when it actually runs, which only a valid input may cause. */
let executed = null;

/** The one path that makes a tool throw, so the chokepoint's failed branch is reachable. */
const EXPLODING_PATH = "explode";

const readFile = defineTool({
  name: "read_file",
  description: "reads a file from the workspace",
  kind: "read",
  inputSchema: z.object({ path: z.string().min(1) }),
  pathsFrom: (input) => [input.path],
  execute: async (input) => {
    executed = { toolName: "read_file", input, threw: input.path === EXPLODING_PATH };
    if (input.path === EXPLODING_PATH) {
      throw new Error("the tool threw while running");
    }
    return { text: `read ${input.path}`, facts: { bytes: input.path.length } };
  },
});

const runShell = defineTool({
  name: "run_shell",
  description: "runs a shell command in the workspace",
  kind: "shell",
  inputSchema: z.object({ command: z.string().min(1) }),
  pathsFrom: () => [],
  execute: async (input) => {
    executed = { toolName: "run_shell", input, threw: false };
    return { text: `ran ${input.command}` };
  },
});

const calls = [];
const confirmations = [];

/** Approval is the model's to steer here, so both sides of the gate stay reachable. */
let approve = false;

const chokepoint = createToolChokepoint({
  definitions: [readFile, runShell],
  guard: createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: workspace,
    shellAllowlist: ["echo", "ls"],
    deniedRoots: [join(workspace, ".swarm")],
  }),
  confirm: async (request) => {
    confirmations.push(request);
    return approve;
  },
  recorder: {
    async recordCall(entry) {
      calls.push(entry);
      return `sha256:${"0".repeat(64)}`;
    },
    async recordConfirmation(entry) {
      confirmations.push(entry);
    },
  },
});

/** A model's turn, read as the tool call it claims to be. */
function callFrom(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A turn that is not JSON at all still reaches the chokepoint as an input.
    return { callId: "call-0", toolName: "read_file", input: text, approve: false };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { callId: "call-0", toolName: "read_file", input: parsed, approve: false };
  }
  return {
    callId: typeof parsed.callId === "string" ? parsed.callId : "call-0",
    toolName: typeof parsed.tool === "string" ? parsed.tool : "read_file",
    input: "input" in parsed ? parsed.input : parsed,
    approve: parsed.approve === true,
  };
}

module.exports.fuzz = async function (data) {
  const call = callFrom(data.toString("utf8"));
  calls.length = 0;
  confirmations.length = 0;
  executed = null;
  approve = call.approve;

  const outcome = await chokepoint.invoke({
    callId: call.callId,
    toolName: call.toolName,
    input: call.input,
    provenance: "model",
  });

  assert.equal(calls.length, 2, "a call has to leave a request record and a settle record");
  const [requested, settled] = calls;
  assert.equal(requested.decision, "requested", "the first record is written before anything runs");
  assert.notEqual(settled.decision, "requested", "the settle record has to settle");
  assert.equal(
    settled.denial === null,
    settled.decision !== "denied",
    "a denial is named exactly when the call was denied",
  );
  assert.equal(outcome.failed, settled.decision !== "allowed", "failed has to follow the decision");
  assert.equal(outcome.callId, call.callId, "the outcome answers about another call");
  assert.equal(outcome.toolName, call.toolName, "the outcome answers about another tool");

  // What the chokepoint records is what the ledger has to be able to take.
  for (const record of calls) {
    const digest = digestOfJson(record.input);
    assert.ok(digestPattern.test(digest), `input digested to ${digest}`);
    assert.equal(typeof canonicalJson(record.input), "string");
  }

  if (executed !== null) {
    assert.equal(
      settled.decision,
      executed.threw ? "failed" : "allowed",
      "a tool that ran did not settle as what happened to it",
    );
    assert.equal(executed.toolName, call.toolName, "a call ran the wrong tool");
    const definition = executed.toolName === "read_file" ? readFile : runShell;
    assert.ok(
      definition.inputSchema.safeParse(executed.input).success,
      "a tool ran on input its own schema rejects",
    );
  }
};
