/**
 * What a program does with a word it is given: open it as a file, read it as text, run it as a
 * sed script or an awk program, read its program from it, or append it to a backup file name.
 */
export type WordRole =
  | "path"
  | "text"
  | "sed-script"
  | "awk-program"
  | "program-file"
  | "backup-suffix";

/**
 * Which words of a program's command line are which, as its option parser reads them.
 *
 * A table is safe to be incomplete in one direction only. An option missing from it makes the
 * whole command read as before, every word offered as a path. An option listed as taking a value
 * that it does not take would hand the next word, possibly a file, to the value's role, so every
 * valued option here takes its value in every implementation named. One whose value is a number
 * or a glob may be listed as a flag instead: its value is then read as the first operand, and the
 * real first operand as a file, which only offers more.
 */
export interface ArgumentGrammar {
  /** Short options that take no value. */
  readonly flags: string;
  /** Short options that take a value, attached or as the next word. */
  readonly valued: Readonly<Record<string, WordRole>>;
  /** Short options whose value, where there is one, is attached (`-C3`). */
  readonly attached: Readonly<Record<string, WordRole>>;
  /**
   * Short options one implementation gives the next word as a value and another reads only
   * attached: sed's `-i`, which BSD sed reads as `-i ''` and GNU sed as `-i` alone. Both readings
   * are ruled on.
   */
  readonly disputed: Readonly<Record<string, WordRole>>;
  readonly longFlags: ReadonlySet<string>;
  /** Long options that take a value, after `=` or as the next word. */
  readonly longValued: Readonly<Record<string, WordRole>>;
  /** Long options whose value is only ever given after `=`. */
  readonly longAttached: Readonly<Record<string, WordRole>>;
  /** What the first operand is, unless one of `suppliers` gave the program its pattern or script. */
  readonly firstOperand: WordRole;
  readonly suppliers: ReadonlySet<string>;
}

const listed = (names: string): ReadonlySet<string> => new Set(names.trim().split(/\s+/));

const allText = (names: string): Record<string, WordRole> =>
  Object.fromEntries([...listed(names)].map((name) => [name, "text"]));

const sed: ArgumentGrammar = {
  flags: "nErsuzla",
  valued: { e: "sed-script", f: "program-file" },
  attached: {},
  disputed: { i: "backup-suffix" },
  longFlags: listed(`quiet silent regexp-extended separate unbuffered null-data zero-terminated
    posix debug sandbox follow-symlinks binary`),
  longValued: { expression: "sed-script", file: "program-file", "line-length": "text" },
  longAttached: { "in-place": "backup-suffix" },
  firstOperand: "sed-script",
  suppliers: listed("-e -f --expression --file"),
};

const grep: ArgumentGrammar = {
  flags: "abcEFGhHiIlLnoPqrRsUvwxyzZ0123456789",
  valued: { e: "text", f: "path", A: "text", B: "text", m: "text", d: "text", D: "text" },
  attached: { C: "text" },
  disputed: {},
  longFlags: listed(`recursive dereference-recursive line-number ignore-case no-ignore-case
    invert-match word-regexp line-regexp count files-with-matches files-without-match
    only-matching quiet silent no-messages with-filename no-filename extended-regexp
    fixed-strings basic-regexp perl-regexp text byte-offset null null-data line-buffered
    initial-tab`),
  longValued: {
    ...allText(`regexp after-context before-context max-count include exclude exclude-dir label
      binary-files directories devices`),
    file: "path",
    "exclude-from": "path",
  },
  longAttached: allText("context color colour"),
  firstOperand: "text",
  suppliers: listed("-e -f --regexp --file"),
};

const ripgrep: ArgumentGrammar = {
  flags: "abcFhHiIlLnNopPqsSuUvVwxz0.",
  valued: { ...allText("e g t T A B C m j M d E r"), f: "path" },
  attached: {},
  disputed: {},
  longFlags: listed(`case-sensitive crlf fixed-strings ignore-case invert-match line-regexp mmap
    multiline multiline-dotall no-unicode null-data pcre2 smart-case stop-on-nonmatch text
    word-regexp auto-hybrid-regex no-pcre2-unicode binary follow glob-case-insensitive hidden
    ignore-file-case-insensitive no-ignore no-ignore-dot no-ignore-exclude no-ignore-files
    no-ignore-global no-ignore-parent no-ignore-vcs no-require-git one-file-system unrestricted
    block-buffered byte-offset column heading no-heading include-zero line-buffered line-number
    no-line-number max-columns-preview null only-matching passthru pretty quiet trim vimgrep
    with-filename no-filename sort-files count count-matches files-with-matches
    files-without-match json no-messages no-ignore-messages stats files no-config type-list
    search-zip`),
  longValued: {
    ...allText(`regexp glob iglob type type-not type-add type-clear after-context before-context
      context max-count threads max-columns max-depth max-filesize encoding replace sort sortr
      color colors context-separator field-context-separator field-match-separator
      path-separator engine dfa-size-limit regex-size-limit hyperlink-format`),
    file: "path",
    "ignore-file": "path",
  },
  longAttached: {},
  firstOperand: "text",
  // `--files` lists files rather than searching them, so it takes no pattern.
  suppliers: listed("-e -f --regexp --file --files --type-list"),
};

const awk: ArgumentGrammar = {
  flags: "",
  valued: { F: "text", v: "text", f: "program-file" },
  attached: {},
  disputed: {},
  longFlags: new Set(),
  longValued: {},
  longAttached: {},
  firstOperand: "awk-program",
  suppliers: listed("-f"),
};

/** The programs whose command lines are read word by word, by the name they are run as. */
export const argumentGrammars: Readonly<Record<string, ArgumentGrammar>> = {
  sed,
  gsed: sed,
  grep,
  egrep: grep,
  fgrep: grep,
  ggrep: grep,
  rg: ripgrep,
  awk,
  gawk: awk,
  mawk: awk,
  nawk: awk,
};

/** Programs that print their arguments and open nothing. */
export const printsItsArguments: ReadonlySet<string> = listed("echo printf");
