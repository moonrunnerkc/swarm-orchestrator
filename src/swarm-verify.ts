#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { commandDefinitions } from "./cli-command-definitions.ts";
import { gates } from "./cli-gates.ts";
import { verifyBundle } from "./cli-verify.ts";
import {
  InvalidCommandLineError,
  parseVerifyOnlyCommand,
  tokenizeCommandLine,
  type VerifyOnlyCommand,
} from "./cli-verify-options.ts";
import { exitCodes } from "./machine-output.ts";

/**
 * The verification path on its own: the three commands that need no model, no provider key and
 * no local backend, sharing their parsers and their implementations with the full CLI so an
 * invocation reads the same through either. What this binary does not carry is the agent.
 */
const verifyOnlyNames = new Set(
  commandDefinitions.filter((command) => command.model === "none").map((command) => command.name),
);

export const usage = [
  "swarm-verify <command> [options]",
  "",
  ...commandDefinitions
    .filter((command) => verifyOnlyNames.has(command.name))
    .map((command) => `  swarm-verify ${command.syntax.padEnd(42)} ${command.description}`),
  "",
  "These need no model, no provider key and no local backend. The full agent is swarm-orchestrator.",
].join("\n");

async function main(): Promise<number> {
  const context = { currentDirectory: process.cwd(), usage };
  const line = tokenizeCommandLine(process.argv.slice(2), context);
  if (line.flags.has("help") || line.words[0] === "help" || line.words.length === 0) {
    process.stdout.write(`${usage}\n`);
    return exitCodes.acceptable;
  }
  const parsed: VerifyOnlyCommand | null = parseVerifyOnlyCommand(line, context);
  if (parsed === null) {
    throw new InvalidCommandLineError(`"${line.words[0]}" is not a command this binary has`, usage);
  }
  if (parsed.command === "verify") {
    return verifyBundle(parsed);
  }
  if (parsed.command === "gates") {
    return gates(parsed);
  }
  return (await import("./cli-ci.ts")).verifyPatch(parsed);
}

// The same two outcomes the full CLI's entry point has, so a script driving either binary reads
// the same exit code for the same failure.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = exitCodes.notAcceptable;
  },
);
