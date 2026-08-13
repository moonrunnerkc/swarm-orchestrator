import { describeUnknownError, type ToolCallOutcome } from "../core/model-client.ts";
import type { ToolInvocation, ToolInvoker } from "../core/tool-invoker.ts";
import type { ChokepointRecorder } from "./chokepoint-record.ts";
import type { Sandbox } from "./sandbox.ts";
import type { ToolDefinition } from "./tool-definition.ts";

export interface ConfirmationRequest {
  readonly toolName: string;
  readonly detail: string;
}

/** Asked whenever a shell command falls outside the allowlist. */
export type ConfirmationPrompt = (request: ConfirmationRequest) => Promise<boolean>;

export interface ChokepointDependencies {
  readonly definitions: readonly ToolDefinition[];
  readonly sandbox: Sandbox;
  readonly confirm: ConfirmationPrompt;
  readonly recorder: ChokepointRecorder;
}

/**
 * The single execution path for every tool call. It records the attempt, enforces the
 * sandbox, and only then runs the tool. A denial or a thrown error comes back as a
 * failed outcome rather than an exception, because the loop feeds both to the model.
 */
export function createToolChokepoint(deps: ChokepointDependencies): ToolInvoker {
  const byName = new Map(deps.definitions.map((definition) => [definition.name, definition]));

  return {
    async invoke(invocation: ToolInvocation): Promise<ToolCallOutcome> {
      const definition = byName.get(invocation.toolName);
      if (definition === undefined) {
        return deny(
          deps,
          invocation,
          "unknown",
          `no such tool. Known tools: ${[...byName.keys()].join(", ")}`,
        );
      }

      const parsed = definition.inputSchema.safeParse(invocation.input);
      if (!parsed.success) {
        return deny(deps, invocation, definition.kind, `input rejected: ${parsed.error.message}`);
      }
      const input = parsed.data;

      for (const path of definition.pathsFrom(input)) {
        const verdict = deps.sandbox.checkPath(path);
        if (!verdict.allowed) {
          return deny(deps, invocation, definition.kind, verdict.reason);
        }
      }

      if (definition.kind === "shell") {
        const command = describeCommand(input);
        if (!deps.sandbox.isCommandAllowed(command)) {
          const approved = await deps.confirm({ toolName: definition.name, detail: command });
          if (!approved) {
            return deny(
              deps,
              invocation,
              definition.kind,
              `command is not on the shell allowlist and confirmation was declined: ${command}`,
            );
          }
        }
      }

      try {
        const output = await definition.execute(input);
        deps.recorder.record({
          callId: invocation.callId,
          toolName: invocation.toolName,
          kind: definition.kind,
          provenance: invocation.provenance,
          decision: "allowed",
          detail: `${output.length} bytes returned`,
        });
        return {
          callId: invocation.callId,
          toolName: invocation.toolName,
          output,
          failed: false,
        };
      } catch (cause) {
        return fail(deps, invocation, definition.kind, describeUnknownError(cause));
      }
    },
  };
}

function deny(
  deps: ChokepointDependencies,
  invocation: ToolInvocation,
  kind: ToolDefinition["kind"] | "unknown",
  reason: string,
): ToolCallOutcome {
  deps.recorder.record({
    callId: invocation.callId,
    toolName: invocation.toolName,
    kind,
    provenance: invocation.provenance,
    decision: "denied",
    detail: reason,
  });
  return {
    callId: invocation.callId,
    toolName: invocation.toolName,
    output: `denied: ${reason}`,
    failed: true,
  };
}

function fail(
  deps: ChokepointDependencies,
  invocation: ToolInvocation,
  kind: ToolDefinition["kind"],
  reason: string,
): ToolCallOutcome {
  deps.recorder.record({
    callId: invocation.callId,
    toolName: invocation.toolName,
    kind,
    provenance: invocation.provenance,
    decision: "failed",
    detail: reason,
  });
  return {
    callId: invocation.callId,
    toolName: invocation.toolName,
    output: `failed: ${reason}`,
    failed: true,
  };
}

function describeCommand(input: unknown): string {
  if (typeof input === "object" && input !== null && "command" in input) {
    const command = (input as { command: unknown }).command;
    return typeof command === "string" ? command : String(command);
  }
  return "";
}
