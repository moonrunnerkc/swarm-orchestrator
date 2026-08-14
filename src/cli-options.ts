import { resolve } from "node:path";
import { bundledShortlistKeyword } from "./select/shortlist-source.ts";

export interface RunCommand {
  readonly command: "run";
  readonly task: string;
  readonly modelSpec: string;
  readonly workspace: string;
  readonly maxSteps: number;
  /** Null means the session's own directory, which is outside the workspace by design. */
  readonly bundleDirectory: string | null;
  /** The commit the gates measure the change against. */
  readonly baseRef: string;
  /** How many auto-resolve retries a blocking gate failure gets. */
  readonly attempts: number;
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

/** Probes the machine and recommends a local model for it. */
export interface SelectCommand {
  readonly command: "select";
  /** A URL, a file path, or "bundled". Null takes the list the project publishes. */
  readonly shortlist: string | null;
}

export type CommandLine = RunCommand | ReplayCommand | GatesCommand | SelectCommand;

export class InvalidCommandLineError extends Error {
  constructor(problem: string) {
    super(
      `${problem}. Usage: swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] ` +
        `[--base <ref>] [--attempts <n>] "<task>", swarm gates [--workspace <dir>] [--base <ref>], ` +
        "swarm select [--shortlist <file|url|bundled>], or swarm replay <bundle directory>",
    );
    this.name = "InvalidCommandLineError";
  }
}

const defaultModelSpec = "anthropic:claude-opus-5";
const defaultMaxSteps = 40;
const defaultBaseRef = "HEAD";
const defaultAttempts = 3;

export interface CommandLineContext {
  readonly env: Record<string, string | undefined>;
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
    modelSpec: flags.get("model") ?? context.env.SWARM_MODEL ?? defaultModelSpec,
    workspace,
    maxSteps: parseMaxSteps(flags.get("max-steps")),
    bundleDirectory,
    baseRef: flags.get("base") ?? defaultBaseRef,
    attempts: parseCount(flags.get("attempts"), "--attempts", defaultAttempts),
  };
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
function parseMaxSteps(raw: string | undefined): number {
  return parseCount(raw, "--max-steps", defaultMaxSteps);
}

function parseCount(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidCommandLineError(`${flag} must be a positive whole number, got "${raw}"`);
  }
  return parsed;
}
