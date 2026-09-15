import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { InitCommand } from "./cli-options.ts";
import { askOnTerminal } from "./cli-terminal.ts";
import { initializeSwarmToml, initWouldHelp, type PlannedGate } from "./config/init.ts";
import { hasAnyManifest, nodeHarnessFiles } from "./config/node-harness.ts";

const runProcess = promisify(execFile);

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

/**
 * Why a run in a repository with no manifest stops before it starts. The criteria are sealed
 * from the base commit before the model is asked for anything, so a manifest the model adds
 * on the way cannot change what measures it: a run in such a workspace spent three attempts
 * failing four gates that each said "add the manifest".
 */
export class NoManifestError extends Error {
  constructor(workspace: string) {
    super(
      `no manifest in ${workspace}: none of package.json, pyproject.toml, Cargo.toml or go.mod, ` +
        "so no gate can measure what a run writes, and the criteria are sealed from the base " +
        "commit before the model runs. Add the manifest for the language you want and commit " +
        "it, or run swarm on a terminal and answer y to have it add a Node harness (a " +
        "package.json running node --test, and a .gitignore) and commit that.",
    );
    this.name = "NoManifestError";
  }
}

/**
 * Writes the Node harness into a repository with no manifest and commits it, so the base the
 * run is sealed from carries it. Committed on the current branch, with the person's own git
 * identity, because they asked for it on the terminal: this is their commit, not the run's.
 */
export async function establishNodeHarness(workspace: string): Promise<{ commit: string }> {
  const files = nodeHarnessFiles(basename(workspace));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(workspace, name), text, { flag: "wx" });
  }
  const git = async (args: readonly string[]) =>
    (await runProcess("git", [...args], { cwd: workspace })).stdout.trim();
  await git(["add", "--", ...Object.keys(files)]);
  await git(["commit", "-q", "-m", "Add a Node test harness so swarm can measure this project"]);
  return { commit: await git(["rev-parse", "HEAD"]) };
}

/**
 * A repository with no manifest either gets the Node harness, on a terminal and with a yes,
 * or stops here with the remedy named. True where the harness was added and the base moved.
 */
export async function offerNodeHarness(workspace: string): Promise<boolean> {
  const onDisk = initOnDisk(workspace);
  if (await hasAnyManifest((manifest) => onDisk.readFile(join(workspace, manifest)))) {
    return false;
  }
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  if (!isTty) {
    throw new NoManifestError(workspace);
  }
  process.stderr.write(
    `no manifest in ${workspace}, so no gate can measure what a run writes. swarm can add a ` +
      "Node harness, a package.json running node --test and a .gitignore, and commit it.\n",
  );
  const answer = await askOnTerminal("Add the Node harness and commit it? [y/N] ");
  if (answer.trim().toLowerCase() !== "y") {
    throw new NoManifestError(workspace);
  }
  const established = await establishNodeHarness(workspace);
  process.stderr.write(`committed the Node harness as ${established.commit.slice(0, 12)}\n`);
  return true;
}
