import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { PolicyGuard } from "./policy-guard.ts";
import { type BacktrackingRisk, findBacktrackingRisk } from "./regex-safety.ts";
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

/** Absent and empty both mean the workspace root, as they do for a listing. */
function searchRootOf(path: string | undefined): string {
  return path === undefined || path.trim().length === 0 ? "." : path;
}

export function createSearchTool(guard: PolicyGuard): ToolDefinition {
  return defineTool({
    name: "search",
    description: "Search workspace files line by line with a regular expression.",
    inputSchema: searchInput,
    kind: "read",
    pathsFrom: (input) => [searchRootOf(input.path)],
    async execute(input) {
      const root = resolveInsideWorkspace(guard, searchRootOf(input.path));
      const limit = input.maxResults ?? 100;

      let pattern: RegExp;
      try {
        // Deliberately a caller pattern, and the reason src/tools/regex-safety.ts exists: one
        // that can backtrack is refused before it reaches here, which is what this rule points at.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        pattern = new RegExp(input.pattern);
      } catch (cause) {
        throw new Error(`"${input.pattern}" is not a valid regular expression: ${String(cause)}`);
      }

      const risk = findBacktrackingRisk(input.pattern);
      if (risk !== null) {
        throw new UnsafeSearchPatternError(input.pattern, risk);
      }

      const matches: string[] = [];
      await collectMatches(root, guard, pattern, limit, matches);
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
  guard: PolicyGuard,
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
    // The guard is asked about every descendant, so a denied file is never read here.
    if (!guard.checkPath(childPath).allowed) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        await collectMatches(childPath, guard, pattern, limit, matches);
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
    const workspacePath = relative(guard.workspaceRoot, childPath);
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
