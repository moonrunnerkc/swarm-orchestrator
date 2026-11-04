import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFileEdit, applyReplacements, readEditBlock, readWriteBlock } from "./file-edit.ts";

const pair = (search: string, replace: string) =>
  ["<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE"].join("\n");

describe("reading an edit block", () => {
  it("reads one or more SEARCH and REPLACE parts, lines kept as written", () => {
    expect(readEditBlock("src/a.ts", `${pair("  a", "  b")}\n${pair("c\nd", "")}`)).toEqual({
      mode: "edit",
      path: "src/a.ts",
      pairs: [
        { search: "  a", replace: "  b" },
        { search: "c\nd", replace: "" },
      ],
    });
  });

  it("takes quotes off the path", () => {
    expect(readEditBlock('"src/a b.ts"', pair("a", "b"))).toMatchObject({ path: "src/a b.ts" });
  });

  it("refuses a block it cannot read as pairs", () => {
    expect(readEditBlock("", pair("a", "b"))).toEqual({
      malformed: "the edit block names no file after `edit`",
    });
    expect(readEditBlock("a.ts", "a\n")).toMatchObject({
      malformed: expect.stringContaining("outside"),
    });
    expect(readEditBlock("a.ts", "<<<<<<< SEARCH\na\n=======\nb")).toMatchObject({
      malformed: expect.stringContaining("not closed"),
    });
    expect(readEditBlock("a.ts", pair("", "b"))).toMatchObject({
      malformed: expect.stringContaining("SEARCH part is empty"),
    });
  });

  it("ends a written file with a newline", () => {
    expect(readWriteBlock("a.txt", "one\ntwo")).toEqual({
      mode: "write",
      path: "a.txt",
      content: "one\ntwo\n",
    });
  });
});

describe("replacing exactly once", () => {
  it("replaces each part in order", () => {
    expect(
      applyReplacements("a\nb\nc\n", [
        { search: "a", replace: "x" },
        { search: "x\nb", replace: "y" },
      ]),
    ).toEqual({ text: "y\nc\n" });
  });

  it("refuses a part that matches nothing, or several places", () => {
    expect(applyReplacements("a\n", [{ search: "b", replace: "c" }])).toMatchObject({
      refused: expect.stringContaining("matches nothing"),
    });
    expect(applyReplacements("a a\n", [{ search: "a", replace: "c" }])).toMatchObject({
      refused: expect.stringContaining("matches 2 places"),
    });
    expect(applyReplacements("aaa", [{ search: "aa", replace: "c" }])).toMatchObject({
      refused: expect.stringContaining("matches 2 places"),
    });
  });

  it("changes nothing when a later part is refused", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "edit-")), "a.txt");
    await writeFile(file, "a\nb\n");
    const result = await applyFileEdit(file, {
      mode: "edit",
      path: "a.txt",
      pairs: [
        { search: "a", replace: "x" },
        { search: "missing", replace: "y" },
      ],
    });
    expect(result).toMatchObject({
      applied: false,
      refused: expect.stringContaining("SEARCH part 2"),
    });
    expect(await readFile(file, "utf8")).toBe("a\nb\n");
  });

  it("creates a file and its directories, and will not replace in a file that is not there", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-"));
    expect(
      await applyFileEdit(join(root, "a", "b.txt"), {
        mode: "write",
        path: "a/b.txt",
        content: "x\n",
      }),
    ).toMatchObject({ applied: true, summary: "created a/b.txt, 1 line", before: null });
    expect(await readFile(join(root, "a", "b.txt"), "utf8")).toBe("x\n");
    expect(
      await applyFileEdit(join(root, "c.txt"), {
        mode: "edit",
        path: "c.txt",
        pairs: [{ search: "a", replace: "b" }],
      }),
    ).toMatchObject({
      applied: false,
      refused: expect.stringContaining("a write block creates one"),
    });
  });

  // The installed 16.0.3 dossier run (session 20261104T141857-20e7e3): the model wrote its fence as
  // ```edit path=src/adversarial/fs-walk.ts, was told "path=src/adversarial/fs-walk.ts does not
  // exist", checked that the file existed, and sent the same block five times more.
  it("quotes the path as it read it when no file is there, and says how a fence names one", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-"));
    await writeFile(join(root, "fs-walk.ts"), "const a = 1;\n");
    const block = readEditBlock("path=fs-walk.ts", pair("const a = 1;", "const a = 2;"));
    if ("malformed" in block) throw new Error(block.malformed);
    const refused = await applyFileEdit(join(root, block.path), block);
    expect(refused).toMatchObject({ applied: false });
    const said = "refused" in refused ? refused.refused : "";
    expect(said).toContain('no file at "path=fs-walk.ts"');
    expect(said).toContain("```edit src/app.ts");
  });
});
