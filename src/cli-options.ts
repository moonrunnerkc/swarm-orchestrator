import { resolve } from "node:path";
import { bundledShortlistKeyword } from "./select/shortlist-source.ts";

/**
 * What the command line said about the screen. Null wherever it said nothing, so swarm.toml
 * and the defaults below it still get their turn (src/config/settings.ts).
 */
export interface InterfaceFlags {
  /** False for --no-tui: plain lines even on a terminal. */
  readonly tui: boolean | null;
  readonly color: "always" | "never" | null;
  readonly openEvidence: "always" | "never" | null;
}

/**
 * Flags only, left null wherever the caller said nothing: the environment and swarm.toml sit
 * between flags and defaults, and only the composition root sees all three layers, so
 * resolution lives in src/config/settings.ts rather than here.
 */
export interface RunCommand {
  readonly command: "run";
  readonly task: string;
  readonly modelSpec: string | null;
  readonly workspace: string;
  readonly maxSteps: number | null;
  /** Null means the session's own directory, which is outside the workspace by design. */
  readonly bundleDirectory: string | null;
  /** The commit the gates measure the change against. */
  readonly baseRef: string;
  /** How many auto-resolve retries a blocking gate failure gets. */
  readonly attempts: number | null;
  /** The whole run's wall budget in minutes, or null for none over the run as a whole. */
  readonly maxWallMinutes: number | null;
  readonly localEndpoint: string | null;
  readonly interfaceFlags: InterfaceFlags;
}

/**
 * A session: the same run, asked for without a task, so the task is typed rather than passed.
 *
 * It is reached by naming no task at all, which used to be the error "nothing to do". A person
 * who runs `swarm` with nothing after it wants to start working, not to be told they held it
 * wrong, and a bare word cannot be a verb here because bare words are the task.
 */
export interface SessionCommand {
  readonly command: "session";
  readonly modelSpec: string | null;
  readonly workspace: string;
  readonly maxSteps: number | null;
  readonly bundleDirectory: string | null;
  readonly baseRef: string;
  readonly attempts: number | null;
  readonly maxWallMinutes: number | null;
  readonly localEndpoint: string | null;
  readonly interfaceFlags: InterfaceFlags;
}

/**
 * Reports what owns the `swarm` command, and offers to fix it.
 *
 * `--fix` runs the remedies rather than printing them, which is the difference between a
 * diagnosis and a resolution. It is a flag rather than the default because reinstalling a
 * package is not something a report should do to somebody who asked a question.
 */
export interface DoctorCommand {
  readonly command: "doctor";
  readonly fix: boolean;
  /** False skips the registry lookup, which is the only part that needs a network. */
  readonly askRegistry: boolean;
}

/** Writes a swarm.toml with the gates read off package.json, where there is none yet. */
export interface InitCommand {
  readonly command: "init";
  readonly workspace: string;
}

/** Runs the gates over a workspace and reports, with no model and no retries. */
export interface GatesCommand {
  readonly command: "gates";
  readonly workspace: string;
  readonly baseRef: string;
  readonly bundleDirectory: string | null;
  /**
   * Files the caller authorised, or null for none. With none the file-set gate reports the
   * observed scope and abstains, because nothing authorised anything: this command has no
   * planner, and failing for a declaration nobody was there to make rejects every changed
   * repository the command exists to check.
   */
  readonly allowedFiles: readonly string[] | null;
}

export interface ReplayCommand {
  readonly command: "replay";
  readonly bundleDirectory: string;
}

/**
 * Checks a bundle, and separately checks who signed it. The two are different questions: a
 * bundle carries the public key that signed it, so its own signature check says the bundle is
 * unchanged since it was written and nothing about who wrote it. The expected signers come
 * from here, which is to say from outside the bundle, which is the only place they can come
 * from and mean anything.
 */
export interface VerifyCommand {
  readonly command: "verify";
  readonly bundleDirectory: string;
  /** Key fingerprints the reader expects. Empty means consistency only, never authenticity. */
  readonly expectedSigners: readonly string[];
}

/** Shows a past bundle through the same panel a finished run ends on. */
export interface ReviewCommand {
  readonly command: "review";
  readonly bundleDirectory: string;
}

/** Measures candidate models against the golden set and reports the distributions. */
export interface CalibrateCommand {
  readonly command: "calibrate";
  /** Named model specs, or null to take the tier the shortlist matched. */
  readonly models: readonly string[] | null;
  readonly repeats: number;
  readonly shortlist: string | null;
  readonly bundleDirectory: string | null;
}

/** Turns a real task that went wrong into a permanent calibration case. */
export interface AddCaseCommand {
  readonly command: "add-case";
  readonly task: string;
  /** Workspace-relative files the case starts from. */
  readonly seed: readonly string[];
  readonly gateCommand: string;
  readonly workspace: string;
}

