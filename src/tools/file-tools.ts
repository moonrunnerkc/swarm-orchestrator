import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Sandbox } from "./sandbox.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";
import { resolveInsideWorkspace } from "./workspace-path.ts";

const defaultReadLimit = 64_000;

const readInput = z.object({
  path: z.string().describe("Workspace-relative path to read."),
  maxBytes: z.number().int().positive().optional(),
});

const writeInput = z.object({
  path: z.string().describe("Workspace-relative path to write."),
  content: z.string(),
});

const editInput = z.object({
  path: z.string().describe("Workspace-relative path to edit."),
  find: z.string().min(1).describe("Exact text to replace."),
  replace: z.string(),
  replaceAll: z.boolean().optional().describe("Replace every occurrence instead of requiring one."),
});

const listInput = z.object({
  path: z.string().optional().describe("Workspace-relative directory. Defaults to the root."),
});

export function createReadTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "read",
    description: "Read a UTF-8 file from the workspace.",
    inputSchema: readInput,
    kind: "read",
    pathsFrom: (input) => [input.path],
    async execute(input) {
      const absolutePath = resolveInsideWorkspace(sandbox, input.path);
      const limit = input.maxBytes ?? defaultReadLimit;
      const content = await readFile(absolutePath, "utf8");
      if (content.length <= limit) {
        return content;
      }
      return `${content.slice(0, limit)}\n[truncated at ${limit} of ${content.length} bytes]`;
    },
  });
}

export function createWriteTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "write",
    description: "Create or overwrite a workspace file with UTF-8 content.",
    inputSchema: writeInput,
    kind: "write",
    pathsFrom: (input) => [input.path],
    async execute(input) {
      const absolutePath = resolveInsideWorkspace(sandbox, input.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.content, "utf8");
      return `wrote ${input.content.length} bytes to ${input.path}`;
    },
  });
}

export function createEditTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "edit",
    description: "Replace exact text in a workspace file.",
    inputSchema: editInput,
    kind: "write",
    pathsFrom: (input) => [input.path],
    async execute(input) {
      const absolutePath = resolveInsideWorkspace(sandbox, input.path);
      const before = await readFile(absolutePath, "utf8");
      const occurrences = before.split(input.find).length - 1;

      if (occurrences === 0) {
        throw new Error(
          `no occurrence of the search text in ${input.path}. Read the file and copy the exact text.`,
        );
      }
      if (occurrences > 1 && input.replaceAll !== true) {
        throw new Error(
          `the search text appears ${occurrences} times in ${input.path}. ` +
            "Extend it until it is unique, or pass replaceAll.",
        );
      }

      const after =
        input.replaceAll === true
          ? before.split(input.find).join(input.replace)
          : before.replace(input.find, input.replace);
      await writeFile(absolutePath, after, "utf8");
      return `replaced ${occurrences} occurrence(s) in ${input.path}`;
    },
  });
}

export function createListTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "list",
    description: "List the entries of a workspace directory.",
    inputSchema: listInput,
    kind: "read",
    pathsFrom: (input) => [input.path ?? "."],
    async execute(input) {
      const absolutePath = resolveInsideWorkspace(sandbox, input.path ?? ".");
      const entries = await readdir(absolutePath, { withFileTypes: true });
      if (entries.length === 0) {
        return "(empty directory)";
      }
      return entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort()
        .join("\n");
    },
  });
}
