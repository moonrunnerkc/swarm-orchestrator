import { resolve } from "node:path";

export interface RunCommand {
  readonly command: "run";
  readonly task: string;
  readonly modelSpec: string;
  readonly workspace: string;
  readonly maxSteps: number;
  /** Null means the session's own directory, which is outside the workspace by design. */
  readonly bundleDirectory: string | null;
}

export interface ReplayCommand {
  readonly command: "replay";
  readonly bundleDirectory: string;
}

export type CommandLine = RunCommand | ReplayCommand;

export class InvalidCommandLineError extends Error {
  constructor(problem: string) {
    super(
      `${problem}. Usage: swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] "<task>", ` +
        "or swarm replay <bundle directory>",
    );
    this.name = "InvalidCommandLineError";
  }
}

const defaultModelSpec = "anthropic:claude-opus-5";
const defaultMaxSteps = 40;

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

  const task = words.join(" ").trim();
  if (task.length === 0) {
    throw new InvalidCommandLineError("nothing to do");
  }

  const bundle = flags.get("bundle");
  return {
    command: "run",
    task,
    modelSpec: flags.get("model") ?? context.env.SWARM_MODEL ?? defaultModelSpec,
    // Resolved against the injected directory, not the ambient cwd, so a relative
    // --workspace lands where the caller says it does.
    workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
    maxSteps: parseMaxSteps(flags.get("max-steps")),
    bundleDirectory: bundle === undefined ? null : resolve(context.currentDirectory, bundle),
  };
}

/**
 * A non-numeric budget used to reach the loop as NaN, and every `steps >= NaN`
 * comparison is false, so the step limit silently stopped applying.
 */
function parseMaxSteps(raw: string | undefined): number {
  if (raw === undefined) {
    return defaultMaxSteps;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidCommandLineError(`--max-steps must be a positive whole number, got "${raw}"`);
  }
  return parsed;
}