/** N workers over git worktrees, then one merge queue that lands what they produced. */
export interface ParallelCommand {
  readonly command: "parallel";
  /**
   * One task per line, or a JSON task graph. A file rather than repeated flags, so a run is
   * reproducible. Null where a goal was given for the run to decompose instead.
   */
  readonly tasksFile: string | null;
  /** A goal for the run to break into tasks itself. Null where a file named them. */
  readonly goal: string | null;
  readonly workspace: string;
  readonly baseRef: string;
  readonly maxSteps: number | null;
  readonly attempts: number | null;
  readonly maxWallMinutes: number | null;
  readonly bundleDirectory: string | null;
  readonly modelSpec: string | null;
  readonly localEndpoint: string | null;
  /** How many ways to try each task. Null is once, which is the run this always was. */
  readonly redundancy: number | null;
  /** How many workers may hold a worktree at once. Null lets the composition root decide. */
  readonly concurrency: number | null;
}

/** Prints the usage text and exits without doing anything. */
export interface HelpCommand {
  readonly command: "help";
}

/** Prints the routing table the reward log adds up to. */
interface RoutingCommand {
  readonly command: "routing";
}

/** Probes the machine and recommends a local model for it. */
export interface SelectCommand {
  readonly command: "select";
  /** A URL, a file path, or "bundled". Null takes the list the project publishes. */
  readonly shortlist: string | null;
}

export type CommandLine =
  | HelpCommand
  | RunCommand
  | SessionCommand
  | DoctorCommand
  | ReplayCommand
  | VerifyCommand
  | ReviewCommand
  | GatesCommand
  | SelectCommand
  | CalibrateCommand
  | AddCaseCommand
  | RoutingCommand
  | InitCommand
  | ParallelCommand;

export const usage = [
  "swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] [--base <ref>]",
  '  [--attempts <n>] [--max-steps <n>] [--max-wall-minutes <n>] [--local-endpoint <url>] ["<task>"]',
  "",
  "  swarm                                            a session: type tasks, one after another",
  "",
  "  swarm init [--workspace <dir>]                   write swarm.toml from package.json's scripts",
  "  swarm gates [--workspace <dir>] [--base <ref>]   run the gates, no model",
  "    --allowed-files <a,b>                          the scope you authorise; without it the",
  "                                                   file-set gate reports observed scope only",
  "  swarm select [--shortlist <file|url|bundled>]    probe this machine, recommend a model",
  "  swarm calibrate [--models <a,b>] [--repeats <n>] measure models on the golden set",
  '  swarm calibrate --add-case "<task>" --seed <a,b> --gate "<command>"',
  "  swarm doctor [--fix] [--offline]                 what owns the swarm command, and fix it",
  "  swarm routing                                    what the reward log adds up to",
  "  swarm parallel --tasks <file>                    one worker per line, then a merge queue",
  "  swarm parallel --goal <text>                     break the goal into tasks, then run them",
  "    --redundancy <n>                               try each task n ways, land the best",
  "    --concurrency <n>                              how many may hold a worktree at once",
  "  swarm review <bundle directory>                  what a run produced, and open it",
  "  swarm verify <bundle directory> [--signer <fp>]  check the bundle, and who signed it",
  "  swarm replay <bundle directory>                  read a bundle back",
  "",
  "the screen:",
  "  --no-tui                     plain lines even on a terminal",
  "  --color, --no-color          paint, or do not, whatever the terminal says",
  "  --open-evidence              open the review page when the run finishes",
  "  --no-open-evidence           never open it",
  "",
  "swarm.toml holds the same settings, plus [theme] and [keys]. Flags win over it.",
].join("\n");

export class InvalidCommandLineError extends Error {
  constructor(problem: string) {
    super(
      `${problem}. Usage: swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] ` +
        `[--base <ref>] [--attempts <n>] [--max-wall-minutes <n>] [--local-endpoint <url>] ["<task>"], ` +
        "swarm with no task for a session, swarm doctor [--fix] [--offline], " +
        "swarm gates [--workspace <dir>] [--base <ref>], " +
        "swarm select [--shortlist <file|url|bundled>], swarm calibrate [--models <a,b>] " +
        '[--repeats <n>], swarm calibrate --add-case "<task>" --seed <a,b> --gate "<command>", ' +
        "swarm routing, swarm parallel --tasks <file>, swarm parallel --goal <text>, " +
        "swarm replay <bundle directory>, " +
        "or swarm review <bundle directory>. Screen flags: [--no-tui] [--color|--no-color] " +
        "[--open-evidence|--no-open-evidence]",
    );
    this.name = "InvalidCommandLineError";
  }
}

/** The flags that are their own value. Everything else takes the word after it. */
const switchFlags = new Set([
  "help",
  "fix",
  "offline",
  "no-tui",
  "color",
  "no-color",
  "open-evidence",
  "no-open-evidence",
]);

