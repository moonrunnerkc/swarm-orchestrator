import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFileEdit,
  applyReplacements,
  closestLines,
  readEditBlock,
  readWriteBlock,
  whereItDiffers,
} from "./file-edit.ts";

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

// ironroot (2026-11-04, session 20261105T081734-bfcef7): a SEARCH that joined a signature the
// file spreads over two lines was refused four times with only "copy the lines exactly".
describe("a SEARCH part that matches nothing", () => {
  it("is refused with the file's closest lines, numbered as in the file", () => {
    const file = [
      "import x",
      "",
      "async def _falsify_artifact_hash_stability(",
      "    session: AsyncSession, run_id: str",
      ") -> FalsificationAttempt:",
      '    """Every artifact hashes to its content hash."""',
      "    return None",
    ].join("\n");
    const search = [
      "async def _falsify_artifact_hash_stability(session: AsyncSession, run_id: str) -> FalsificationAttempt:",
      '    """Every artifact hashes to its content hash."""',
      "    return None",
    ].join("\n");
    const result = applyReplacements(file, [{ search, replace: "" }]);
    expect(result).toEqual({
      refused: [
        "the SEARCH part matches nothing in the file; copy the lines exactly as the file has them, whitespace included. The file's closest lines, numbered as in the file:",
        "    5  ) -> FalsificationAttempt:",
        '    6      """Every artifact hashes to its content hash."""',
        "    7      return None",
        "",
      ].join("\n"),
    });
    expect(closestLines("nothing alike", "zzz")).toBe("");
  });
});

describe("where a SEARCH part parts from the file", () => {
  it("names its first differing line beside the file's, and advises parts for a long one", () => {
    const file = ["a", "def f(", "    x,", "):", "    return x", "z"].join("\n");
    const search = ["def f(", "    x,", ") -> int:", "    return x"].join("\n");
    expect(whereItDiffers(file, search)).toBe(
      '. Its first 2 line(s) match the file from line 2; its line 3 reads ") -> int:", where the file\'s line 4 reads "):".\n',
    );
    const long = Array.from({ length: 50 }, (_, at) => `line ${at}`);
    const drifted = [...long.slice(0, 45), "  line 45", ...long.slice(46)].join("\n");
    expect(whereItDiffers(long.join("\n"), drifted)).toMatch(
      /its line 46 reads " {2}line 45", where the file's line 46 reads "line 45" \(they differ only in whitespace\)\. A SEARCH of 50 lines is hard to copy exactly/,
    );
    expect(whereItDiffers("q", "nothing here")).toBeNull();
  });
});
