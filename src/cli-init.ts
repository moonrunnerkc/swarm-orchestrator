import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { initializeSwarmToml, type PlannedGate } from "./config/init.ts";
import { discoverPackages } from "./config/package-discovery.ts";

const _runProcess = promisify(execFile);

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

export interface InitCommand {
  readonly workspace: string;
  readonly packages?: readonly string[];
  readonly listPackages?: boolean;
}

/** `swarm init`: the file a first run can work from, from what package.json declares. */
export async function init(options: InitCommand): Promise<number> {
  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }
  if (options.listPackages) {
    writeOut(
      (await discoverPackages(options.workspace)).join("\n") ||
        "No declared Node workspace packages; Python directories can be selected explicitly with --package.",
    );
    return 0;
  }
  const outcome = await initializeSwarmToml({
    ...initOnDisk(options.workspace),
    ...(options.packages ? { packages: options.packages } : {}),
  });
  writeOut(`wrote ${outcome.path}`);
  for (const gate of outcome.gates) {
    writeOut(describePlannedGate(gate));
  }
  if (outcome.gates.length === 0) {
    writeOut("  no gate written: package.json declares none of test, lint, typecheck or build");
  }
  return 0;
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}
