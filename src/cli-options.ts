import { resolve } from "node:path";
import { commandDefinitions, commandHelpLines } from "./cli-command-definitions.ts";
import {
  type CiCommand,
  defaultBaseRef,
  type GatesCommand,
  InvalidCommandLineError,
  parseVerifyOnlyCommand,
  tokenizeCommandLine,
  type VerifyCommand,
} from "./cli-verify-options.ts";
import type { InterfaceFlags } from "./config/interface-settings.ts";
import { nearestName } from "./edit-distance.ts";
import { bundledShortlistKeyword } from "./select/shortlist-source.ts";

export type { CiCommand, GatesCommand, VerifyCommand };
export { InvalidCommandLineError };

/**
 * Flags only, left null wherever the caller said nothing: the environment and swarm.toml sit
 * between flags and defaults, and only the composition root sees all three layers, so
 * resolution lives in src/config/settings.ts rather than here.
 */
export interface RunCommand {
  readonly maxTokens?: number;
  readonly recovery?: {
    readonly history: readonly import("./core/model-client.ts").ConversationMessage[];
    readonly remainingTokens: number;
    readonly remainingWallMs: number;
    readonly deadline: number;
    readonly source: { readonly sessionId: string; readonly head: string };
    readonly previousCriteria: import("./gates/gate-set-seal.ts").GateSetSeal;
    readonly previousSpec: import("./evidence/run-spec.ts").RunSpec;
  };
  readonly command: "run";
  readonly task: string;
  readonly modelSpec: string | null;
  /**
   * Where commands run: a container runtime, optionally with an image, or null for the host.
   * Null is `restricted` mode, and the execution envelope says so rather than implying it.
   */
  readonly isolation: string | null;
  /**
   * Line-delimited JSON on stdout instead of the text a person reads: one line per event and
   * one result at the end, each naming its schema.
   */
  readonly json: boolean;
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
  /**
   * Where commands run: a container runtime, optionally with an image, or null for the host.
   * Null is `restricted` mode, and the execution envelope says so rather than implying it.
   */
  readonly isolation: string | null;
  /**
   * Line-delimited JSON on stdout instead of the text a person reads: one line per event and
   * one result at the end, each naming its schema.
   */
  readonly json: boolean;
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

export interface ReplayCommand {
  readonly command: "replay";
  readonly bundleDirectory: string;
}

/**
 * Removes stored sessions older than a window. Deleting evidence is not a default, so the
 * sweep reports what it would remove and does nothing until told.
 */
export interface GcCommand {
  readonly command: "gc";
  readonly olderThan: string;
  readonly remove: boolean;
}

export interface RunsCommand {
  readonly command: "list-runs";
}

export interface InspectCommand {
  readonly command: "inspect";
  readonly runId: string;
  readonly json: boolean;
}

export interface ResumeCommand {
  readonly command: "resume";
  readonly runId: string;
}

export interface RetryStepCommand {
  readonly command: "retry-step";
  readonly runId: string;
  readonly stepId: string;
}

export interface AbortCommand {
  readonly command: "abort";
  readonly runId: string;
}

export interface RepairCommand {
  readonly command: "repair";
  readonly runId: string;
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
  readonly details?: boolean;
  readonly tui?: boolean;
  readonly installDependencies?: boolean;
  readonly bootstrap?: "node";
  readonly goalChecksFile?: string;
  readonly maxTokens?: number;
  readonly repairAttempts?: number;
  readonly modelConcurrency?: number;
  readonly testConcurrency?: number;
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
  readonly isolation: string | null;
  readonly json: boolean;
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

export interface VersionCommand {
  readonly command: "version";
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
  | VersionCommand
  | RunCommand
  | SessionCommand
  | DoctorCommand
  | ReplayCommand
  | VerifyCommand
  | GcCommand
  | CiCommand
  | RunsCommand
  | InspectCommand
  | ResumeCommand
  | RetryStepCommand
  | AbortCommand
  | RepairCommand
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
  '  [--attempts <n>] [--max-steps <n>] [--max-tokens <n>] [--max-wall-minutes <n>] [--local-endpoint <url>] ["<task>"]',
  "",
  "  swarm                                            a session: type tasks, one after another",
  "",
  ...commandHelpLines,
  "    --allowed-files <a,b>                          the scope you authorise; without it the",
  "                                                   file-set gate reports observed scope only",
  '  swarm calibrate --add-case "<task>" --seed <a,b> --gate "<command>"',
  "  swarm --version                                  which build this is",
  "    --redundancy <n>                               try each task n ways, land the best",
  "    --concurrency <n>                              how many may hold a worktree at once",
  "    --bootstrap node                               establish Node 24 checks on an empty Git base",
  "",
  "    [--immutable <a,b>] [--json]                   the base, trusting nothing that made it",
  "    [--contract <file>] [--isolation <runtime[:image]>] [--bundle <dir>]",
  "    [--agent-stream <file>]                        replay another agent's own event stream",
  "    [--agent-format generic|claude-code]           beside it, so the record is not a guess",
  "    [--install]                                    install the checkout's dependencies first,",
  "                                                   without which a real project measures nothing",
  "    [--oracle <command>]                           what says the task was done; without it the",
  "                                                   task is unjudged and nothing is verified",
  "",
  "",
  "  --json                         line-delimited JSON on stdout: one line per event, one",
  "                                 result at the end, each naming its schema",
  "  --isolation <runtime[:image]>  run commands behind a kernel-enforced boundary",
  "                                 (docker, podman, nerdctl); default none, which is the host",
  "",
  "the screen:",
  "  --no-tui                     plain lines even on a terminal",
  "  --details                    parallel: include worker events and the full assurance report",
  "  --color, --no-color          paint, or do not, whatever the terminal says",
  "  --open-evidence              open the review page when the run finishes",
  "  --no-open-evidence           never open it",
  "",
  "swarm.toml holds the same settings, plus [theme] and [keys]. Flags win over it.",
].join("\n");

/** Three is the floor: two repeats cannot show a spread, and a spread is the point. */
const defaultRepeats = 3;

interface CommandLineContext {
  readonly currentDirectory: string;
}

const invalid = (problem: string) => new InvalidCommandLineError(problem, usage);

export function parseCommandLine(
  argv: readonly string[],
  context: CommandLineContext,
): CommandLine {
  const line = tokenizeCommandLine(argv, { ...context, usage });
  const { words, flags } = line;

  // Before anything else: asking for help must not be able to fail for the reason a person
  // is asking for help.
  if (flags.has("help") || words[0] === "help") {
    return { command: "help" };
  }

  // After help, which is what a person asks for when the line is wrong, and before everything
  // else for the same reason help is: the parser reads the word after a flag as its value, so
  // asking a question that takes no argument must not be able to fail for needing one.
  if (flags.has("version") || words[0] === "version") {
    return { command: "version" };
  }

  const verifyOnly = parseVerifyOnlyCommand(line, { ...context, usage });
  if (verifyOnly !== null) {
    return verifyOnly;
  }

  if (words[0] === "list-runs") {
    return { command: "list-runs" };
  }

  for (const name of ["inspect", "resume", "abort", "repair"] as const) {
    if (words[0] === name) {
      const runId = words[1]?.trim() ?? "";
      if (runId.length === 0) {
        throw invalid(`${name} needs a run id. Try swarm list-runs`);
      }
      return name === "inspect"
        ? { command: "inspect", runId, json: flags.has("json") }
        : { command: name, runId };
    }
  }

  if (words[0] === "retry-step") {
    const runId = words[1]?.trim() ?? "";
    const stepId = words[2]?.trim() ?? "";
    if (runId.length === 0 || stepId.length === 0) {
      throw invalid("retry-step needs a run id and a step id. Try swarm inspect <run-id>");
    }
    return { command: "retry-step", runId, stepId };
  }

  if (words[0] === "gc") {
    return {
      command: "gc",
      olderThan: flags.get("older-than") ?? "30d",
      remove: flags.has("remove"),
    };
  }

  if (words[0] === "replay") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw invalid("replay needs a bundle directory");
    }
    return {
      command: "replay",
      bundleDirectory: resolve(context.currentDirectory, target),
    };
  }

