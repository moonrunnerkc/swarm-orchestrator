/**
 * Whether the harness controls the invocation it is about to measure, and the invocation it
 * runs where it does.
 *
 * This replaces a sanitizer, and then it replaced a string. The earlier rewrite took whatever
 * command a project declared, stripped the isolation setting it found there, and appended its
 * own. That approach lost three times, each time to a spelling the strip did not recognize:
 * spaces around the equals, a fullwidth equals, a double-quoted value. Recognizing the command
 * whole instead of correcting it closed those, and then lost again, because the thing being
 * recognized was still text: a quoted `'--test-isolation=none'` was classified as a file
 * pattern by a scan that splits on whitespace, and the shell that ran the resulting string
 * unquoted it back into a real flag. Every loss looked the same from outside, a number reported
 * as measured that was produced under a configuration the harness never set, and every fix was
 * another alternative in the same pattern.
 *
 * The defect is not the pattern and it is not the scan. It is that a check reading a command
 * string is reasoning about what a shell will do with text somebody else wrote, and a wrong
 * prediction there is silent. So there is no shell. What comes out of here is the argument
 * vector the harness spawns directly, where an argument is whatever it says it is and nothing
 * re-reads it on the way to the process, and the environment that vector runs in is built here
 * rather than inherited, because a hook named in NODE_OPTIONS loads into that process just as
 * surely as one named on the command line and neither the scan nor the read-back can see it.
 *
 * A declared command is either one the harness can express as such a vector, argument by
 * argument, or it is not measured:
 *
 *   - node's own runner, started by the harness itself, with no wrapper in front of it that
 *     could re-exec or run a script of its own;
 *   - flags drawn from a list that cannot change what the process loads, how it reports, or
 *     where the tests run. An unlisted flag is not argued with, it abstains;
 *   - no shell operator, expansion, or environment assignment anywhere, because each of those
 *     decides at run time what the harness would have to have decided here;
 *   - an environment holding no name that decides what node loads;
 *   - isolation set by the harness and confirmed by re-reading the vector it built, rather
 *     than assumed from having built it.
 *
 * Everything else abstains, which the coverage arm renders as not measured and the control arm
 * as nothing attributed. Not measured is a verdict. A number obtained under conditions the
 * harness cannot confirm is not one.
 */

/** Set by the harness on every run it measures, and confirmed on the way out. */
export const processIsolation = "--test-isolation=process";

/** What the harness spawns: the program and its arguments, with no shell in between. */
export type VouchedArgv = readonly string[];

/**
 * Flags that change neither what node loads, nor how it reports, nor where the tests run. The
 * list is short on purpose: an unrecognized flag costs a measurement, and a wrongly recognized
 * one costs the measurement's meaning. Loader and hook flags (`--import`, `--require`,
 * `--loader`, `--env-file`, `--conditions`) are absent by intent, since each puts workspace
 * code in the process that writes the artifact the harness reads.
 */
const vouchedFlags: ReadonlySet<string> = new Set([
  "--test",
  "--test-only",
  "--test-force-exit",
  "--test-concurrency",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-timeout",
  "--test-shard",
  "--experimental-strip-types",
  "--no-experimental-strip-types",
  "--experimental-transform-types",
  "--no-warnings",
  "--disable-warning",
]);

/**
 * Vouched flags whose value is the argument after them. Node accepts `--flag=value` as well, and
 * the two spellings mean the same thing to node, but only the separated spelling can be taken
 * apart by a reader sorting arguments into flags and file patterns.
 *
 * Keeping the pair together is not a convenience. koa#1946's oracle names its cases as
 * `--test-name-pattern` followed by the titles, and sorting the titles into the file patterns
 * built an argv asking node to filter by the coverage flag and to run a test file named after the
 * titles: an invocation vouched as measured that measures something nobody declared.
 */
const flagsTakingAValue: ReadonlySet<string> = new Set([
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-shard",
  "--disable-warning",
]);

/**
 * Anything that makes the text mean something other than what it says: a second command, a
 * redirection, a substitution, a line continuation. One of these anywhere in the body ends the
 * question, because what a reader would build from it is not knowable here.
 */
const shellControl = /[|&;<>()$`\\\n\r]/;

const quoteCharacter = /["']/;

/** What a shell still acts on inside double quotes, which is why only single quotes disarm. */
const expandsInsideDoubleQuotes = /[$`\\]/;

/** Node reads a flag's underscores as dashes, so both spellings name one flag. */
function flagName(token: string): string {
  const upTo = token.indexOf("=");
  return (upTo === -1 ? token : token.slice(0, upTo)).replaceAll("_", "-");
}

/**
 * A path this harness can hand to a shell as a literal, or null. Null rather than an escape
 * pass: a path carrying a quote or an operator is one more thing to predict, and the arm that
 * asked for it abstains instead.
 *
 * Only one arm still needs this, the fallback that runs a single test file through the package
 * manager. No artifact is read from that run, so nothing it produces is attributed; the vouched
 * arms hand node an argv and quote nothing.
 */
