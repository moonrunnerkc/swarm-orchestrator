/**
 * Whether the harness controls the invocation it is about to measure, and the command it runs
 * where it does.
 *
 * This replaces a sanitizer. The earlier rewrite took whatever command a project declared,
 * stripped the isolation setting it found there, and appended its own. That approach lost three
 * times, each time to a spelling the strip did not recognize: spaces around the equals, a
 * fullwidth equals, a double-quoted value. Every loss looked the same from outside, a number
 * reported as measured that was produced under a configuration the harness never set, and
 * every fix was another alternative in the same pattern. The defect is not the pattern. It is
 * that a sanitizer has to predict what a shell will do with a string somebody else wrote, and a
 * wrong prediction there is silent.
 *
 * So nothing is sanitized. A command is either one the harness recognizes in full, token by
 * token, or it is not measured:
 *
 *   - node's own runner, started by the harness itself, with no wrapper in front of it that
 *     could re-exec or run a script of its own;
 *   - flags drawn from a list that cannot change what the process loads, how it reports, or
 *     where the tests run. An unlisted flag is not argued with, it abstains;
 *   - no shell operator, expansion, or environment assignment anywhere, because each of those
 *     decides at run time what the harness would have to have decided here;
 *   - isolation set by the harness and confirmed by re-reading the command it built, rather
 *     than assumed from having built it.
 *
 * Everything else abstains, which the coverage arm renders as not measured and the control arm
 * as nothing attributed. Not measured is a verdict. A number obtained under conditions the
 * harness cannot confirm is not one.
 */

/** Set by the harness on every command it measures, and confirmed on the way out. */
export const processIsolation = "--test-isolation=process";

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
 * Anything that makes the text mean something other than what it says: a second command, a
 * redirection, a substitution, a line continuation. One of these anywhere in the body ends the
 * question, because what the shell would build from it is not knowable here.
 */
const shellControl = /[|&;<>()$`\\\n\r]/;

const quoteCharacter = /["']/;

/** Node reads a flag's underscores as dashes, so both spellings name one flag. */
function flagName(token: string): string {
  const upTo = token.indexOf("=");
  return (upTo === -1 ? token : token.slice(0, upTo)).replaceAll("_", "-");
}

/**
 * A path this harness can hand to a shell as a literal, or null. Null rather than an escape
 * pass: a path carrying a quote or an operator is one more thing to predict, and the arm that
 * asked for it abstains instead.
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
 * The declared command as this harness reads it, or null where it reads it as anything less
 * than completely.
 */
function vouch(body: string | undefined): VouchedInvocation | null {
  if (body === undefined || body.trim().length === 0 || shellControl.test(body)) {
    return null;
  }
  const tokens = body.trim().split(/\s+/);
  // The first token is the program. `node` and nothing else: npm runs pre and post scripts,
  // npx resolves a package, and a shell function is whatever the profile made it.
  if (tokens[0] !== "node") {
    return null;
  }

  const flags: string[] = [];
  const patterns: string[] = [];
  for (const token of tokens.slice(1)) {
    if (!token.startsWith("-")) {
      patterns.push(token);
      continue;
    }
    // A quoted flag value is the shape the sanitizer kept losing to, and it is also the shape
    // that makes the flag's value a question about the shell rather than about the flag.
    if (quoteCharacter.test(token) || !vouchedFlags.has(flagName(token))) {
      return null;
    }
    flags.push(token);
  }

  return flags.some((flag) => flagName(flag) === "--test") ? { flags, patterns } : null;
}

/**
 * Read back what was built. Confirming rather than trusting the construction is the point of
 * the exercise: the isolation setting has to be the harness's own, exactly once, in a spelling
 * this function can see, whatever the builder above believes it wrote.
 */
function confirms(command: string, harnessFlags: readonly string[]): boolean {
  if (shellControl.test(command)) {
    return false;
  }
  const supplied = new Set(harnessFlags);
  const isolation: string[] = [];

  for (const token of command.trim().split(/\s+/)) {
    if (!token.startsWith("-")) {
      continue;
    }
    if (flagName(token) === "--test-isolation") {
      isolation.push(token);
    }
    if (supplied.has(token)) {
      continue;
    }
    if (quoteCharacter.test(token) || !vouchedFlags.has(flagName(token))) {
      return false;
    }
  }

  return isolation.length === 1 && isolation[0] === processIsolation;
}

/**
 * The command to run, or null to abstain. `harnessFlags` are the reporters and the isolation
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
): string | null {
  const vouched = vouch(body);
  if (vouched === null) {
    return null;
  }
  const command = [
    "node",
    ...vouched.flags,
    ...harnessFlags,
    ...(patterns ?? vouched.patterns),
  ].join(" ");

  return confirms(command, harnessFlags) ? command : null;
}
