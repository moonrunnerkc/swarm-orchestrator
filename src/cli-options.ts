import { resolve } from "node:path";

export interface CommandLine {
  readonly task: string;
  readonly modelSpec: string;
  readonly workspace: string;
  readonly maxSteps: number;
}

export class InvalidCommandLineError extends Error {
  constructor(problem: string) {
    super(`${problem}. Usage: swarm [--model <provider:id>] [--workspace <dir>] "<task>"`);
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

  const task = words.join(" ").trim();
  if (task.length === 0) {
    throw new InvalidCommandLineError("nothing to do");
  }

  return {
    task,
    modelSpec: flags.get("model") ?? context.env.SWARM_MODEL ?? defaultModelSpec,
    // Resolved against the injected directory, not the ambient cwd, so a relative
    // --workspace lands where the caller says it does.
    workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
    maxSteps: parseMaxSteps(flags.get("max-steps")),
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
