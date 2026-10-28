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
    await writeFile(join(root, ".gitignore"), "dist/\neval/results/*/\n");
    await track();
    const found = await doc("a.md", "the runner writes `eval/results/run-1/`\n");

    expect(found.misses).toEqual([]);
    expect(found.generated.map((entry) => entry.raw)).toEqual(["eval/results/run-1/"]);
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

describe("a released changelog section", () => {
  async function released() {
    await writeFile(join(root, "src", "tools", "old.ts"), "export const old = 1;\n");
    await track();
    await run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "1.0.0"], {
      cwd: root,
    });
    await run("git", ["tag", "v1.0.0"], { cwd: root });
    await run("git", ["rm", "-q", "src/tools/old.ts"], { cwd: root });
  }

  it("resolves against the tree of its release tag", async () => {
    await released();
    await writeFile(join(root, "CHANGELOG.md"), "## 1.0.0 - 2026-01-01\n\n- `src/tools/old.ts`\n");
    await track();
    const found = await checkDocumentationPaths(root);
    expect(found.misses).toEqual([]);
  });

  it("does not lend that tree to the unreleased section", async () => {
    await released();
    await writeFile(join(root, "CHANGELOG.md"), "## 2.0.0 - unreleased\n\n- `src/tools/old.ts`\n");
    await track();
    const found = await checkDocumentationPaths(root);
    expect(found.misses.map((miss) => miss.raw)).toEqual(["src/tools/old.ts"]);
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
