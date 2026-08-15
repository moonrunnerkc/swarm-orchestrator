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
 * Anything that makes the text mean something other than what it says: a second command, a
 * redirection, a substitution, a line continuation. One of these anywhere in the body ends the
 * question, because what a reader would build from it is not knowable here.
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
 *
 * Only one arm still needs this, the fallback that runs a single test file through the package
 * manager. No artifact is read from that run, so nothing it produces is attributed; the vouched
 * arms hand node an argv and quote nothing.
 */
export function shellQuoted(path: string): string | null {
  return quoteCharacter.test(path) || shellControl.test(path) ? null : `'${path}'`;
}

/**
 * Names whose values decide what a process loads before it reaches its own entry point. Node's
 * own family is taken whole rather than listed member by member, since listing is the shape
 * that keeps losing to the next spelling, and the two dynamic-linker names are here because
 * they put native code in any process at all.
 */
const preloadNames: ReadonlySet<string> = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
]);

/**
 * The environment a vouched run is given: whatever it was handed, minus every name that could
 * decide what the process loads. Built rather than inherited, and pure so the decision is
 * testable without spawning anything.
 *
 * Folded to upper case before the decision, because the name a process reads is not always the
 * name the parent spelled, and a check that misses `node_options` is a check the workspace
 * chooses the spelling for.
 */
export function harnessControlledEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const folded = name.toUpperCase();
    if (value === undefined || folded.startsWith("NODE_") || preloadNames.has(folded)) {
      continue;
    }
    environment[name] = value;
  }
  return environment;
}

interface VouchedInvocation {
  /** The flags the project declared, every one of them recognized. */
  readonly flags: readonly string[];
  /** Everything the project named that is not a flag: its file patterns, in its own order. */
  readonly patterns: readonly string[];
}

/**
 * One token of the declared command as the argument it stands for, or null where the text does
 * not settle what that argument is.
 *
 * A token wrapped in matching quotes with no quote inside it is one argument spelled the one
 * way that has a single reading, and the body has already been refused if it carries anything
 * an expansion could reach. Reading it is not the rewrite this module renounces: what comes out
 * is then classified by the same rules as every other argument, so a flag that arrived quoted
 * is judged as a flag rather than waved through as a file pattern. That direction is the whole
 * point, since the loss this closes was a flag being read as a path. Anything else carrying a
 * quote is not read at all, and not read means the arm abstains.
 */
function argumentFrom(token: string): string | null {
  if (!quoteCharacter.test(token)) {
    return token.length === 0 ? null : token;
  }
  const opening = token[0];
  if (opening === undefined || !quoteCharacter.test(opening) || token.at(-1) !== opening) {
    return null;
  }
  const inside = token.slice(1, -1);
  return inside.length === 0 || quoteCharacter.test(inside) ? null : inside;
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
    const argument = argumentFrom(token);
    if (argument === null) {
      return null;
    }
    if (!argument.startsWith("-")) {
      patterns.push(argument);
      continue;
    }
    if (!vouchedFlags.has(flagName(argument))) {
      return null;
    }
    flags.push(argument);
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
