import { describe, expect, it } from "vitest";
import { glyphsFor } from "./glyphs.ts";

/**
 * The status marks the timeline and the gate strip draw. Unicode where the terminal can be
 * expected to show it, ASCII where it cannot, and the same set either way so the
 * layout tests hold whichever is chosen.
 */
describe("status glyphs", () => {
  it("are unicode under a UTF-8 locale on a capable terminal", () => {
    expect(glyphsFor({ LANG: "en_US.UTF-8", TERM: "xterm-256color" })).toEqual({
      done: "✓",
      failed: "✗",
      pending: "○",
      active: "◐",
      bullet: "◆",
      separator: " \u00b7 ",
    });
  });

  it("fall back to ASCII where the locale is not UTF-8 or the terminal is dumb", () => {
    const ascii = {
      done: "+",
      failed: "x",
      pending: "-",
      active: ">",
      bullet: "*",
      separator: "  ",
    };
    expect(glyphsFor({ LANG: "C", TERM: "xterm" })).toEqual(ascii);
    expect(glyphsFor({ LC_ALL: "POSIX", LANG: "en_US.UTF-8", TERM: "xterm" })).toEqual(ascii);
    expect(glyphsFor({ LANG: "en_US.UTF-8", TERM: "dumb" })).toEqual(ascii);
    expect(glyphsFor({})).toEqual(ascii);
  });

  it("read LC_ALL over LC_CTYPE over LANG, as a terminal does", () => {
    expect(glyphsFor({ LANG: "C", LC_CTYPE: "en_GB.UTF-8", TERM: "xterm" }).done).toBe("✓");
    expect(glyphsFor({ LANG: "en_US.UTF-8", LC_CTYPE: "C", TERM: "xterm" }).done).toBe("+");
  });
});
