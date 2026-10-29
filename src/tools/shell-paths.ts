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

/** The language an interpreter reads its program in, or null where the program is not one. */
export function interpreterLanguage(executable: string): InlineLanguage | null {
  return inlineProgramFlags[executable.split("/").at(-1) ?? ""]?.language ?? null;
}

/** The language of this argument where it is a program the interpreter runs; null where it is a file it is handed. */
export function inlineProgram(
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
export function pathsAWordCouldOpen(word: string): readonly string[] {
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
