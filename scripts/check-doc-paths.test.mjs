import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDocumentationPaths } from "./check-doc-paths.mjs";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "doc-paths-"));
  await mkdir(join(root, "docs", "evidence"), { recursive: true });
  await mkdir(join(root, "src", "tools"), { recursive: true });
  await writeFile(join(root, "src", "tools", "chokepoint.ts"), "export const it = 1;\n");
  await writeFile(join(root, "docs", "evidence", "run.md"), "a run\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function doc(name, body) {
  await writeFile(join(root, "docs", name), body);
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
