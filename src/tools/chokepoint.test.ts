import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolInvocation } from "../core/tool-invoker.ts";
import { type ConfirmationRequest, createToolChokepoint } from "./chokepoint.ts";
import type { ChokepointRecord, ChokepointRecorder } from "./chokepoint-record.ts";
import { createSandbox, type SandboxPolicy } from "./sandbox.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";

const policy: SandboxPolicy = {
  workspaceRoot: "/work/repo",
  homeDir: "/home/dev",
  shellAllowlist: ["git"],
  deniedRoots: [],
  realpath: (path) => path,
};

interface Recording extends ChokepointRecorder {
  readonly records: readonly ChokepointRecord[];
}

function createRecordingRecorder(): Recording {
  const records: ChokepointRecord[] = [];
  return { records, record: (entry) => records.push(entry) };
}

function createSpyTool(name: string, calls: string[]): ToolDefinition {
  return defineTool({
    name,
    description: `spy tool ${name}`,
    inputSchema: z.object({ path: z.string() }),
    kind: "read",
    pathsFrom: (input) => [input.path],
    execute(input) {
      calls.push(input.path);
      return Promise.resolve(`read ${input.path}`);
    },
  });
}

function createSpyShellTool(calls: string[]): ToolDefinition {
  return defineTool({
    name: "shell",
    description: "spy shell tool",
    inputSchema: z.object({ command: z.string() }),
    kind: "shell",
    pathsFrom: () => [],
    execute(input) {
      calls.push(input.command);
      return Promise.resolve(`ran ${input.command}`);
    },
  });
}

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    callId: "call-1",
    toolName: "read",
    input: { path: "src/index.ts" },
    provenance: "model",
    ...overrides,
  };
}

describe("tool chokepoint", () => {
  it("runs an allowed call and records it", async () => {
    const calls: string[] = [];
    const recorder = createRecordingRecorder();
    const chokepoint = createToolChokepoint({
      definitions: [createSpyTool("read", calls)],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder,
    });

    const outcome = await chokepoint.invoke(invocation());

    expect(outcome).toEqual({
      callId: "call-1",
      toolName: "read",
      output: "read src/index.ts",
      failed: false,
    });
    expect(calls).toEqual(["src/index.ts"]);
    expect(recorder.records[0]?.decision).toBe("allowed");
    expect(recorder.records[0]?.provenance).toBe("model");
  });

  it("denies a path outside the workspace without running the tool", async () => {
    const calls: string[] = [];
    const recorder = createRecordingRecorder();
    const chokepoint = createToolChokepoint({
      definitions: [createSpyTool("read", calls)],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder,
    });

    const outcome = await chokepoint.invoke(invocation({ input: { path: "../../etc/passwd" } }));

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("outside the workspace");
    expect(calls).toEqual([]);
    expect(recorder.records[0]?.decision).toBe("denied");
  });

  it("denies a credential path and records the denial as evidence", async () => {
    const calls: string[] = [];
    const recorder = createRecordingRecorder();
    const chokepoint = createToolChokepoint({
      definitions: [createSpyTool("read", calls)],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder,
    });

    const outcome = await chokepoint.invoke(invocation({ input: { path: ".env" } }));

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("credential denylist");
    expect(calls).toEqual([]);
    expect(recorder.records).toHaveLength(1);
    expect(recorder.records[0]).toMatchObject({ decision: "denied", toolName: "read" });
  });

  it("rejects input that does not match the tool schema", async () => {
    const calls: string[] = [];
    const chokepoint = createToolChokepoint({
      definitions: [createSpyTool("read", calls)],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder: createRecordingRecorder(),
    });

    const outcome = await chokepoint.invoke(invocation({ input: { path: 42 } }));

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("input rejected");
    expect(calls).toEqual([]);
  });

  it("reports an unknown tool as a failed outcome rather than throwing", async () => {
    const chokepoint = createToolChokepoint({
      definitions: [createSpyTool("read", [])],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder: createRecordingRecorder(),
    });

    const outcome = await chokepoint.invoke(invocation({ toolName: "delete-everything" }));

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("no such tool");
  });

  it("runs an allowlisted shell command without asking", async () => {
    const commands: string[] = [];
    const asked: ConfirmationRequest[] = [];
    const chokepoint = createToolChokepoint({
      definitions: [createSpyShellTool(commands)],
      sandbox: createSandbox(policy),
      confirm: (request) => {
        asked.push(request);
        return Promise.resolve(true);
      },
      recorder: createRecordingRecorder(),
    });

    const outcome = await chokepoint.invoke(
      invocation({ toolName: "shell", input: { command: "git status" } }),
    );

    expect(outcome.failed).toBe(false);
    expect(commands).toEqual(["git status"]);
    expect(asked).toEqual([]);
  });

  it("asks before running a command that is not allowlisted", async () => {
    const commands: string[] = [];
    const asked: ConfirmationRequest[] = [];
    const chokepoint = createToolChokepoint({
      definitions: [createSpyShellTool(commands)],
      sandbox: createSandbox(policy),
      confirm: (request) => {
        asked.push(request);
        return Promise.resolve(true);
      },
      recorder: createRecordingRecorder(),
    });

    const outcome = await chokepoint.invoke(
      invocation({ toolName: "shell", input: { command: "curl https://example.com" } }),
    );

    expect(asked).toEqual([{ toolName: "shell", detail: "curl https://example.com" }]);
    expect(commands).toEqual(["curl https://example.com"]);
    expect(outcome.failed).toBe(false);
  });

  it("denies a command when confirmation is declined", async () => {
    const commands: string[] = [];
    const recorder = createRecordingRecorder();
    const chokepoint = createToolChokepoint({
      definitions: [createSpyShellTool(commands)],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder,
    });

    const outcome = await chokepoint.invoke(
      invocation({ toolName: "shell", input: { command: "rm -rf /" } }),
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("confirmation was declined");
    expect(commands).toEqual([]);
    expect(recorder.records[0]?.decision).toBe("denied");
  });

  it("turns a thrown tool error into a failed outcome the loop can feed back", async () => {
    const recorder = createRecordingRecorder();
    const chokepoint = createToolChokepoint({
      definitions: [
        defineTool({
          name: "read",
          description: "always fails",
          inputSchema: z.object({ path: z.string() }),
          kind: "read",
          pathsFrom: (input) => [input.path],
          execute: () => Promise.reject(new Error("disk on fire")),
        }),
      ],
      sandbox: createSandbox(policy),
      confirm: () => Promise.resolve(false),
      recorder,
    });

    const outcome = await chokepoint.invoke(invocation());

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toBe("failed: disk on fire");
    expect(recorder.records[0]?.decision).toBe("failed");
  });
});
