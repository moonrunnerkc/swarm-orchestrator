import { describe, expect, it } from "vitest";
import {
  eventsFromClaudeCodeStream,
  eventsFromGenericJsonl,
  MalformedAdapterInputError,
  patchFromWorkspaceDiff,
} from "./external-agent.ts";

/**
 * The product's job is verification, so what it verifies must not have to be its own agent. Two
 * adapters, because one is an interface and two is a contract: a stream some other tool already
 * emits, and a plain shape for anything that emits nothing.
 */
describe("reading what another agent did", () => {
  it("reads a generic line-delimited stream into loop events", () => {
    const events = eventsFromGenericJsonl(
      [
        '{"type":"tool-call","toolName":"shell","callId":"c1","input":{"command":"ls"}}',
        '{"type":"tool-outcome","toolName":"shell","callId":"c1","failed":false,"output":"a\\nb"}',
        "",
      ].join("\n"),
    );

    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-outcome"]);
  });

  it("refuses a line that is not a shape this build knows, rather than dropping it", () => {
    // A dropped line is evidence that silently was not read, which is the failure this whole
    // system is about.
    expect(() => eventsFromGenericJsonl('{"type":"teleport"}')).toThrow(MalformedAdapterInputError);
    expect(() => eventsFromGenericJsonl("not json at all")).toThrow(/line 1/);
  });

  it("reads a Claude Code style stream, mapping its names onto ours", () => {
    const events = eventsFromClaudeCodeStream(
      [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I will edit the parser"}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}]}}',
        '{"type":"result","subtype":"success","num_turns":3}',
      ].join("\n"),
    );

    expect(events.map((event) => event.type)).toEqual([
      "model-text",
      "tool-call",
      "tool-outcome",
      "stopped",
    ]);
    const call = events[1];
    expect(call?.type === "tool-call" ? call.toolName : "").toBe("Bash");
  });

  it("marks a failed tool result as failed, because that is what a verdict turns on", () => {
    const events = eventsFromClaudeCodeStream(
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"boom","is_error":true}]}}',
    );

    const outcome = events[0];
    expect(outcome?.type === "tool-outcome" ? outcome.failed : false).toBe(true);
  });

  it("ignores nothing silently: an unknown Claude Code line is refused too", () => {
    expect(() => eventsFromClaudeCodeStream('{"type":"telemetry","x":1}')).toThrow(
      MalformedAdapterInputError,
    );
  });

  it("takes a patch from a diff, so a run that produced only a diff can still be verified", () => {
    const patch = patchFromWorkspaceDiff(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    );

    expect(patch.paths).toEqual(["a.ts"]);
    expect(patch.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a diff with no file headers, which is not a patch", () => {
    expect(() => patchFromWorkspaceDiff("just some text")).toThrow(/no file/i);
  });
});
