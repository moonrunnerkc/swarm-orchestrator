import { z } from "zod";
import { defineTool, type ToolDefinition } from "../tools/tool-definition.ts";
import {
  FileSetAlreadyDeclaredError,
  type FileSetRegistry,
  NothingTemporaryToRetainError,
} from "./file-set.ts";

const temporaryPaths = z
  .array(z.string().min(1))
  .optional()
  .describe(
    "Paths you will create only to investigate, such as a probe script or a scratch check. They " +
      "are not part of the change: delete each one before you finish, or the file-set gate fails.",
  );

const declareInput = z.object({
  files: z
    .array(z.string().min(1))
    .min(1)
    .describe("Workspace-relative paths this task intends to create or edit."),
  temporary: temporaryPaths,
});

const amendInput = z
  .object({
    files: z.array(z.string().min(1)).optional().describe("Additional paths the task now needs."),
    temporary: temporaryPaths,
    retain: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Paths you recorded as temporary and have decided belong in the change after all. The " +
          "reason must say why each one is worth keeping.",
      ),
    reason: z
      .string()
      .min(1)
      .describe("Why the original set was not enough. A reviewer reads this."),
  })
  .refine(
    (input) =>
      (input.files?.length ?? 0) + (input.temporary?.length ?? 0) + (input.retain?.length ?? 0) > 0,
    { message: "name at least one path under files, temporary or retain" },
  );

/**
 * Invariant 12's declaration, as a tool rather than an execution path of its own. The
 * planner names its files before editing, and the gates check membership afterwards.
 */
export function createDeclareFileSetTool(registry: FileSetRegistry, actor: string): ToolDefinition {
  return defineTool({
    name: "declare_file_set",
    description:
      "Declare, before editing, the set of files this task intends to touch. Required: the " +
      "file-set gate blocks any change to a file outside the declared set, and any file " +
      "declared temporary that is still there at the end.",
    inputSchema: declareInput,
    kind: "evidence",
    pathsFrom: () => [],
    async execute(input) {
      try {
        const state = await registry.declare(input.files, actor, {
          ...(input.temporary === undefined ? {} : { temporary: input.temporary }),
        });
        const temporary = [...(state.temporary ?? [])].sort();
        return {
          text:
            `declared ${state.allowed.size} file(s): ${[...state.allowed].sort().join(", ")}` +
            (temporary.length === 0
              ? ""
              : `. Temporary, to be deleted before you finish: ${temporary.join(", ")}`),
          facts: { declaredFiles: state.allowed.size, temporaryFiles: temporary.length },
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
      "Widen the declared file set, record a path as temporary, or retain a temporary path on " +
      "purpose. The amendment is recorded and shown to the reviewer as a claim, so widening is " +
      "allowed but never silent.",
    inputSchema: amendInput,
    kind: "evidence",
    pathsFrom: () => [],
    async execute(input) {
      let state: Awaited<ReturnType<FileSetRegistry["amend"]>>;
      try {
        state = await registry.amend(input.files ?? [], input.reason, actor, {
          ...(input.temporary === undefined ? {} : { temporary: input.temporary }),
          ...(input.retain === undefined ? {} : { retain: input.retain }),
        });
      } catch (cause) {
        // Told to the model as a result and not thrown: it named a path wrongly, which it can fix.
        if (cause instanceof NothingTemporaryToRetainError) {
          return { text: cause.message, facts: { declaredFiles: registry.state().allowed.size } };
        }
        throw cause;
      }
      const temporary = [...(state.temporary ?? [])].sort();
      return {
        text:
          `the declared file set now covers ${state.allowed.size} file(s)` +
          (temporary.length === 0
            ? ""
            : `. Temporary, to be deleted before you finish: ${temporary.join(", ")}`),
        facts: {
          declaredFiles: state.allowed.size,
          amendments: state.amendments.length,
          temporaryFiles: temporary.length,
          retainedFiles: state.retained?.length ?? 0,
        },
      };
    },
  });
}
