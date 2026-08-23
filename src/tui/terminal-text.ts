/**
 * Turning arbitrary text into something safe to put in a row of N terminal columns. Two
 * hazards live here. Tool output reaches the screen, so a payload carrying cursor control
 * would move the cursor rather than be read; and a path is measured in columns rather than
 * in UTF-16 units, so slicing one by code unit splits a surrogate pair and corrupts the row.
 */

const ellipsis = "...";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The code point ranges a terminal draws two cells wide: East Asian Wide and Fullwidth, plus
 * the emoji blocks. Not the whole Unicode table, which moves every year; these cover what a
 * file path, a model id, or a test name actually carries.
 */
const doubleWidthRanges: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
];

function isDoubleWidth(codePoint: number): boolean {
  return doubleWidthRanges.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/** C0, DEL and C1. Everything in here either moves the cursor or paints, and none of it reads. */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** What a control character is shown as: one cell, so the row keeps the width it was measured at. */
const controlStandIn = "·";

/**
 * Control characters replaced one for one, so a payload carrying an escape sequence is read
 * as text rather than obeyed. Every string reaching a cell goes through here first.
 */
export function stripControlCharacters(text: string): string {
  let safe = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    safe += isControl(codePoint) ? controlStandIn : character;
  }
  return safe;
}

/** How many terminal cells the text occupies once it is safe to print. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of graphemes.segment(stripControlCharacters(text))) {
    width += isDoubleWidth(segment.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/**
 * At most `columns` cells, cut on a grapheme boundary and marked wherever anything was
 * dropped. A width under the marker's own returns the marker cut to fit rather than
 * overflowing the row it was supposed to fit inside.
 */
export function truncateToWidth(text: string, columns: number): string {
  const safe = stripControlCharacters(text);
  if (columns <= 0) {
    return "";
  }
  if (displayWidth(safe) <= columns) {
    return safe;
  }

  const budget = columns - ellipsis.length;
  if (budget <= 0) {
    return ellipsis.slice(0, columns);
  }

  let kept = "";
  let width = 0;
  for (const { segment } of graphemes.segment(safe)) {
    const cells = isDoubleWidth(segment.codePointAt(0) ?? 0) ? 2 : 1;
    if (width + cells > budget) {
      break;
    }
    kept += segment;
    width += cells;
  }
  return `${kept}${ellipsis}`;
}

/** The first line only, truncated. What one stream row shows of a multi-line payload. */
export function firstLineToWidth(text: string, columns: number): string {
  return truncateToWidth(text.split("\n", 1)[0] ?? "", columns);
}

/** Right-padded to exactly `columns` cells, so the columns of a strip line up. */
export function padToWidth(text: string, columns: number): string {
  const cut = truncateToWidth(text, columns);
  return cut + " ".repeat(Math.max(0, columns - displayWidth(cut)));
}
