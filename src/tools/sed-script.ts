/** What a sed script does beyond editing the text that streams through it. */
export interface SedScriptEffects {
  /** The files it reads (`r`, `R`) or writes (`w`, `W`, and the `w` flag of `s`), as written. */
  readonly files: readonly string[];
  /** Whether it hands text to a shell (`e`, and the `e` flag of `s`), which nothing here reads. */
  readonly runsCommands: boolean;
}

/** Commands that take nothing after them, those that take an optional number, and those that take a file. */
const bareCommands = new Set([..."=dDgGhHnNpPxzF"]);
const numberedCommands = new Set([..."lLqQ"]);
const fileCommands = new Set([..."rRwW"]);

/**
 * The script read as sed reads it, or null where this reader cannot follow it.
 *
 * GNU and BSD sed disagree in a few places, and the reading has to hold for both. Where they
 * end a regular expression at different places (a delimiter inside a bracket expression, `[/]`),
 * the script is not followed. Where one reads a label up to a semicolon and the other to the end
 * of the line (`:a;N;$!ba`), the text after the semicolon is read as commands, so a file command
 * there is still found. A file name, the text of `a`, `i` and `c`, and an `e` command run to the
 * end of their line in both.
 */
export function readSedScript(script: string): SedScriptEffects | null {
  const files: string[] = [];
  let runsCommands = false;
  let at = 0;
  let depth = 0;

  const skipBlanks = (): void => {
    while (script[at] === " " || script[at] === "\t") at += 1;
  };
  const restOfLine = (): string => {
    const end = script.indexOf("\n", at);
    const text = script.slice(at, end === -1 ? script.length : end);
    at = end === -1 ? script.length : end;
    return text;
  };
  // After a command: blanks, then the end of the command or a comment.
  const ended = (): boolean => {
    skipBlanks();
    const next = script[at];
    return next === undefined || next === ";" || next === "\n" || next === "}" || next === "#";
  };

  while (at < script.length) {
    const character = script[at] ?? "";
    if (/[\s;]/.test(character)) {
      at += 1;
      continue;
    }
    if (character === "#") {
      restOfLine();
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth < 0) return null;
      at += 1;
      continue;
    }

    const addressed = readAddresses(script, at);
    if (addressed === null) return null;
    at = addressed.end;
    skipBlanks();
    while (script[at] === "!") {
      at += 1;
      skipBlanks();
    }

    const command = script[at] ?? "";
    at += 1;
    if (command === "{") {
      depth += 1;
    } else if (command === ":" || command === "b" || command === "t" || command === "T") {
      if (command === ":" && addressed.count > 0) return null;
      skipBlanks();
      const label = /^[\w.-]*/.exec(script.slice(at))?.[0] ?? "";
      if (command === ":" && label.length === 0) return null;
      at += label.length;
      if (!ended()) return null;
    } else if (command === "a" || command === "i" || command === "c") {
      skipBlanks();
      if (script[at] === "\\") at += 1;
      if (script[at] === "\n") at += 1;
      at = endOfText(script, at);
    } else if (fileCommands.has(command)) {
      const file = restOfLine().replace(/^[ \t]+/, "");
      if (file.length === 0) return null;
      files.push(file);
    } else if (command === "e") {
      runsCommands = true;
      restOfLine();
    } else if (command === "s" || command === "y") {
      const read = command === "s" ? readSubstitution(script, at) : readTransliteration(script, at);
      if (read === null) return null;
      at = read.end;
      if (read.runsCommands) runsCommands = true;
      if (read.writes) {
        const file = restOfLine().replace(/^[ \t]+/, "");
        if (file.length === 0) return null;
        files.push(file);
      } else if (!ended()) {
        return null;
      }
    } else if (numberedCommands.has(command) || command === "v") {
      skipBlanks();
      at += (/^[\d.]*/.exec(script.slice(at))?.[0] ?? "").length;
      if (!ended()) return null;
    } else if (bareCommands.has(command)) {
      if (!ended()) return null;
    } else {
      return null;
    }
  }
  return depth === 0 ? { files, runsCommands } : null;
}

/** The addresses before a command (none, one or a range), and where the command starts. */
function readAddresses(
  script: string,
  from: number,
): { readonly count: number; readonly end: number } | null {
  const first = readAddress(script, from, false);
  if (first === null) return null;
  if (first === from) return { count: 0, end: from };
  let at = first;
  while (script[at] === " " || script[at] === "\t") at += 1;
  if (script[at] !== ",") return { count: 1, end: first };
  at += 1;
  while (script[at] === " " || script[at] === "\t") at += 1;
  const second = readAddress(script, at, true);
  return second === null || second === at ? null : { count: 2, end: second };
}

