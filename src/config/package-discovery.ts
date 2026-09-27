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
    return new RegExp(
      `^${pattern.replaceAll(".", "\\.").replaceAll("**", "\0").replaceAll("*", "[^/]+").replaceAll("\0", ".*")}$`,
    );
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
