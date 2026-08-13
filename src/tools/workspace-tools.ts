import { createEditTool, createListTool, createReadTool, createWriteTool } from "./file-tools.ts";
import type { Sandbox } from "./sandbox.ts";
import { createSearchTool } from "./search-tool.ts";
import { createShellTool } from "./shell-tool.ts";
import type { ToolDefinition } from "./tool-definition.ts";

/** The six workspace tools, as data. Adding one means adding a definition here. */
export function createWorkspaceTools(sandbox: Sandbox): readonly ToolDefinition[] {
  return [
    createReadTool(sandbox),
    createWriteTool(sandbox),
    createEditTool(sandbox),
    createListTool(sandbox),
    createSearchTool(sandbox),
    createShellTool(sandbox),
  ];
}