/** The index after one address at `from`; `from` itself where there is none; null where it is malformed. */
function readAddress(script: string, from: number, second: boolean): number | null {
  const rest = script.slice(from);
  const numeric = (second ? /^([+~]?\d+)/ : /^(\d+(~\d+)?)/).exec(rest);
  if (numeric !== null) return from + numeric[0].length;
  if (rest.startsWith("$")) return from + 1;
  let end: number | null = null;
  if (rest.startsWith("/")) end = endOfPattern(script, from + 1, "/");
  else if (rest.startsWith("\\")) {
    const delimiter = script[from + 1];
    if (delimiter === undefined || delimiter === "\n" || delimiter === "\\") return null;
    end = endOfPattern(script, from + 2, delimiter);
  } else return from;
  if (end === null) return null;
  while (script[end] === "I" || script[end] === "M") end += 1;
  return end;
}

/**
 * The index after the delimiter closing a regular expression that starts at `from`, or null.
 * BSD sed reads a bracket expression whole and GNU sed does not, so a delimiter inside brackets
 * would end the expression in one and not the other; that script is not followed.
 */
function endOfPattern(script: string, from: number, delimiter: string): number | null {
  for (let at = from; at < script.length; at += 1) {
    const character = script[at];
    if (character === "\n") return null;
    if (character === "\\") {
      if (script[at + 1] === undefined || script[at + 1] === "\n") return null;
      at += 1;
    } else if (character === "[" && delimiter !== "[") {
      const closes = endOfBracket(script, at, delimiter);
      if (closes === null) return null;
      at = closes;
    } else if (character === delimiter) {
      return at + 1;
    }
  }
  return null;
}

/** The index of the `]` closing the bracket expression opened at `open`, or null. */
function endOfBracket(script: string, open: number, delimiter: string): number | null {
  let at = open + 1;
  if (script[at] === "^") at += 1;
  if (script[at] === "]") at += 1;
  for (; at < script.length; at += 1) {
    const character = script[at];
    if (character === "\n" || character === delimiter) return null;
    if (character === "]") return at;
    const inner = script[at + 1];
    if (character === "[" && (inner === ":" || inner === "." || inner === "=")) {
      const closes = script.indexOf(`${inner}]`, at + 2);
      if (closes === -1) return null;
      const name = script.slice(at, closes);
      if (name.includes("\n") || name.includes(delimiter)) return null;
      at = closes + 1;
    }
  }
  return null;
}

/** The index after the delimiter closing a replacement or a `y` set; a backslash escapes anything, a newline included. */
function endOfLiteral(script: string, from: number, delimiter: string): number | null {
  for (let at = from; at < script.length; at += 1) {
    const character = script[at];
    if (character === "\n") return null;
    if (character === "\\") {
      if (script[at + 1] === undefined) return null;
      at += 1;
    } else if (character === delimiter) {
      return at + 1;
    }
  }
  return null;
}

/** The end of the text of `a`, `i` or `c`: the first newline no backslash escapes. */
function endOfText(script: string, from: number): number {
  let at = from;
  while (at < script.length && script[at] !== "\n") {
    at += script[at] === "\\" ? 2 : 1;
  }
  return Math.min(at, script.length);
}

interface ReadCommand {
  readonly end: number;
  readonly runsCommands: boolean;
  /** Whether the `w` flag was given, which takes the rest of the line as its file. */
  readonly writes: boolean;
}

/** `s/regex/replacement/flags` from just after the `s`. */
function readSubstitution(script: string, from: number): ReadCommand | null {
  const delimiter = script[from];
  if (delimiter === undefined || delimiter === "\n" || delimiter === "\\") return null;
  const pattern = endOfPattern(script, from + 1, delimiter);
  const replaced = pattern === null ? null : endOfLiteral(script, pattern, delimiter);
  if (replaced === null) return null;
  let at = replaced;
  let runsCommands = false;
  while (/[gpiImMe\d]/.test(script[at] ?? "")) {
    if (script[at] === "e") runsCommands = true;
    at += 1;
  }
  const writes = script[at] === "w";
  return { end: writes ? at + 1 : at, runsCommands, writes };
}

/** `y/source/target/` from just after the `y`. */
function readTransliteration(script: string, from: number): ReadCommand | null {
  const delimiter = script[from];
  if (delimiter === undefined || delimiter === "\n" || delimiter === "\\") return null;
  const source = endOfLiteral(script, from + 1, delimiter);
  const target = source === null ? null : endOfLiteral(script, source, delimiter);
  return target === null ? null : { end: target, runsCommands: false, writes: false };
}
