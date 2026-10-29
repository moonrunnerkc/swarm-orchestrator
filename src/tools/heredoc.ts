/** A heredoc whose body starts after the current line: its delimiter and how it is read. */
export interface PendingHeredoc {
  /** Filled with the body once the line that opened it ends. */
  readonly token?: { body: string };
  readonly delimiter: string;
  /** A quoted delimiter makes the body literal; an unquoted one lets the shell expand it. */
  readonly literal: boolean;
  readonly stripTabs: boolean;
}

/**
 * Reads `<<WORD`, `<<'WORD'`, `<<"WORD"` or `<<-WORD` starting at the first `<`. Returns the
 * heredoc and the index of its last character, or null where it cannot be read.
 */
export function readHeredocStart(
  command: string,
  at: number,
): { readonly heredoc: PendingHeredoc; readonly end: number } | null {
  let next = at + 2;
  const stripTabs = command[next] === "-";
  if (stripTabs) next += 1;
  while (command[next] === " " || command[next] === "\t") next += 1;
  const quote = command[next];
  if (quote === "'" || quote === '"') {
    const closes = command.indexOf(quote, next + 1);
    const delimiter = closes === -1 ? "" : command.slice(next + 1, closes);
    return delimiter.length === 0 || /\s/.test(delimiter)
      ? null
      : { heredoc: { delimiter, literal: true, stripTabs }, end: closes };
  }
  const bare = /^[A-Za-z0-9_]+/.exec(command.slice(next));
  if (bare === null) return null;
  return {
    heredoc: { delimiter: bare[0], literal: false, stripTabs },
    end: next + bare[0].length - 1,
  };
}

/**
 * Skips the bodies of the heredocs a line opened, starting after its newline. A body is data
 * for the command, not more commands, so it names nothing to rule on; an unquoted body that
 * would expand a substitution is unreadable instead. Returns the index of the last character
 * consumed, or null.
 */
export function skipHeredocBodies(
  command: string,
  from: number,
  pending: readonly PendingHeredoc[],
): number | null {
  let start = from;
  for (const heredoc of pending) {
    for (;;) {
      if (start > command.length) return null;
      const newline = command.indexOf("\n", start);
      const line = command.slice(start, newline === -1 ? command.length : newline);
      if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) {
        start = newline === -1 ? command.length : newline + 1;
        break;
      }
      if (heredoc.token !== undefined) heredoc.token.body += `${line}\n`;
      if (!heredoc.literal && /[$`]/.test(line)) return null;
      if (newline === -1) return null;
      start = newline + 1;
    }
  }
  return start - 1;
}
