import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDocumentationPaths } from "./check-doc-paths.mjs";

const run = promisify(execFile);

let root = "";

/** A real repository, because the check resolves against what git tracks rather than the disk. */
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "doc-paths-"));
  await run("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "docs", "evidence"), { recursive: true });
  await mkdir(join(root, "src", "tools"), { recursive: true });
  await writeFile(join(root, "src", "tools", "chokepoint.ts"), "export const it = 1;\n");
  await writeFile(join(root, "docs", "evidence", "run.md"), "a run\n");
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await track();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function track() {
  await run("git", ["add", "-A"], { cwd: root });
}

async function doc(name, body) {
  await writeFile(join(root, "docs", name), body);
  await track();
  return checkDocumentationPaths(root);
}

describe("what counts as a pointer", () => {
  it("follows a markdown link relative to the file that holds it", async () => {
    const found = await doc("a.md", "see [the run](evidence/run.md)\n");
    expect(found.misses).toEqual([]);
  });

  // The pass5 defect: a document pointing at a file that is not there.
  it("reports a markdown link that resolves to nothing", async () => {
    const found = await doc("a.md", "see [the run](evidence/gone.md)\n");
    expect(found.misses.map((miss) => miss.raw)).toEqual(["evidence/gone.md"]);
    expect(found.misses[0].kind).toBe("link");
  });

  it("resolves a rooted mention against the repository root, from any directory", async () => {
    const found = await doc("a.md", "the chokepoint is `src/tools/chokepoint.ts`\n");
    expect(found.misses).toEqual([]);
  });

  it("reports a rooted mention that resolves to nothing", async () => {
    const found = await doc("a.md", "the parser is `src/tools/gone.ts`\n");
    expect(found.misses.map((miss) => miss.raw)).toEqual(["src/tools/gone.ts"]);
  });

  it("resolves a directory by the files tracked under it", async () => {
    const found = await doc("a.md", "the tools live in `src/tools/`\n");
    expect(found.misses).toEqual([]);
  });
});

describe("a file on the disk and in no commit", () => {
  /**
   * The defect this covers, found by CI rather than here: an earlier spelling resolved against
   * the filesystem, so a pointer that only ever worked on the machine that wrote it passed at
   * home and failed on a clean checkout. Which is the same broken pointer to every reader.
   */
  it("is a miss, however present it is locally", async () => {
    await writeFile(join(root, "docs", "a.md"), "see `src/untracked/local.ts`\n");
    await track();
    // Written after the index was last updated, so it is on the disk and in no commit.
    await mkdir(join(root, "src", "untracked"), { recursive: true });
    await writeFile(join(root, "src", "untracked", "local.ts"), "export const a = 1;\n");

    const found = await checkDocumentationPaths(root);
    expect(found.misses.map((miss) => miss.raw)).toEqual(["src/untracked/local.ts"]);
  });

  it("is reported as generated, not as a miss, where git ignores it", async () => {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "cli.js"), "// built\n");
    const found = await doc("a.md", "the build lands in `dist/`\n");

    expect(found.misses).toEqual([]);
    expect(found.generated.map((entry) => entry.raw)).toEqual(["dist/"]);
  });

  /**
   * The clean checkout, which is where the first two attempts at this went wrong. A
   * directory-only ignore pattern matches `dist/` on any checkout and matches `dist` only
   * where the directory happens to exist, so asking about the stripped name answered one way
   * on the machine that had built the tree and another way in CI.
   */
  it("is generated on a checkout where nothing has built it yet", async () => {
    const found = await doc("a.md", "the build lands in `dist/`\n");

    expect(found.misses).toEqual([]);
    expect(found.generated.map((entry) => entry.raw)).toEqual(["dist/"]);
  });

  it("is generated for a nested pattern nothing has created either", async () => {
    await writeFile(join(root, ".gitignore"), "dist/\nredteam/loop/state-*/\n");
    await track();
    const found = await doc("a.md", "the driver writes `redteam/loop/state-wake/`\n");

    expect(found.misses).toEqual([]);
    expect(found.generated.map((entry) => entry.raw)).toEqual(["redteam/loop/state-wake/"]);
  });
});

describe("what is not a pointer, and must not be reported as one", () => {
  it("leaves a bare name alone, since prose names things rather than locating them", async () => {
    const found = await doc("a.md", "run `verify.mjs`, edit `swarm.toml`, read `live.md`\n");
    expect(found.misses).toEqual([]);
  });

  it("leaves a fragment of a path alone", async () => {
    const found = await doc("a.md", "the embedded one is `verifier/verify.mjs`\n");
    expect(found.misses).toEqual([]);
  });

  it("leaves somewhere else entirely alone", async () => {
    const found = await doc("a.md", "sessions live in `~/.swarm/sessions/`\n");
    expect(found.misses).toEqual([]);
  });

  it("leaves a path at a revision alone, which is what a colon spells", async () => {
    const found = await doc("a.md", "it holds `schema-v1:src/contract/schema/v1.json`\n");
    expect(found.misses).toEqual([]);
  });

  it("leaves a command, a flag and a URL alone", async () => {
    const found = await doc(
      "a.md",
      "run `node scripts/x.mjs .`, pass `--no-tui`, see [it](https://example.com/a.md)\n",
    );
    expect(found.misses).toEqual([]);
  });
});

describe("a path a document names in order to say it is gone", () => {
  it("is reported as known rather than as a miss, with the reason", async () => {
    const found = await doc("a.md", "`redteam/leep/` removed (empty and untracked)\n");

    expect(found.misses).toEqual([]);
    expect(found.known.map((entry) => entry.raw)).toEqual(["redteam/leep/"]);
    expect(found.known[0].reason).toContain("removed by the 08-18 run");
  });

  it("does not let any other missing path through with it", async () => {
    const found = await doc("a.md", "`redteam/leep/` is gone, and so is `src/tools/gone.ts`\n");

    expect(found.misses.map((miss) => miss.raw)).toEqual(["src/tools/gone.ts"]);
    expect(found.known).toHaveLength(1);
  });
});

describe("what it reports", () => {
  it("counts what it resolved as well as what it could not", async () => {
    const found = await doc(
      "a.md",
      "see [the run](evidence/run.md) and `src/tools/chokepoint.ts`\n",
    );
    expect(found.checked).toBe(2);
    expect(found.fileCount).toBeGreaterThanOrEqual(2);
  });
});
