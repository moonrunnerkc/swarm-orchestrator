import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** Discover conventional npm/pnpm workspace directories without executing package code. */
export async function discoverPackages(root: string): Promise<readonly string[]> {
  const manifest = await readFile(join(root, "package.json"), "utf8").catch(() => "{}");
  const schema = z.object({
    workspaces: z
      .union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
      .optional(),
  });
  const workspaces = schema.parse(JSON.parse(manifest)).workspaces;
  const patterns = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
  const pnpm = await readFile(join(root, "pnpm-workspace.yaml"), "utf8").catch(() => "");
  if (pnpm) {
    const block = /^packages:\s*\n((?:[ \t]+[^\n]*\n?)*)/m.exec(pnpm)?.[1];
    if (block === undefined)
      throw new Error(
        "pnpm workspace discovery needs a conventional packages list; select directories explicitly",
      );
    for (const line of block.split("\n").filter((line) => line.trim())) {
      const entry = /^\s*-\s*['"]?([A-Za-z0-9_./*-]+)['"]?\s*$/.exec(line)?.[1];
      if (!entry)
        throw new Error("unsupported pnpm workspace pattern; select directories explicitly");
      patterns.push(entry);
    }
  }
  const matchers = patterns.map((pattern) => {
    if (pattern.includes("..") || pattern.startsWith("/"))
      throw new Error("unsafe workspace pattern");
    return workspaceGlob(pattern);
  });
  const found: string[] = [];
  let visited = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6 || ++visited > 2000)
      throw new Error("workspace discovery limit exceeded; select package paths explicitly");
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
        continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (matchers.some((matcher) => matcher.test(path))) found.push(path);
      if (patterns.length) await visit(path, depth + 1);
    }
  };
  if (patterns.length) await visit("", 0);
  return [...new Set(found)].sort();
}

type GlobSegment =
  | { readonly kind: "globstar" }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "wildcard"; readonly prefix: string; readonly suffix: string };

const plainSegment = /^[A-Za-z0-9_@.-]*$/;

/**
 * Compile a workspace pattern into a matcher over slash-separated directory paths. The pattern
 * comes from the repository being checked, so it is never compiled into a regular expression:
 * a `workspaces` entry such as `(a+)+b` made the previous RegExp translation backtrack
 * exponentially against a directory the same repository named. `*` matches one or more
 * characters inside one segment, `**` as a whole segment matches one or more segments, and any
 * other shape is refused rather than guessed.
 */
function workspaceGlob(pattern: string): { test(path: string): boolean } {
  const segments = pattern.split("/").map((text): GlobSegment => {
    if (text === "**") return { kind: "globstar" };
    const [prefix = "", suffix, ...extra] = text.split("*");
    if (!plainSegment.test(prefix) || extra.length > 0 || !plainSegment.test(suffix ?? ""))
      throw new Error(
        `unsupported workspace pattern ${JSON.stringify(pattern)}; select directories explicitly`,
      );
    return suffix === undefined ? { kind: "literal", text } : { kind: "wildcard", prefix, suffix };
  });
  const segmentMatches = (segment: GlobSegment, name: string): boolean =>
    segment.kind === "literal"
      ? name === segment.text
      : segment.kind === "wildcard" &&
        name.length > segment.prefix.length + segment.suffix.length &&
        name.startsWith(segment.prefix) &&
        name.endsWith(segment.suffix);
  return {
    test(path) {
      const names = path.split("/");
      // Every pattern segment consumes at least one name, which bounds the globstar search by
      // the directory depth rather than by anything the pattern says.
      const matchFrom = (at: number, from: number): boolean => {
        const segment = segments[at];
        if (segment === undefined) return from === names.length;
        if (segments.length - at > names.length - from) return false;
        if (segment.kind !== "globstar")
          return segmentMatches(segment, names[from] ?? "") && matchFrom(at + 1, from + 1);
        for (let end = from + 1; end <= names.length; end += 1)
          if (matchFrom(at + 1, end)) return true;
        return false;
      };
      return matchFrom(0, 0);
    },
  };
}
