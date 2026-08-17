import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { type BacktrackingRisk, findBacktrackingRisk } from "./regex-safety.ts";
import type { Sandbox } from "./sandbox.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";
import { resolveInsideWorkspace } from "./workspace-path.ts";

/** Directories a code search should never descend into, regardless of the pattern. */
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

/**
 * How much of a line a pattern is run against. Refusing ambiguous patterns bounds the
 * exponential case; what is left is the quadratic one every greedy quantifier has when the
 * rest of the pattern fails, and that one is bounded by the length of the line rather than
 * by its shape. Minified and generated files are single lines of any size, so the cap keeps
 * one of them from stalling the scan.
 */
const maxScannedLineLength = 8_000;

/**
 * The pattern is model output, and it is about to run once per line of the workspace on the
 * main thread. A match that has started cannot be interrupted, so a pattern that can
 * backtrack super-linearly is refused before it runs rather than timed out afterwards.
 */
class UnsafeSearchPatternError extends Error {
  constructor(pattern: string, risk: BacktrackingRisk) {
    super(
      `"${pattern}" was refused: it ${risk.reason} (in \`${risk.construct}\`). ` +
        "Search runs the pattern against every line with no way to stop a match once it starts. " +
        "Rewrite it without the ambiguity: fix the length of the repeated part, make the " +
        "alternatives disjoint, or narrow the character classes so only one quantifier can " +
        "match a given character.",
    );
    this.name = "UnsafeSearchPatternError";
  }
}

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

      const risk = findBacktrackingRisk(input.pattern);
      if (risk !== null) {
        throw new UnsafeSearchPatternError(input.pattern, risk);
      }

      const matches: string[] = [];
      await collectMatches(root, sandbox, pattern, limit, matches);
      return {
        text: matches.length === 0 ? `no match for /${input.pattern}/` : matches.join("\n"),
        facts: {
          pattern: input.pattern,
          matches: matches.length,
          truncated: matches.length >= limit,
        },
      };
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
      const scanned =
        line.length > maxScannedLineLength ? line.slice(0, maxScannedLineLength) : line;
      if (pattern.test(scanned)) {
        matches.push(`${workspacePath}:${index + 1}: ${scanned.trim()}`);
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
