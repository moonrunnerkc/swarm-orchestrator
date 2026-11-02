/** What an awk program opens beyond the files it is given as operands. */
export interface AwkProgramEffects {
  /** The files it prints to, each named by a string literal after `>` or `>>`. */
  readonly files: readonly string[];
  /**
   * Whether it starts a command (`system`, a pipe), reads a file it names itself (`getline`, an
   * `ARGV` entry), loads code (`@include`), or prints to a file it computes: nothing here can
   * rule on any of those.
   */
  readonly unreadable: boolean;
}

/** Names that run a command or open a file the program chose. */
const opensOrRuns = new Set(["system", "getline", "ARGV"]);

/**
 * The program read as awk reads it, or null where this reader cannot follow it (a string that
 * does not close on its line).
 *
 * Where it is unsure whether a slash opens a regular expression, it reads on as code, and where
 * it is unsure whether a print statement has ended, it reads a `>` as a redirect: both directions
 * can only find more, never hide a call or a file.
 */
export function readAwkProgram(program: string): AwkProgramEffects | null {
  const files: string[] = [];
  let at = 0;
  // The last character outside whitespace, strings and comments: it decides what a slash is.
  let last = "";
  let printing = false;
  let parentheses = 0;

  while (at < program.length) {
    const character = program[at] ?? "";
    if (character === "#") {
      const end = program.indexOf("\n", at);
      at = end === -1 ? program.length : end;
      continue;
    }
    if (character === "\n" && printing && parentheses === 0 && /[\w)\]"]/.test(last)) {
      printing = false;
    }
    if (/\s/.test(character)) {
      at += 1;
      continue;
    }
    if (character === '"') {
      const closes = endOfString(program, at);
      if (closes === null) return null;
      at = closes;
      last = '"';
      continue;
    }
    if (character === "/" && !/[\w)\]"$]/.test(last)) {
      const closes = endOfRegularExpression(program, at);
      if (closes !== null) {
        at = closes;
        last = "/";
        continue;
      }
    }
    const word = /^[A-Za-z_]\w*/.exec(program.slice(at))?.[0];
    if (word !== undefined) {
      if (opensOrRuns.has(word)) return { files, unreadable: true };
      if (word === "print" || word === "printf") {
        printing = true;
        parentheses = 0;
      }
      at += word.length;
      last = "w";
      continue;
    }
    if (character === "@") return { files, unreadable: true };
    if (character === "|") {
      if (program[at + 1] !== "|") return { files, unreadable: true };
      at += 2;
      last = "|";
      continue;
    }
    if (printing) {
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
      if (parentheses === 0 && (character === ";" || character === "}")) printing = false;
      if (parentheses === 0 && character === ">") {
        const target = printTarget(program, at);
        if (target === null) return { files, unreadable: true };
        files.push(target.file);
        at = target.end;
        printing = false;
        continue;
      }
    }
    last = character;
    at += 1;
  }
  return { files, unreadable: false };
}

/** The index after the quote closing the string opened at `open`, or null where it does not close on its line. */
function endOfString(program: string, open: number): number | null {
  for (let at = open + 1; at < program.length; at += 1) {
    const character = program[at];
    if (character === "\n") return null;
    if (character === "\\") at += 1;
    else if (character === '"') return at + 1;
  }
  return null;
}

/**
 * The index after the slash closing a regular expression opened at `open`, or null where none
 * closes it on the line. The first unescaped slash ends it, brackets or not: gawk reads `[/]` as
 * part of the expression and other awks do not, and ending at the earlier slash reads more as code.
 */
function endOfRegularExpression(program: string, open: number): number | null {
  for (let at = open + 1; at < program.length; at += 1) {
    const character = program[at];
    if (character === "\n") return null;
    if (character === "\\") at += 1;
    else if (character === "/") return at + 1;
  }
  return null;
}

/**
 * The literal file name after a print statement's `>` or `>>`, or null where it is computed: a
 * literal followed by anything but the end of the statement is concatenated with it.
 */
function printTarget(
  program: string,
  redirect: number,
): { readonly file: string; readonly end: number } | null {
  let at = program[redirect + 1] === ">" ? redirect + 2 : redirect + 1;
  while (program[at] === " " || program[at] === "\t") at += 1;
  if (program[at] !== '"') return null;
  const closes = endOfString(program, at);
  if (closes === null) return null;
  const file = program.slice(at + 1, closes - 1);
  let end = closes;
  while (program[end] === " " || program[end] === "\t") end += 1;
  const next = program[end];
  const statementEnds = next === undefined || next === ";" || next === "}" || next === "\n";
  // An escape would make the name something other than what is written.
  return statementEnds && !file.includes("\\") ? { file, end } : null;
}
