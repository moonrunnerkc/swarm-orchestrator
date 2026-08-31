import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandbox, defaultShellAllowlist } from "./sandbox.ts";
import { createSearchTool } from "./search-tool.ts";
import type { ToolOutput } from "./tool-definition.ts";

/**
 * What the search tool does over a real tree, rather than what its schema says. Every case
 * here is a decision the tool makes that something downstream depends on: the facts a claim
 * would address, the pattern it refuses before running it, and the files it declines to read.
 */

let workspace = "";
let home = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-search-workspace-"));
  home = await mkdtemp(join(tmpdir(), "swarm-search-home-"));
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "math.ts"), "export const add = 1;\nconst other = 2;\n");
  await writeFile(join(workspace, "src", "text.ts"), "// add a comment\nexport const b = 3;\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

function search(input: Record<string, unknown>): Promise<ToolOutput> {
  const sandbox = createSandbox({
    workspaceRoot: workspace,
    homeDir: home,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  return createSearchTool(sandbox).execute(input);
}

describe("what a search reports", () => {
  it("names the file and the line for every match", async () => {
    const output = await search({ pattern: "add" });

    expect(output.text).toContain("src/math.ts:1:");
    expect(output.text).toContain("src/text.ts:1:");
    expect(output.facts).toMatchObject({ pattern: "add", matches: 2, truncated: false });
  });

  it("says so plainly when nothing matched, rather than returning an empty string", async () => {
    const output = await search({ pattern: "nowhere" });

    expect(output.text).toBe("no match for /nowhere/");
    expect(output.facts).toMatchObject({ matches: 0 });
  });

  it("counts matches as a fact, so a claim addresses the count and not the prose", async () => {
    // The facts are what a predicate reaches. Reading the count back out of the text would
    // make it a number the model was shown rather than one the harness measured.
    const output = await search({ pattern: "export" });

    expect(output.facts?.matches).toBe(2);
  });

  it("stops at the limit and says it truncated", async () => {
    const output = await search({ pattern: "e", maxResults: 1 });

    expect(output.facts).toMatchObject({ matches: 1, truncated: true });
    expect(output.text.split("\n")).toHaveLength(1);
  });

  it("searches under a named directory, and an empty path reads as the root", async () => {
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "note.md"), "add it to the list\n");

    const scoped = await search({ pattern: "add", path: "docs" });
    const rooted = await search({ pattern: "add", path: "  " });

    expect(scoped.facts?.matches).toBe(1);
    expect(scoped.text).toContain("docs/note.md:1:");
    expect(rooted.facts?.matches).toBe(3);
  });
});

describe("what a search refuses to run", () => {
  it("refuses a pattern that is not a regular expression, naming what it was given", async () => {
    await expect(search({ pattern: "(" })).rejects.toThrow(/is not a valid regular expression/);
  });

  it("refuses a pattern that could backtrack super-linearly, before it runs once", async () => {
    // The pattern runs per line on the main thread and a match that has started cannot be
    // interrupted, so this is refused rather than timed out.
    await expect(search({ pattern: "(a+)+$" })).rejects.toThrow(/was refused/);
  });

  it("tells the caller how to rewrite a refused pattern, not just that it was refused", async () => {
    await expect(search({ pattern: "(a|a)*b" })).rejects.toThrow(
      /Rewrite it without the ambiguity/,
    );
  });
});

describe("what a search declines to read", () => {
  it("skips a file carrying a NUL byte, and reads one that only looks binary", async () => {
    // The rule is the byte, not the extension. Both of these are `.bin` and only one is
    // binary, which is what makes this a test of the rule rather than of the name.
    await writeFile(join(workspace, "src", "binary.bin"), "add add\u0000\n");
    await writeFile(join(workspace, "src", "text.bin"), "add me\n");

    const output = await search({ pattern: "add" });

    expect(output.text).not.toContain("binary.bin");
    expect(output.text).toContain("src/text.bin:1:");
    expect(output.facts?.matches).toBe(3);
  });

  it("does not descend into the directories a code search has no business in", async () => {
    for (const directory of [".git", "node_modules", "dist", "coverage"]) {
      await mkdir(join(workspace, directory), { recursive: true });
      await writeFile(join(workspace, directory, "buried.ts"), "add\n");
    }

    const output = await search({ pattern: "add" });

    expect(output.facts?.matches).toBe(2);
    expect(output.text).not.toContain("node_modules");
  });

  it("does not read a file the sandbox denies, whatever the pattern matches", async () => {
    // The denylist rules on every descendant, so a credential path is never opened here.
    await writeFile(join(workspace, ".env"), "API_KEY=add-me\n");

    const output = await search({ pattern: "add" });

    expect(output.text).not.toContain(".env");
    expect(output.facts?.matches).toBe(2);
  });

  it("scans a very long line up to the cap rather than stalling on it", async () => {
    // A minified file is one line of any size. The cap is what keeps one of them from holding
    // the scan; a match past it is not reported, which is the honest consequence.
    await writeFile(join(workspace, "src", "min.ts"), `${"x".repeat(9_000)}needle\n`);

    const output = await search({ pattern: "needle" });

    expect(output.facts?.matches).toBe(0);
  });
});