  if (words[0] === "review") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw invalid("review needs a bundle directory");
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
    if (flags.has("bootstrap") && (flags.get("bootstrap") !== "node" || !asked))
      throw invalid("--bootstrap node requires --goal and supports an empty Git base with Node 24");
    if (named === asked) {
      throw invalid(
        named
          ? "parallel takes --tasks <file> or --goal <text>, not both: one of them is the " +
              "decomposition and two would disagree"
          : "parallel needs --tasks <file>, one task per line or a JSON task graph, or " +
              "--goal <text> for the run to break into tasks itself",
      );
    }
    return {
      command: "parallel",
      ...(flags.has("install") ? { installDependencies: true } : {}),
      ...(flags.has("details") ? { details: true } : {}),
      ...(flags.has("no-tui") ? { tui: false } : {}),
      ...(flags.has("bootstrap") ? { bootstrap: "node" as const } : {}),
      ...(flags.has("goal-checks")
        ? { goalChecksFile: resolve(context.currentDirectory, flags.get("goal-checks") ?? "") }
        : {}),
      ...(flags.has("max-tokens")
        ? { maxTokens: parseFlagCount(flags.get("max-tokens"), "--max-tokens") ?? 200_000 }
        : {}),
      ...(flags.has("repair-attempts")
        ? {
            repairAttempts:
              parseFlagCount(flags.get("repair-attempts"), "--repair-attempts", 0) ?? 2,
          }
        : {}),
      ...(flags.has("model-concurrency")
        ? {
            modelConcurrency:
              parseFlagCount(flags.get("model-concurrency"), "--model-concurrency") ?? 1,
          }
        : {}),
      ...(flags.has("test-concurrency")
        ? {
            testConcurrency:
              parseFlagCount(flags.get("test-concurrency"), "--test-concurrency") ?? 1,
          }
        : {}),
      tasksFile: named ? resolve(context.currentDirectory, tasksFile) : null,
      goal: asked ? goal.trim() : null,
      isolation: flags.get("isolation") ?? null,
      json: flags.has("json"),
      workspace,
      baseRef: flags.get("base") ?? defaultBaseRef,
      maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
      attempts: parseFlagCount(flags.get("attempts"), "--attempts", 0),
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

  const shared = {
    modelSpec: flags.get("model") ?? null,
    isolation: flags.get("isolation") ?? null,
    json: flags.has("json"),
    workspace,
    maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
    bundleDirectory,
    baseRef: flags.get("base") ?? defaultBaseRef,
    attempts: parseFlagCount(flags.get("attempts"), "--attempts", 0),
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
    throw invalid(
      `"${task}" is not a command in this build, and one word on its own is read as a task, ` +
        `so this would have started an agent run. Did you mean "swarm ${nearest}"? ` +
        "If it really is the task, give it more than one word",
    );
  }

  return {
    command: "run",
    task,
    ...shared,
    ...(flags.has("max-tokens")
      ? { maxTokens: parseFlagCount(flags.get("max-tokens"), "--max-tokens") ?? 0 }
      : {}),
  };
}

/** Subcommands, for telling a typo from a task. Not the parser's source of truth, deliberately: this list going stale makes a suggestion worse, never a command unreachable. */
const knownCommands = commandDefinitions.map((command) => command.name);

/** The closest command within two edits, or null when the word is not close to any of them. */
function nearestCommand(task: string): string | null {
  return task.includes(" ") ? null : nearestName(task, [...knownCommands]);
}

/** Levenshtein, two rows rather than a matrix. The words compared here are never long. */
/** Both halves of a pair named at once is a contradiction, so it is an error rather than an order. */
function parseInterfaceFlags(flags: ReadonlyMap<string, string>): InterfaceFlags {
  if (flags.has("color") && flags.has("no-color")) {
    throw invalid("--color and --no-color contradict each other");
  }
  if (flags.has("open-evidence") && flags.has("no-open-evidence")) {
    throw invalid("--open-evidence and --no-open-evidence contradict each other");
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
    throw invalid("--add-case needs --seed <file,file> naming the files the case starts from");
  }
  const gateCommand = flags.get("gate");
  if (gateCommand === undefined || gateCommand.trim().length === 0) {
    throw invalid(
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
    throw invalid(
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
/**
 * A count from the command line. `floor` is the smallest value that means anything for this
 * flag: zero attempts is a real request, since measuring the first answer without the
 * auto-resolve loop is what `swarm gates` already does internally and what an evaluation arm
 * needs, while zero steps could not run anything at all.
 */
function parseFlagCount(raw: string | undefined, flag: string, floor = 1): number | null {
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < floor) {
    throw invalid(
      floor === 0
        ? `${flag} must be a whole number of zero or more, got "${raw}"`
        : `${flag} must be a positive whole number, got "${raw}"`,
    );
  }
  return parsed;
}

function parseLocalEndpoint(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    throw invalid(`--local-endpoint must be an http(s) url, got "${raw}"`);
  }
  return raw;
}
