import { readdir } from "node:fs/promises";
import { join, matchesGlob, relative } from "node:path";
import { z } from "zod";
import { readFileWindow } from "./bounded-file.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import { type BacktrackingRisk, findBacktrackingRisk } from "./regex-safety.ts";
import { createRegexMatcher } from "./regex-worker.ts";
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

/** Known backtracking patterns are refused before consuming the worker execution budget. */
class UnsafeSearchPatternError extends Error {
  constructor(pattern: string, risk: BacktrackingRisk) {
    super(
      `"${pattern}" was refused: it ${risk.reason} (in \`${risk.construct}\`). ` +
        "Search also enforces a worker deadline, but known backtracking hazards are refused before dispatch. " +
        "Rewrite it without the ambiguity: fix the length of the repeated part, make the " +
        "alternatives disjoint, or narrow the character classes so only one quantifier can " +
        "match a given character.",
    );
    this.name = "UnsafeSearchPatternError";
  }
}

const searchInput = z.object({
  pattern: z.string().min(1).max(1024).describe("JavaScript regular expression to match per line."),
  path: z.string().optional().describe("Workspace-relative directory to search."),
  maxResults: z.number().int().positive().max(1000).optional(),
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional(),
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
    async execute(input, context) {
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
      const matcher = createRegexMatcher(pattern.source, 1000, context?.signal);
      const scan = { files: 0, bytes: 0, truncated: false, deadline: Date.now() + 5000 };
      try {
        await collectMatches(root, guard, matcher, limit, matches, scan, input, context?.signal);
      } finally {
        await matcher.close();
      }
      return {
        text: matches.length === 0 ? `no match for /${input.pattern}/` : matches.join("\n"),
        facts: {
          pattern: input.pattern,
          matches: matches.length,
          truncated: matches.length >= limit || scan.truncated,
          scannedFiles: scan.files,
          scannedBytes: scan.bytes,
        },
      };
    },
  });
}

async function collectMatches(
  directory: string,
  guard: PolicyGuard,
  matcher: ReturnType<typeof createRegexMatcher>,
  limit: number,
  matches: string[],
  scan: { files: number; bytes: number; truncated: boolean; deadline: number },
  scope: { include?: string[] | undefined; exclude?: string[] | undefined },
  signal?: AbortSignal,
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (scan.files >= 1000 || scan.bytes >= 16_000_000 || Date.now() >= scan.deadline) {
      scan.truncated = true;
      return;
    }
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
        await collectMatches(childPath, guard, matcher, limit, matches, scan, scope, signal);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const workspacePath = relative(guard.workspaceRoot, childPath);
    if (
      scope.exclude?.some((glob) => matchesGlob(workspacePath, glob)) ||
      (scope.include !== undefined &&
        !scope.include.some((glob) => matchesGlob(workspacePath, glob)))
    )
      continue;
    let window: Awaited<ReturnType<typeof readFileWindow>>;
    try {
      window = await readFileWindow(childPath, {
        maxBytes: 256_000,
        maxScanBytes: 256_000,
        signal,
      });
    } catch (cause) {
      signal?.throwIfAborted();
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    scan.files += 1;
    scan.bytes += window.scannedBytes;
    scan.truncated ||= window.truncated;
    if (window.text.includes("\u0000")) continue;
    const lines = window.text.split("\n").map((line) => {
      scan.truncated ||= line.length > maxScannedLineLength;
      return line.slice(0, maxScannedLineLength);
    });
    const matched = await matcher.match(lines);

    for (const [index, line] of lines.entries()) {
      const scanned =
        line.length > maxScannedLineLength ? line.slice(0, maxScannedLineLength) : line;
      if (matched[index]) {
        matches.push(`${workspacePath}:${index + 1}: ${scanned.trim()}`);
        if (matches.length >= limit) {
          return;
        }
      }
    }
  }
}
