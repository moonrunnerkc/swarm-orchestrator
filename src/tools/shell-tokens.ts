import { type PendingHeredoc, readHeredocStart, skipHeredocBodies } from "./heredoc.ts";
import { readQuoted } from "./quoted-words.ts";

/** Characters whose effect a shell decides, so a string carrying one is not read here. */
const decidedByTheShell = new Set(["$", "`", "(", ")", "{", "}"]);

/** What joins a simple command to the one before it. */
export type ShellOperator = ";" | "&&" | "||" | "|";

export type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "separator"; readonly operator: ShellOperator }
  | { readonly kind: "redirect" }
  | { readonly kind: "heredoc"; body: string };

/** The string split as `/bin/sh` would split it, or null where only a shell could say. */
export function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let word = "";
  let building = false;
  let heredocs: PendingHeredoc[] = [];

  const flush = (): void => {
    if (building) {
      tokens.push({ kind: "word", text: word });
      word = "";
      building = false;
    }
  };

  for (let at = 0; at < command.length; at += 1) {
    const character = command[at] ?? "";

    // A hash that starts a word opens a comment, which runs nothing, to the end of its line.
    if (character === "#" && !building) {
      const end = command.indexOf("\n", at);
      at = (end === -1 ? command.length : end) - 1;
      continue;
    }

    if (decidedByTheShell.has(character)) {
      return null;
    }

    if (character === "\\") {
      const escaped = command[at + 1];
      if (escaped === undefined) {
        return null;
      }
      word += escaped;
      building = true;
      at += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      const quoted = readQuoted(command, at);
      if (quoted === null) return null;
      word += quoted.text;
      building = true;
      at = quoted.end;
      continue;
    }

    if (character === " " || character === "\t") {
      flush();
      continue;
    }

    if (character === ";" || character === "\n") {
      flush();
      tokens.push({ kind: "separator", operator: ";" });
      if (character === "\n" && heredocs.length > 0) {
        const consumed = skipHeredocBodies(command, at + 1, heredocs);
        if (consumed === null) return null;
        heredocs = [];
        at = consumed;
      }
      continue;
    }

    if (character === "|" || character === "&") {
      flush();
      const doubled = command[at + 1] === character;
      // A lone `&` backgrounds the command, which outlives everything measured around it.
      if (character === "&" && !doubled) {
        return null;
      }
      if (doubled) {
        at += 1;
      }
      tokens.push({
        kind: "separator",
        operator: character === "&" ? "&&" : doubled ? "||" : "|",
      });
      continue;
    }

    if (character === "<" && command[at + 1] === "<") {
      flush();
      const opened = command[at + 2] === "<" ? null : readHeredocStart(command, at);
      if (opened === null) return null;
      const token = { kind: "heredoc" as const, body: "" };
      tokens.push(token);
      heredocs.push({ ...opened.heredoc, token });
      at = opened.end;
      continue;
    }

    if (character === "<" || character === ">") {
      // `2>` carries its descriptor in the digits immediately before the operator, and those
      // digits are part of the redirect rather than a word of their own.
      if (/^\d+$/.test(word)) {
        word = "";
        building = false;
      }
      flush();
      let after = at + 1;
      if (command[after] === ">") {
        after += 1;
      }
      if (command[after] === "&") {
        after += 1;
        const duplicated = /^(\d+|-)(?=$|[\s;|&<>])/.exec(command.slice(after));
        if (duplicated !== null) {
          // `2>&1` duplicates a descriptor and `>&-` closes one: neither names a file.
          at = after + duplicated[0].length - 1;
          continue;
        }
        // `>&name` is bash's spelling of both streams into the file `name`.
      }
      at = after - 1;
      tokens.push({ kind: "redirect" });
      continue;
    }

    word += character;
    building = true;
  }

  flush();
  // A heredoc whose body never arrived leaves the command waiting on input it was not given.
  if (heredocs.length > 0) return null;
  return tokens.every(expandable) ? tokens : null;
}

/**
 * A tilde this reader cannot expand names another user's home directory, which is a path it has
 * no business ruling on either way.
 */
function expandable(token: Token): boolean {
  return token.kind !== "word" || !token.text.startsWith("~") || /^~($|\/)/.test(token.text);
}