export function shellQuoted(path: string): string | null {
  return quoteCharacter.test(path) || shellControl.test(path) ? null : `'${path}'`;
}

interface VouchedInvocation {
  /** The flags the project declared, every one of them recognized. */
  readonly flags: readonly string[];
  /** Everything the project named that is not a flag: its file patterns, in its own order. */
  readonly patterns: readonly string[];
}

/**
 * The declared command as the arguments a shell would hand the process, or null where the text
 * does not settle what those arguments are.
 *
 * A quote is the one rule that removes the prediction this module renounces: inside single
 * quotes a shell acts on nothing, so an operator there is a character, and the whitespace that
 * separates arguments is separating them only where no quote is open. Reading the two together
 * is what lets a title filter, one argument carrying both spaces and a regex alternation, arrive
 * as the argument it is; a whitespace split cut it into pieces and an operator scan over the
 * whole body refused it, which is why the oracle-reach check reported not measured on every real
 * oracle it was given.
 *
 * What comes out is still narrower than a shell by a wide margin. Nothing expands, nothing is
 * escaped, and every character a shell would act on outside quotes ends the reading. Double
 * quotes leave expansion on, so the characters that expand are refused inside them too.
 */
export function commandWords(body: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  let quote: '"' | "'" | null = null;

  for (const character of body) {
    if (quote === "'") {
      if (character === "'") quote = null;
      else word += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (expandsInsideDoubleQuotes.test(character)) return null;
      else word += character;
      continue;
    }
    if (/\s/.test(character)) {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      word ??= "";
      continue;
    }
    if (shellControl.test(character)) {
      return null;
    }
    word = (word ?? "") + character;
  }

  if (quote !== null) {
    return null;
  }
  if (word !== null) {
    words.push(word);
  }
  return words.some((each) => each.length === 0) ? null : words;
}

/**
 * The declared command as this harness reads it, or null where it reads it as anything less
 * than completely.
 */
function vouch(body: string | undefined): VouchedInvocation | null {
  if (body === undefined) {
    return null;
  }
  const tokens = commandWords(body);
  if (tokens === null || tokens.length === 0) {
    return null;
  }
  // The first token is the program. `node` and nothing else: npm runs pre and post scripts,
  // npx resolves a package, and a shell function is whatever the profile made it.
  if (tokens[0] !== "node") {
    return null;
  }

  const flags: string[] = [];
  const patterns: string[] = [];
  const declared = tokens.slice(1);
  for (let index = 0; index < declared.length; index += 1) {
    const argument = declared[index] as string;
    if (!argument.startsWith("-")) {
      patterns.push(argument);
      continue;
    }
    if (!vouchedFlags.has(flagName(argument))) {
      return null;
    }
    flags.push(argument);
    if (argument.includes("=") || !flagsTakingAValue.has(flagName(argument))) {
      continue;
    }
    const value = declared[index + 1];
    if (value === undefined) {
      return null;
    }
    flags.push(value);
    index += 1;
  }

  return flags.some((flag) => flagName(flag) === "--test") ? { flags, patterns } : null;
}

/**
 * Read back what was built. Confirming rather than trusting the construction is the point of
 * the exercise: the isolation setting has to be the harness's own, exactly once, in a spelling
 * this function can see, whatever the builder above believes it wrote.
 */
function confirms(argv: VouchedArgv, harnessFlags: readonly string[]): boolean {
  if (argv[0] !== "node") {
    return false;
  }
  const supplied = new Set(harnessFlags);
  const isolation: string[] = [];

  for (const argument of argv.slice(1)) {
    if (!argument.startsWith("-")) {
      continue;
    }
    if (flagName(argument) === "--test-isolation") {
      isolation.push(argument);
    }
    if (supplied.has(argument)) {
      continue;
    }
    if (quoteCharacter.test(argument) || !vouchedFlags.has(flagName(argument))) {
      return false;
    }
  }

  return isolation.length === 1 && isolation[0] === processIsolation;
}

/**
 * The vector to spawn, or null to abstain. `harnessFlags` are the reporters and the isolation
 * setting this arm needs; `patterns` replaces the project's own file selection where an arm
 * runs one named file, and keeps it where the arm runs the suite.
 *
 * The harness's flags go after the project's and before the patterns, which is where node
 * accepts them: it ignores runner flags that arrive after a file pattern, and it takes the last
 * setting it is given for a flag named twice.
 */
export function harnessControlledNodeTest(
  body: string | undefined,
  harnessFlags: readonly string[],
  patterns: readonly string[] | null = null,
): VouchedArgv | null {
  const vouched = vouch(body);
  if (vouched === null) {
    return null;
  }
  const argv = ["node", ...vouched.flags, ...harnessFlags, ...(patterns ?? vouched.patterns)];

  return confirms(argv, harnessFlags) ? argv : null;
}
