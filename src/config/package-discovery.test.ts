import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverPackages } from "./package-discovery.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-package-discovery-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function workspaces(patterns: readonly string[], directories: readonly string[]) {
  await writeFile(join(root, "package.json"), JSON.stringify({ workspaces: patterns }));
  for (const directory of directories) await mkdir(join(root, directory), { recursive: true });
}

describe("discovering workspace packages from declared patterns", () => {
  it("matches `*` inside one segment and `**` across one or more segments", async () => {
    await workspaces(
      ["packages/*", "apps/plugin-*", "tools/**"],
      [
        "packages/a",
        "packages/a/nested",
        "apps/plugin-x",
        "apps/plugin-",
        "apps/other",
        "tools/one/two",
      ],
    );
    expect(await discoverPackages(root)).toEqual([
      "apps/plugin-x",
      "packages/a",
      "tools/one",
      "tools/one/two",
    ]);
  });

  it("reads pnpm-workspace.yaml entries with the same matcher", async () => {
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'libs/*'\n");
    await mkdir(join(root, "libs/core"), { recursive: true });
    expect(await discoverPackages(root)).toEqual(["libs/core"]);
  });

  it("treats a dot as a literal character, not any character", async () => {
    await workspaces(["pkg.v1/*"], ["pkg.v1/a", "pkgXv1/b"]);
    expect(await discoverPackages(root)).toEqual(["pkg.v1/a"]);
  });

  it("refuses a regex-shaped pattern instead of compiling it, and returns promptly", async () => {
    // Before this refusal the pattern became `^(a+)+b$` and backtracked exponentially against
    // the directory name: 28 characters took six seconds, and each further two took four times
    // as long.
    await workspaces(["(a+)+b"], ["a".repeat(40)]);
    const started = Date.now();
    await expect(discoverPackages(root)).rejects.toThrow(
      'unsupported workspace pattern "(a+)+b"; select directories explicitly',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([
    "packages/a*b*",
    "packages/**x",
    "packages/{a,b}",
    "!packages/private",
    "packages/[ab]",
  ])("refuses the unsupported pattern %s", async (pattern) => {
    await workspaces([pattern], ["packages/a"]);
    await expect(discoverPackages(root)).rejects.toThrow("unsupported workspace pattern");
  });

  it("still refuses a pattern that climbs out of the workspace", async () => {
    await workspaces(["../outside/*"], []);
    await expect(discoverPackages(root)).rejects.toThrow("unsafe workspace pattern");
  });
});
