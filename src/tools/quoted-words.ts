/** What a backslash escapes inside double quotes; before anything else it is itself (POSIX). */
const escapable = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * The quoted string opening at `start`, read as the shell reads it: its text, and the index of
 * its closing quote. Single quotes hold everything literally. Double quotes still expand, so they
 * are read only where nothing in them would: null there, and where the string never closes.
 */
export function readQuoted(
  command: string,
  start: number,
): { readonly text: string; readonly end: number } | null {
  if (command[start] === "'") {
    const end = command.indexOf("'", start + 1);
    return end === -1 ? null : { text: command.slice(start + 1, end), end };
  }
  let text = "";
  for (let at = start + 1; at < command.length; at += 1) {
    const character = command[at] ?? "";
    if (character === '"') return { text, end: at };
    if (character === "$" || character === "`") return null;
    const next = command[at + 1];
    if (character === "\\" && next !== undefined && escapable.has(next)) {
      // An escaped newline joins the lines and leaves nothing.
      if (next !== "\n") text += next;
      at += 1;
      continue;
    }
    text += character;
  }
  return null;
}
