import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPolicyGuard } from "./policy-guard.ts";
import { createSearchTool } from "./search-tool.ts";

/**
 * The tool body rather than the chokepoint in front of it. What is exercised here is the walk:
 * which files it descends into, which it refuses to read, where it stops, and what it does with
 * a pattern the ReDoS guard will not allow to run.
 */

let workspace = "";
let home = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-search-workspace-"));
  home = await mkdtemp(join(tmpdir(), "swarm-search-home-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function write(relativePath: string, contents: string): Promise<void> {
  const absolute = join(workspace, relativePath);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, contents);
}

function search() {
  const guard = createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: home,
    shellAllowlist: [],
    deniedRoots: [],
  });
  return createSearchTool(guard);
}

async function run(input: Record<string, unknown>) {
  return await search().execute(input);
}

describe("what the search finds", () => {
  it("reports the file, the line number and the line", async () => {
    await write("src/greet.mjs", "export const greet = () => 'hello';\n");

    const outcome = await run({ pattern: "greet" });

    expect(outcome.text).toContain("src/greet.mjs:1:");
    expect(outcome.text).toContain("export const greet");
    expect(outcome.facts).toMatchObject({ pattern: "greet", matches: 1, truncated: false });
  });

  it("says so plainly when nothing matches", async () => {
    await write("src/greet.mjs", "export const greet = () => 'hello';\n");

    const outcome = await run({ pattern: "farewell" });

    expect(outcome.text).toBe("no match for /farewell/");
    expect(outcome.facts).toMatchObject({ matches: 0 });
  });

  it("descends into subdirectories", async () => {
    await write("a/b/c/deep.mjs", "const marker = 1;\n");

    const outcome = await run({ pattern: "marker" });

    expect(outcome.text).toContain(join("a", "b", "c", "deep.mjs"));
  });

  it("searches only under the directory it was pointed at", async () => {
    await write("kept/one.mjs", "marker\n");
    await write("other/two.mjs", "marker\n");

    const outcome = await run({ pattern: "marker", path: "kept" });

    expect(outcome.text).toContain("one.mjs");
    expect(outcome.text).not.toContain("two.mjs");
  });

  it("reads an empty path as the workspace root, the way an absent one is read", async () => {
    await write("one.mjs", "marker\n");

    expect((await run({ pattern: "marker", path: "  " })).facts).toMatchObject({ matches: 1 });
  });
});

describe("what the search will not read", () => {
  it("skips the directories a code search has no business walking", async () => {
    await write("node_modules/pkg/index.js", "marker\n");
    await write("dist/bundle.js", "marker\n");
    await write(".git/COMMIT_EDITMSG", "marker\n");
    await write("coverage/report.txt", "marker\n");
    await write("src/real.mjs", "marker\n");

    const outcome = await run({ pattern: "marker" });

    expect(outcome.facts).toMatchObject({ matches: 1 });
    expect(outcome.text).toContain("real.mjs");
  });

  it("skips a file carrying a NUL byte, which is what binary looks like from here", async () => {
    // The NUL is written from its code point rather than pasted in. An invisible control
    // character in a fixture is a fixture nobody can review: the first spelling of this test
    // carried one by accident and passed for a reason its own source did not show.
    await write("src/blob.bin", `before${String.fromCharCode(0)}marker after`);
    await write("src/real.mjs", "marker\n");

    const outcome = await run({ pattern: "marker" });

    expect(outcome.facts).toMatchObject({ matches: 1 });
    expect(outcome.text).not.toContain("blob.bin");
  });

  it("reads a text file whatever its extension, because the rule is the NUL and not the name", async () => {
    await write("src/notes.bin", "marker in plain text\n");

    expect((await run({ pattern: "marker" })).facts).toMatchObject({ matches: 1 });
  });

  it("does not read a file the guard denies", async () => {
    // The denylist is the same one the read tool answers to, and the walk asks about every
    // descendant, so a denied file is never opened rather than opened and filtered.
    await write(".env", "API_KEY=marker\n");
    await write("src/real.mjs", "marker\n");

    const outcome = await run({ pattern: "marker" });

    expect(outcome.facts).toMatchObject({ matches: 1 });
    expect(outcome.text).not.toContain(".env");
  });
});

describe("where the search stops", () => {
  it("stops at the result limit and says it was truncated", async () => {
    for (let index = 0; index < 12; index += 1) {
      await write(`f${index}.mjs`, "marker\n");
    }

    const outcome = await run({ pattern: "marker", maxResults: 5 });

    expect(outcome.facts).toMatchObject({ matches: 5, truncated: true });
    expect(outcome.text.split("\n")).toHaveLength(5);
  });

  it("stops at the limit inside one long file too", async () => {
    await write("many.mjs", Array.from({ length: 40 }, () => "marker").join("\n"));

    expect((await run({ pattern: "marker", maxResults: 3 })).facts).toMatchObject({
      matches: 3,
      truncated: true,
    });
  });

  it("scans only the first 8000 characters of a line, so a minified file cannot stall it", async () => {
    await write("min.js", `${"a".repeat(8_100)}marker\n`);

    expect((await run({ pattern: "marker" })).facts).toMatchObject({ matches: 0 });
  });
});

describe("a pattern the tool will not run", () => {
  it("refuses one that can backtrack super-linearly, before running it", async () => {
    await write("src/real.mjs", "aaaaaaaaaaaaaaaaaaaaaaaa!\n");

    // A match that has started cannot be interrupted, so the refusal has to happen first.
    await expect(run({ pattern: "(a+)+$" })).rejects.toThrow(/was refused/);
  });

  it("names what to do instead rather than only that it said no", async () => {
    await expect(run({ pattern: "(a|a)*$" })).rejects.toThrow(/Rewrite it without the ambiguity/);
  });

  it("reports a pattern that is not a regular expression at all", async () => {
    await expect(run({ pattern: "[unclosed" })).rejects.toThrow(
      /is not a valid regular expression/,
    );
  });
});
