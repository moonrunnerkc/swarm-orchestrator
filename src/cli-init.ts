import { statSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import type { InitCommand } from "./cli-options.ts";
import { askOnTerminal } from "./cli-terminal.ts";
import { initializeSwarmToml, initWouldHelp, type PlannedGate } from "./config/init.ts";

const initOnDisk = (workspace: string) => ({
  workspace,
  exists: (path: string) =>
    access(path).then(
      () => true,
      () => false,
    ),
  readFile: (path: string) =>
    readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") {
        return null;
      }
      throw cause;
    }),
  writeFile: (path: string, text: string) => writeFile(path, text, "utf8"),
});

function describePlannedGate(gate: PlannedGate): string {
  return (
    `  ${gate.id}: ${gate.command} (${gate.parser}, ${gate.severity}) from scripts.${gate.script}` +
    (gate.reason === null ? "" : `\n    ${gate.reason}`)
  );
}

/** `swarm init`: the file a first run can work from, from what package.json declares. */
export async function init(options: InitCommand): Promise<number> {
  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }
  const outcome = await initializeSwarmToml(initOnDisk(options.workspace));
  writeOut(`wrote ${outcome.path}`);
  for (const gate of outcome.gates) {
    writeOut(describePlannedGate(gate));
  }
  if (outcome.gates.length === 0) {
    writeOut("  no gate written: package.json declares none of test, lint, typecheck or build");
  }
  return 0;
}

/**
 * The first run in a workspace with a manifest and no swarm.toml offers to write one, in the
 * one question the chokepoint's plain path asks and with the same answer key. Off a terminal
 * nothing is asked and nothing is written: the run works from what the harness detects, as
 * it always did.
 */
export async function offerInit(workspace: string): Promise<void> {
  const onDisk = initOnDisk(workspace);
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  if (!isTty || !(await initWouldHelp(onDisk))) {
    return;
  }
  process.stderr.write(
    "no swarm.toml here, and package.json declares scripts: swarm init would write one with " +
      "the gates read off them, each naming the rule that reads it.\n",
  );
  const answer = await askOnTerminal('Run "swarm init" first? [y/N] ');
  if (answer.trim().toLowerCase() !== "y") {
    return;
  }
  const outcome = await initializeSwarmToml(onDisk);
  process.stderr.write(`wrote ${outcome.path}\n`);
  for (const gate of outcome.gates) {
    process.stderr.write(`${describePlannedGate(gate)}\n`);
  }
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}
