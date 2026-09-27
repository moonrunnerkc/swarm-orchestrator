/**
 * Whether a declared test command can run without a person at a terminal, read off the
 * command itself rather than guessed from the runner's name.
 *
 * Two things keep a gate command noninteractive, and both are documented behaviour of the
 * runners rather than a rewrite of what the project declared: the child gets no terminal
 * (stdin is not a TTY, see `exec/run-process.ts`), and the child environment carries
 * `CI=true` (`exec/child-environment.ts`). Vitest, Jest, Mocha and Create React App's test
 * script each read one or both of those as "run once and exit". What none of them can undo is
 * a command that asks for watch mode by name: `vitest --watch`, `jest --watchAll`, `node --test
 * --watch`, `mocha -w`. That command is interactive by declaration, and the honest answer is to
 * say so and name the override, not to strip the flag and run something the project did not
 * declare.
 */

/** Words that put a recognised runner into watch mode whatever the environment says. */
const watchFlags: ReadonlySet<string> = new Set(["--watch", "--watchAll", "--ui", "-w"]);

/** Runners whose `-w` means watch. Jest's `-w` is `--maxWorkers`, so it is not here. */
const shortWatchRunners: ReadonlySet<string> = new Set(["mocha", "vitest"]);

/** Vitest subcommands that never return on their own. */
const vitestInteractiveModes: ReadonlySet<string> = new Set(["watch", "dev"]);

export type RecognisedRunner =
  | "vitest"
  | "jest"
  | "mocha"
  | "node-test"
  | "react-scripts"
  | "pytest"
  | "other";

export interface NoninteractiveReading {
  /** The runner the command's program word names, or `other` where it names none of these. */
  readonly runner: RecognisedRunner;
  /** The documented mechanisms that keep this command from waiting on a person. */
  readonly noninteractiveBy: readonly string[];
  /** Why the command cannot run unattended, or null where it can. */
  readonly interactive: string | null;
}

/** Shell syntax this reader does not follow. A body holding it is read as `other`, unchanged. */
const shellSyntax = /[|&;<>`$()]/;

function programWords(body: string): readonly string[] {
  const words = body
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  // `NODE_ENV=test jest` and `cross-env NODE_ENV=test jest` both run jest; the assignments and
  // the one program that only exists to make them portable are stepped over to find it.
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === "cross-env") index += 1;
    else break;
  }
  return words.slice(index);
}

function runnerOf(words: readonly string[]): RecognisedRunner {
  const program = (words[0] ?? "").replace(/^.*\//, "");
  if (program === "vitest") return "vitest";
  if (program === "jest") return "jest";
  if (program === "mocha") return "mocha";
  if (program === "react-scripts" && words[1] === "test") return "react-scripts";
  if (program === "node" && words.includes("--test")) return "node-test";
  if (program === "pytest") return "pytest";
  if (program === "python" || program === "python3") {
    const module = words.indexOf("-m");
    if (module !== -1 && words[module + 1] === "pytest") return "pytest";
  }
  return "other";
}

/**
 * Read a declared test command for whether it can run unattended. The body is never rewritten:
 * what comes back is a description of the command as declared, and the caller decides whether
 * to run it or to report it as interactive by declaration.
 */
export function readNoninteractive(body: string | undefined): NoninteractiveReading {
  const text = body ?? "";
  if (text.trim().length === 0 || shellSyntax.test(text)) {
    return {
      runner: "other",
      noninteractiveBy: ["no terminal on stdin", "CI=true in the child environment"],
      interactive: text.includes("--watch")
        ? "the declared command names --watch, which waits for changes rather than exiting"
        : null,
    };
  }
  const words = programWords(text);
  const runner = runnerOf(words);
  const flags = words.slice(1);
  const asksToWatch = flags.some(
    (word) =>
      (watchFlags.has(word) && (word !== "-w" || shortWatchRunners.has(runner))) ||
      word.startsWith("--watch=") ||
      (word.startsWith("--watchAll") && word !== "--watchAll=false"),
  );
  const vitestMode = runner === "vitest" ? flags.find((word) => !word.startsWith("-")) : undefined;
  const interactive = asksToWatch
    ? `the declared command asks for watch mode (${flags.find((word) => watchFlags.has(word) || word.startsWith("--watch")) ?? "--watch"}), which waits for changes rather than exiting`
    : vitestMode !== undefined && vitestInteractiveModes.has(vitestMode)
      ? `the declared command runs \`vitest ${vitestMode}\`, which waits for changes rather than exiting`
      : null;
  const noninteractiveBy: string[] = ["no terminal on stdin"];
  if (runner === "vitest") noninteractiveBy.push("CI=true, which vitest reads as run mode");
  else if (runner === "jest") noninteractiveBy.push("CI=true, which jest reads as --ci");
  else if (runner === "react-scripts")
    noninteractiveBy.push("CI=true, which react-scripts test reads as run once");
  else if (runner === "mocha") noninteractiveBy.push("mocha runs once unless --watch is named");
  else if (runner === "node-test")
    noninteractiveBy.push("node --test runs once unless --watch is named");
  else if (runner === "pytest") noninteractiveBy.push("pytest runs once");
  else noninteractiveBy.push("CI=true in the child environment");
  return { runner, noninteractiveBy, interactive };
}
