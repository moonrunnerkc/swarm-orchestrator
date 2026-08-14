import { describe, expect, it } from "vitest";
import { commentColumns, commentTextAt } from "./comment-spans.ts";

/**
 * A comment is a property of the file, not of a line. These are the cases where reading one
 * line on its own gives the wrong answer in either direction.
 */

function columnsOf(lines: readonly string[]): readonly (number | null)[] {
  return commentColumns(lines.join("\n"));
}

describe("where a file's comments begin", () => {
  it("finds no comment on a line of plain code", () => {
    expect(columnsOf(["export const a = 1;"])).toEqual([null]);
  });

  it("finds a trailing line comment at the column it opens", () => {
    expect(columnsOf(["const a = 1; // why"])).toEqual([13]);
  });

  it("carries a block comment across the lines it spans", () => {
    expect(columnsOf(["/*", "   still inside", "*/", "const a = 1;"])).toEqual([0, 0, 0, null]);
  });

  it("closes a block comment on the line that ends it", () => {
    expect(columnsOf(["/* one */ const a = 1;", "const b = 2;"])).toEqual([0, null]);
  });

  it("reads a doc-comment body line as comment text even out of context", () => {
    expect(columnsOf(["  * decide this"])).toEqual([2]);
    expect(columnsOf(["  */"])).toEqual([null]);
  });

  it("does not read a comment marker inside a string literal", () => {
    expect(columnsOf(['const url = "https://example.com/#anchor";'])).toEqual([null]);
    expect(columnsOf(["const path = '/* not a comment */';"])).toEqual([null]);
  });

  it("does not read a rust attribute or a shebang as a comment", () => {
    expect(columnsOf(["#!/usr/bin/env node", "#[derive(Debug)]", "# an actual comment"])).toEqual([
      null,
      null,
      0,
    ]);
  });

  it("hands back the comment part of a line, so nothing has to track two coordinates", () => {
    const lines = ["const a = 1; // why", "/*", "  TODO: later", "*/"];
    const columns = columnsOf(lines);

    expect(commentTextAt(columns, lines, 1)).toBe("// why");
    expect(commentTextAt(columns, lines, 3)).toBe("  TODO: later");
    expect(commentTextAt(columns, lines, 99)).toBeNull();
  });
});
