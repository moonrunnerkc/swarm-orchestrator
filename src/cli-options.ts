import { resolve } from "node:path";
import { bundledShortlistKeyword } from "./select/shortlist-source.ts";

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
  readonly localEndpoint: string | null;
}

/** Runs the gates over a workspace and reports, with no model and no retries. */
export interface GatesCommand {
  readonly command: "gates";
  readonly workspace: string;
  readonly baseRef: string;
  readonly bundleDirectory: string | null;
}

export interface ReplayCommand {
  readonly command: "replay";
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
  /** One task per line. A file rather than repeated flags, so a run is reproducible. */
  readonly tasksFile: string;
  readonly workspace: string;
  readonly baseRef: string;
  readonly maxSteps: number | null;
  readonly attempts: number | null;
  readonly bundleDirectory: string | null;
  readonly modelSpec: string | null;
  readonly localEndpoint: string | null;
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
  | RunCommand
  | ReplayCommand
  | GatesCommand
  | SelectCommand
  | CalibrateCommand
  | AddCaseCommand
  | RoutingCommand
  | ParallelCommand;

export class InvalidCommandLineError extends Error {
  constructor(problem: string) {
    super(
      `${problem}. Usage: swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] ` +
        `[--base <ref>] [--attempts <n>] [--local-endpoint <url>] "<task>", ` +
        "swarm gates [--workspace <dir>] [--base <ref>], " +
        "swarm select [--shortlist <file|url|bundled>], swarm calibrate [--models <a,b>] " +
        '[--repeats <n>], swarm calibrate --add-case "<task>" --seed <a,b> --gate "<command>", ' +
        "swarm routing, swarm parallel --tasks <file>, or swarm replay <bundle directory>",
    );
    this.name = "InvalidCommandLineError";
  }
}

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
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InvalidCommandLineError(`${argument} needs a value`);
    }
    flags.set(argument.slice(2), value);
    index += 1;
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
    if (tasksFile === undefined || tasksFile.trim().length === 0) {
      throw new InvalidCommandLineError(
        "parallel needs --tasks <file>, one task per line: a worker is started per line and " +
          "named after its position",
      );
    }
    return {
      command: "parallel",
      tasksFile: resolve(context.currentDirectory, tasksFile),
      workspace,
      baseRef: flags.get("base") ?? defaultBaseRef,
      maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
      attempts: parseFlagCount(flags.get("attempts"), "--attempts"),
      bundleDirectory,
      modelSpec: flags.get("model") ?? null,
      localEndpoint: parseLocalEndpoint(flags.get("local-endpoint")),
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

  if (words[0] === "select") {
    return { command: "select", shortlist: resolveShortlist(flags.get("shortlist"), context) };
  }

  if (words[0] === "gates") {
    return {
      command: "gates",
      workspace,
      baseRef: flags.get("base") ?? defaultBaseRef,
      bundleDirectory,
    };
  }

  const task = words.join(" ").trim();
  if (task.length === 0) {
    throw new InvalidCommandLineError("nothing to do");
  }

  return {
    command: "run",
    task,
    modelSpec: flags.get("model") ?? null,
    workspace,
    maxSteps: parseFlagCount(flags.get("max-steps"), "--max-steps"),
    bundleDirectory,
    baseRef: flags.get("base") ?? defaultBaseRef,
    attempts: parseFlagCount(flags.get("attempts"), "--attempts"),
    localEndpoint: parseLocalEndpoint(flags.get("local-endpoint")),
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
