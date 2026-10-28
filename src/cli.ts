#!/usr/bin/env node
// Check the runtime before loading the command composition.
import "./node-floor-check.ts";

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { doctor, runningVersion } from "./cli-doctor.ts";
import {
  InvalidCommandLineError,
  parseVerifyOnlyCommand,
  tokenizeCommandLine,
} from "./cli-verify-options.ts";
import { exitCodes } from "./machine-output.ts";

export const usage = [
  "swarm <command> [options]",
  "",
  "  swarm verify <bundle> [--signer <key>]      check a recorded bundle offline",
  "  swarm ci [--base <ref>] [--workspace <dir>] measure a change in a clean checkout",
  "  swarm init [--workspace <dir>]              write swarm.toml from the project's declared checks",
  "  swarm doctor [--fix] [--offline]            report what owns the swarm command",
].join("\n");

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    process.stdout.write(`${usage}\n`);
    return exitCodes.acceptable;
  }
  if (command === "--version") {
    process.stdout.write(`${await runningVersion(resolve(import.meta.dirname, ".."))}\n`);
    return exitCodes.acceptable;
  }
  if (command === "doctor") {
    const { values } = parseArgs({
      args: [...rest],
      options: { fix: { type: "boolean" }, offline: { type: "boolean" } },
    });
    return doctor({ fix: values.fix === true, askRegistry: values.offline !== true });
  }
  if (command === "init") {
    const { values } = parseArgs({
      args: [...rest],
      options: { workspace: { type: "string" }, package: { type: "string", multiple: true } },
    });
    return (await import("./cli-init.ts")).init({
      workspace: resolve(values.workspace ?? process.cwd()),
      ...(values.package === undefined ? {} : { packages: values.package }),
    });
  }
  const context = { currentDirectory: process.cwd(), usage };
  const parsed = parseVerifyOnlyCommand(tokenizeCommandLine(argv, context), context);
  if (parsed?.command === "verify") {
    return (await import("./cli-verify.ts")).verifyBundle(parsed);
  }
  if (parsed?.command === "ci") {
    return (await import("./cli-ci.ts")).verifyPatch(parsed);
  }
  throw new InvalidCommandLineError(`"${command}" is not a swarm command`, usage);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode =
      error instanceof InvalidCommandLineError ? exitCodes.invalidRequest : exitCodes.notAcceptable;
  },
);
