/**
 * The status marks the timeline and the gate strip draw: done, failed, pending, in progress,
 * and a bullet for a heading. Unicode where the terminal can be expected to show it, ASCII
 * where it cannot, and one set of five either way, so a layout measured with one holds with
 * the other.
 */
export interface Glyphs {
  readonly done: string;
  readonly failed: string;
  readonly pending: string;
  readonly active: string;
  readonly bullet: string;
}

const unicodeGlyphs: Glyphs = {
  done: "✓",
  failed: "✗",
  pending: "○",
  active: "◐",
  bullet: "◆",
};

const asciiGlyphs: Glyphs = { done: "+", failed: "x", pending: "-", active: ">", bullet: "*" };

interface LocaleEnvironment {
  readonly LANG?: string | undefined;
  readonly LC_ALL?: string | undefined;
  readonly LC_CTYPE?: string | undefined;
  readonly TERM?: string | undefined;
}

/** LC_ALL over LC_CTYPE over LANG, which is the order a terminal resolves its character set in. */
export function glyphsFor(env: LocaleEnvironment): Glyphs {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  const utf8 = /utf-?8/i.test(locale);
  return utf8 && env.TERM !== "dumb" ? unicodeGlyphs : asciiGlyphs;
}
