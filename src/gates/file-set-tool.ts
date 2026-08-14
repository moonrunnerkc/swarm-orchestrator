import { z } from "zod";
import { defineTool, type ToolDefinition } from "../tools/tool-definition.ts";
import { FileSetAlreadyDeclaredError, type FileSetRegistry } from "./file-set.ts";

const declareInput = z.object({
  files: z
    .array(z.string().min(1))
    .min(1)
    .describe("Workspace-relative paths this task intends to create or edit."),
});

const amendInput = z.object({
  files: z.array(z.string().min(1)).min(1).describe("Additional paths the task now needs."),
  reason: z.string().min(1).describe("Why the original set was not enough. A reviewer reads this."),
});

/**
 * Invariant 12's declaration, as a tool rather than an execution path of its own. The
 * planner names its files before editing, and the gates check membership afterwards.
 */
export function createDeclareFileSetTool(registry: FileSetRegistry, actor: string): ToolDefinition {
  return defineTool({
    name: "declare_file_set",
    description:
      "Declare, before editing, the set of files this task intends to touch. Required: the " +
      "file-set gate blocks any change to a file outside the declared set.",
    inputSchema: declareInput,
    kind: "evidence",
    pathsFrom: () => [],
    async execute(input) {
      try {
        const state = await registry.declare(input.files, actor);
        return {
          text: `declared ${state.allowed.size} file(s): ${[...state.allowed].sort().join(", ")}`,
          facts: { declaredFiles: state.allowed.size },
        };
      } catch (cause) {
        if (cause instanceof FileSetAlreadyDeclaredError) {
          return { text: cause.message, facts: { declaredFiles: registry.state().allowed.size } };
        }
        throw cause;
      }
    },
  });
}

export function createAmendFileSetTool(registry: FileSetRegistry, actor: string): ToolDefinition {
  return defineTool({
    name: "amend_file_set",
    description:
      "Widen the declared file set. The amendment is recorded and shown to the reviewer as a " +
      "claim, so widening is allowed but never silent.",
    inputSchema: amendInput,
    kind: "evidence",
    pathsFrom: () => [],
    async execute(input) {
      const state = await registry.amend(input.files, input.reason, actor);
      return {
        text: `the declared file set now covers ${state.allowed.size} file(s)`,
        facts: {
          declaredFiles: state.allowed.size,
          amendments: state.amendments.length,
        },
      };
    },
  });
}
