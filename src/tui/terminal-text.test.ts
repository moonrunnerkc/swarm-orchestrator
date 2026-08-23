import { describe, expect, it } from "vitest";
import {
  displayWidth,
  firstLineToWidth,
  padToWidth,
  stripControlCharacters,
  truncateToWidth,
} from "./terminal-text.ts";

const escapeCharacter = "\u001b";

describe("stripControlCharacters", () => {
  it("shows a cursor-control sequence rather than obeying it", () => {
    expect(stripControlCharacters(`before${escapeCharacter}[2Jafter`)).toBe("before·[2Jafter");
  });

  it("replaces a control character with exactly one cell, so widths stay true", () => {
    expect(displayWidth(`a${escapeCharacter}b`)).toBe(3);
  });

  it("leaves ordinary text alone", () => {
    expect(stripControlCharacters("src/parse.ts")).toBe("src/parse.ts");
  });
});

describe("displayWidth", () => {
  it("counts a wide character as the two cells a terminal draws it in", () => {
    expect(displayWidth("日本語")).toBe(6);
  });

  it("counts an astral character once rather than once per UTF-16 unit", () => {
    expect("𝄞".length).toBe(2);
    expect(displayWidth("𝄞")).toBe(1);
  });

  it("counts a combining sequence as the one grapheme it renders as", () => {
    expect(displayWidth("é")).toBe(1);
  });
});

describe("truncateToWidth", () => {
  it("leaves text that fits alone", () => {
    expect(truncateToWidth("src/parse.ts", 20)).toBe("src/parse.ts");
  });

  it("never returns more cells than it was given", () => {
    for (const columns of [1, 2, 3, 4, 8, 20]) {
      expect(displayWidth(truncateToWidth("日本語のファイル名.ts", columns))).toBeLessThanOrEqual(
        columns,
      );
    }
  });

  it("cuts on a grapheme boundary rather than splitting a surrogate pair", () => {
    const cut = truncateToWidth("𝄞𝄞𝄞𝄞𝄞𝄞", 5);
    expect(cut).toBe("𝄞𝄞...");
    expect(cut.includes("�")).toBe(false);
  });

  it("returns nothing at all for a width of zero", () => {
    expect(truncateToWidth("anything", 0)).toBe("");
  });

  it("fits the marker into a width smaller than the marker itself", () => {
    expect(truncateToWidth("anything", 2)).toBe("..");
  });
});

describe("firstLineToWidth", () => {
  it("keeps the first line of a multi-line payload", () => {
    expect(firstLineToWidth("1 failing\nAssertionError", 40)).toBe("1 failing");
  });
});

describe("padToWidth", () => {
  it("pads a wide string to the exact cell count", () => {
    expect(displayWidth(padToWidth("日本", 10))).toBe(10);
  });

  it("truncates rather than overflowing when the text is longer than the column", () => {
    expect(displayWidth(padToWidth("a-very-long-gate-id", 8))).toBe(8);
  });
});
