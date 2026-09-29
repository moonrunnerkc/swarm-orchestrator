import type { CommandOptions, GateCommandRunner } from "./gate-definition.ts";

/**
 * The same runner with directories the authorized install prepared put first on PATH for every
 * command that follows, so a check whose script calls the package manager finds the one the
 * install fetched and recorded. No directories means the runner itself, unchanged.
 */
export function withPreparedTools(
  commands: GateCommandRunner,
  directories: readonly string[],
): GateCommandRunner {
  if (directories.length === 0) return commands;
  const prepared = (options: CommandOptions): CommandOptions => ({
    ...options,
    toolDirectories: [...directories, ...(options.toolDirectories ?? [])],
  });
  return {
    run: (command, options) => commands.run(command, prepared(options)),
    runVouched: (argv, options) => commands.runVouched(argv, prepared(options)),
  };
}
