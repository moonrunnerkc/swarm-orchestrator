/**
 * Where a file's comments begin, line by line. A check about comment position needs the whole
 * file, not one line: a marker on its own line inside a block comment is in comment position
 * to every reader, and a line read on its own has no way to know that.
 *
 * Blunt on purpose. This is a cheap positional check, not a parser: a quote is closed at the
 * end of its line, and a `/*` inside a regular expression opens a comment here. Both err
 * toward calling something a comment, which is the direction that flags a marker rather than
 * the direction that misses one.
 */

interface BlockComment {
  readonly open: string;
  readonly close: string;
}

const blockComments: readonly BlockComment[] = [
  { open: "/*", close: "*/" },
  { open: "<!--", close: "-->" },
];

const lineComments: readonly string[] = ["//", "--"];

const quotes = new Set(['"', "'", "`"]);

/**
 * The column each line's comment content starts at, or null where the line has none. Zero
 * means the whole line sits inside a comment that opened on an earlier one.
 */
export function commentColumns(text: string): readonly (number | null)[] {
  const lines = text.split("\n");
  const columns: (number | null)[] = lines.map(() => null);
  let block: BlockComment | null = null;

  lines.forEach((line, index) => {
    if (block !== null) {
      columns[index] = 0;
    }
    // A line whose first character is a lone `*` is a doc-comment body, even where the block
    // it belongs to is not in view. Nothing else in these languages starts a line that way.
    const continuation = /^\s*\*(?!\/)/.exec(line);
    if (continuation !== null) {
      columns[index] ??= continuation[0].length - 1;
    }
    let quote: string | null = null;

    for (let at = 0; at < line.length; at += 1) {
      const character = line[at] ?? "";

      if (block !== null) {
        if (line.startsWith(block.close, at)) {
          at += block.close.length - 1;
          block = null;
        }
        continue;
      }
      if (quote !== null) {
        if (character === "\\") {
          at += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (quotes.has(character)) {
        quote = character;
        continue;
      }

      const opened = blockComments.find((kind) => line.startsWith(kind.open, at));
      if (opened !== undefined) {
        columns[index] ??= at;
        at += opened.open.length - 1;
        block = opened;
        continue;
      }
      if (lineComments.some((marker) => line.startsWith(marker, at)) || hashComment(line, at)) {
        columns[index] ??= at;
        return;
      }
    }
  });

  return columns;
}

/** `#` opens a comment, but `#[` is a Rust attribute and `#!` is a shebang or an inner one. */
function hashComment(line: string, at: number): boolean {
  return line[at] === "#" && line[at + 1] !== "[" && line[at + 1] !== "!";
}

/**
 * The comment part of one line, or null when it has none. Callers search this rather than
 * comparing a marker's index to a column, so nothing has to keep two sets of coordinates in
 * step once the text has been normalized.
 */
export function commentTextAt(
  columns: readonly (number | null)[],
  lines: readonly string[],
  lineNumber: number,
): string | null {
  const column = columns[lineNumber - 1];
  const line = lines[lineNumber - 1];
  return column === null || column === undefined || line === undefined ? null : line.slice(column);
}