const defaultBaseRef = "HEAD";
/** Three is the floor: two repeats cannot show a spread, and a spread is the point. */
const defaultRepeats = 3;

interface CommandLineContext {
  readonly currentDirectory: string;
}

export function parseCommandLine(
  argv: readonly string[],
  context: CommandLineContext,
): CommandLine {
  const words: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      words.push(argument);
      continue;
    }
    const name = argument.slice(2);
    // A switch takes no value, so it must not eat the word after it: `--no-tui "fix the bug"`
    // would otherwise consume the task and leave nothing to do.
    if (switchFlags.has(name)) {
      flags.set(name, "");
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InvalidCommandLineError(`${argument} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }

  // Before anything else: asking for help must not be able to fail for the reason a person
  // is asking for help.
  if (flags.has("help") || words[0] === "help") {
    return { command: "help" };
  }

  if (words[0] === "verify") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw new InvalidCommandLineError("verify needs a bundle directory");
    }
    return {
      command: "verify",
      bundleDirectory: resolve(context.currentDirectory, target),
      expectedSigners: (flags.get("signer") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    };
  }

  if (words[0] === "replay") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw new InvalidCommandLineError("replay needs a bundle directory");
    }
    return {
      command: "replay",
      bundleDirectory: resolve(context.currentDirectory, target),
    };
  }

  if (words[0] === "review") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw new InvalidCommandLineError("review needs a bundle directory");
    }
    return {
      command: "review",
      bundleDirectory: resolve(context.currentDirectory, target),
    };
  }

  const bundleFlag = flags.get("bundle");
  const bundleDirectory =
    bundleFlag === undefined ? null : resolve(context.currentDirectory, bundleFlag);
  // Resolved against the injected directory, not the ambient cwd, so a relative
  // --workspace lands where the caller says it does.
  const workspace = resolve(context.currentDirectory, flags.get("workspace") ?? ".");

  if (words[0] === "routing") {
    return { command: "routing" };
  }

  if (words[0] === "parallel") {
    const tasksFile = flags.get("tasks");
    const goal = flags.get("goal");
    const named = tasksFile !== undefined && tasksFile.trim().length > 0;
    const asked = goal !== undefined && goal.trim().length > 0;
    if (named === asked) {
      throw new InvalidCommandLineError(
        named
          ? "parallel takes --tasks <file> or --goal <text>, not both: one of them is the " +
              "decomposition and two would disagree"
          : "parallel needs --tasks <file>, one task per line or a JSON task graph, or " +
              "--goal <text> for the run to break into tasks itself",
      );
    }
    return {
      command: "parallel",
      tasksFile: named ? resolve(context.currentDirectory, tasksFile) : null,
      goal: asked ? goal.trim() : null,
      workspace,
      baseRef: flags.get("base") ?? defaultBaseRef,
      maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
      attempts: parseFlagCount(flags.get("attempts"), "--attempts"),
      maxWallMinutes: parseFlagCount(flags.get("max-wall-minutes"), "--max-wall-minutes"),
      bundleDirectory,
      modelSpec: flags.get("model") ?? null,
      localEndpoint: parseLocalEndpoint(flags.get("local-endpoint")),
      redundancy: parseFlagCount(flags.get("redundancy"), "--redundancy"),
      concurrency: parseFlagCount(flags.get("concurrency"), "--concurrency"),
    };
  }

  if (words[0] === "calibrate") {
    const captured = flags.get("add-case");
    if (captured !== undefined) {
      return parseAddCase(captured, flags, workspace);
    }
    const models = flags.get("models");
    return {
      command: "calibrate",
      models: models === undefined ? null : splitList(models),
      repeats: parseRepeats(flags.get("repeats")),
      shortlist: resolveShortlist(flags.get("shortlist"), context),
      bundleDirectory,
    };
  }

  if (words[0] === "doctor") {
    return {
      command: "doctor",
      fix: flags.has("fix"),
      askRegistry: !flags.has("offline"),
    };
  }

  if (words[0] === "select") {
    return { command: "select", shortlist: resolveShortlist(flags.get("shortlist"), context) };
  }

  if (words[0] === "init") {
    return { command: "init", workspace };
  }

  if (words[0] === "gates") {
    const allowed = flags.get("allowed-files");
    return {
      command: "gates",
      workspace,
      baseRef: flags.get("base") ?? defaultBaseRef,
      bundleDirectory,
      allowedFiles:
        allowed === undefined
          ? null
          : allowed
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
    };
  }

  const shared = {
    modelSpec: flags.get("model") ?? null,
    workspace,
    maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
    bundleDirectory,
    baseRef: flags.get("base") ?? defaultBaseRef,
    attempts: parseFlagCount(flags.get("attempts"), "--attempts"),
    maxWallMinutes: parseFlagCount(flags.get("max-wall-minutes"), "--max-wall-minutes"),
    localEndpoint: parseLocalEndpoint(flags.get("local-endpoint")),
    interfaceFlags: parseInterfaceFlags(flags),
  };

  const task = words.join(" ").trim();
  if (task.length === 0) {
    return { command: "session", ...shared };
  }

  // A bare word is the task, which is what makes `swarm fix the parser` work and why no
  // subcommand may be a bare word. The cost is that a subcommand this build does not have
  // becomes a task: running `swarm doctor` against a version predating it started an agent on
  // the repository, declared its uncommitted files, and wrote a bundle. Nothing was damaged and
  // nothing about it looked wrong. One word that is nearly a command is a mistake far more
  // often than it is a task, so it is refused with the nearest match named.
  const nearest = nearestCommand(task);
  if (nearest !== null) {
    throw new InvalidCommandLineError(
      `"${task}" is not a command in this build, and one word on its own is read as a task, ` +
        `so this would have started an agent run. Did you mean "swarm ${nearest}"? ` +
        "If it really is the task, give it more than one word",
    );
  }

  return { command: "run", task, ...shared };
}

/** Subcommands, for telling a typo from a task. Not the parser's source of truth, deliberately: this list going stale makes a suggestion worse, never a command unreachable. */
const knownCommands = [
  "gates",
  "verify",
  "select",
  "calibrate",
  "routing",
  "parallel",
  "replay",
  "review",
  "doctor",
  "help",
] as const;

/** The closest command within two edits, or null when the word is not close to any of them. */
function nearestCommand(task: string): string | null {
  if (task.includes(" ")) {
    return null;
  }
  const word = task.toLowerCase();
  let best: { command: string; distance: number } | null = null;
  for (const command of knownCommands) {
    const distance = editDistance(word, command);
    if (distance <= 2 && (best === null || distance < best.distance)) {
      best = { command, distance };
    }
  }
  return best?.command ?? null;
}

/** Levenshtein, two rows rather than a matrix. The words compared here are never long. */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** Both halves of a pair named at once is a contradiction, so it is an error rather than an order. */
function parseInterfaceFlags(flags: ReadonlyMap<string, string>): InterfaceFlags {
  if (flags.has("color") && flags.has("no-color")) {
    throw new InvalidCommandLineError("--color and --no-color contradict each other");
  }
  if (flags.has("open-evidence") && flags.has("no-open-evidence")) {
    throw new InvalidCommandLineError(
      "--open-evidence and --no-open-evidence contradict each other",
    );
  }
  return {
    tui: flags.has("no-tui") ? false : null,
    color: flags.has("color") ? "always" : flags.has("no-color") ? "never" : null,
    openEvidence: flags.has("open-evidence")
      ? "always"
      : flags.has("no-open-evidence")
        ? "never"
        : null,
  };
}

function parseAddCase(
  task: string,
  flags: ReadonlyMap<string, string>,
  workspace: string,
): AddCaseCommand {
  const seed = splitList(flags.get("seed") ?? "");
  if (seed.length === 0) {
    throw new InvalidCommandLineError(
      "--add-case needs --seed <file,file> naming the files the case starts from",
    );
  }
  const gateCommand = flags.get("gate");
  if (gateCommand === undefined || gateCommand.trim().length === 0) {
    throw new InvalidCommandLineError(
      '--add-case needs --gate "<command>", the command that decides whether the case was solved',
    );
  }
  return { command: "add-case", task, seed, gateCommand, workspace };
}

function splitList(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRepeats(raw: string | undefined): number {
  const repeats = parseFlagCount(raw, "--repeats") ?? defaultRepeats;
  if (repeats < defaultRepeats) {
    throw new InvalidCommandLineError(
      `--repeats must be at least ${defaultRepeats}: fewer cannot show a spread, and the ` +
        "spread is what the report is for",
    );
  }
  return repeats;
}

/**
 * Only a path is resolved: a URL and the "bundled" keyword are not filesystem locations, and
 * resolving them would turn both into a path under the current directory that does not exist.
 */
function resolveShortlist(raw: string | undefined, context: CommandLineContext): string | null {
  if (raw === undefined) {
    return null;
  }
  if (raw === bundledShortlistKeyword || raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  return resolve(context.currentDirectory, raw);
}

/**
 * A non-numeric budget used to reach the loop as NaN, and every `steps >= NaN`
 * comparison is false, so the step limit silently stopped applying.
 */
function parseFlagCount(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidCommandLineError(`${flag} must be a positive whole number, got "${raw}"`);
  }
  return parsed;
}

function parseLocalEndpoint(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    throw new InvalidCommandLineError(`--local-endpoint must be an http(s) url, got "${raw}"`);
  }
  return raw;
}
