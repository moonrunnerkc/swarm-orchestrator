import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { Sandbox } from "./sandbox.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";
import { resolveInsideWorkspace } from "./workspace-path.ts";

/** Directories a code search should never descend into, regardless of the pattern. */
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

const searchInput = z.object({
  pattern: z.string().min(1).describe("JavaScript regular expression to match per line."),
  path: z.string().optional().describe("Workspace-relative directory to search."),
  maxResults: z.number().int().positive().optional(),
});

export function createSearchTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "search",
    description: "Search workspace files line by line with a regular expression.",
    inputSchema: searchInput,
    kind: "read",
    pathsFrom: (input) => [input.path ?? "."],
    async execute(input) {
      const root = resolveInsideWorkspace(sandbox, input.path ?? ".");
      const limit = input.maxResults ?? 100;

      let pattern: RegExp;
      try {
        pattern = new RegExp(input.pattern);
      } catch (cause) {
        throw new Error(`"${input.pattern}" is not a valid regular expression: ${String(cause)}`);
      }

      const matches: string[] = [];
      await collectMatches(root, sandbox, pattern, limit, matches);
      if (matches.length === 0) {
        return `no match for /${input.pattern}/`;
      }
      return matches.join("\n");
    },
  });
}

async function collectMatches(
  directory: string,
  sandbox: Sandbox,
  pattern: RegExp,
  limit: number,
  matches: string[],
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= limit) {
      return;
    }
    const childPath = join(directory, entry.name);
    // The sandbox is asked about every descendant, so a denied file is never read here.
    if (!sandbox.checkPath(childPath).allowed) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        await collectMatches(childPath, sandbox, pattern, limit, matches);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const content = await readTextOrSkip(childPath);
    if (content === null) {
      continue;
    }
    const workspacePath = relative(sandbox.workspaceRoot, childPath);
    const lines = content.split("\n");
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line)) {
        matches.push(`${workspacePath}:${index + 1}: ${line.trim()}`);
        if (matches.length >= limit) {
          return;
        }
      }
    }
  }
}

async function readTextOrSkip(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf8");
    // A NUL byte means the file is binary; searching it line by line is noise.
    return content.includes("\u0000") ? null : content;
  } catch {
    return null;
  }
}
