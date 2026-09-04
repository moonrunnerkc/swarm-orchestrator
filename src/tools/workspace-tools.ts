import {
  createEditTool,
  createListTool,
  createReadTool,
  createWriteTool,
  type WriteRefusal,
} from "./file-tools.ts";
import type { Sandbox } from "./sandbox.ts";
import { createSearchTool } from "./search-tool.ts";
import { createShellTool } from "./shell-tool.ts";
import type { ToolDefinition } from "./tool-definition.ts";

/**
 * The six workspace tools, as data. Adding one means adding a definition here. The two that
 * write take the refusal the file set gives, where a run has one; the shell can still write,
 * and the file-set gate reads every changed file afterwards whichever tool changed it.
 */
export function createWorkspaceTools(
  sandbox: Sandbox,
  refuseWrite?: WriteRefusal,
): readonly ToolDefinition[] {
  return [
    createReadTool(sandbox),
    createWriteTool(sandbox, refuseWrite),
    createEditTool(sandbox, refuseWrite),
    createListTool(sandbox),
    createSearchTool(sandbox),
    createShellTool(sandbox),
  ];
}
