import { buildVersion } from "./build-version.ts";
import { UsageError, usageFor } from "./cli-command-definitions.ts";

export type Handler = (args: readonly string[]) => Promise<number>;

/** Dispatches one command line; both binaries share it so they read and exit the same way. */
export async function dispatch(
  program: string,
  handlers: Readonly<Record<string, Handler>>,
  argv: readonly string[],
): Promise<number> {
  const usage = usageFor(program, !("doctor" in handlers));
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (command === "--version") {
    process.stdout.write(`${buildVersion}\n`);
    return 0;
  }
  const handler = handlers[command];
  try {
    if (handler === undefined) throw new UsageError(`"${command}" is not a ${program} command`);
    return await handler(rest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // parseArgs reports an unknown or malformed flag with a code; that is a usage error too.
    const usageProblem =
      error instanceof UsageError ||
      (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS") === true;
    process.stderr.write(usageProblem ? `${message}\n\n${usage}\n` : `${program}: ${message}\n`);
    return usageProblem ? 2 : 1;
  }
}
