import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describeRunningVersion } from "./build-version.ts";
import { diagnose, remediesFor, runtimeFinding } from "./install/health.ts";
import { inspectInstall } from "./install/inspect.ts";
import { describeInstall } from "./install/report.ts";

export interface DoctorCommand {
  readonly fix: boolean;
  /** False skips the registry lookup, which is the only part that needs a network. */
  readonly askRegistry: boolean;
}

/**
 * What owns the `swarm` command, and with `--fix`, making the right thing own it.
 *
 * A development checkout linked into the global prefix owns the command until it is removed,
 * and npm cannot install over it: the install either fails renaming a symlinked directory aside
 * or succeeds behind a stale executable that still points at the checkout. Neither presents as
 * what it is. This asks the question directly and answers it.
 */
export async function doctor(options: DoctorCommand): Promise<number> {
  const here = resolve(import.meta.dirname, "..");
  const snapshot = await inspectInstall({
    runningVersion: await runningVersion(here),
    runningFrom: await realpath(here).catch(() => here),
    path: process.env.PATH ?? "",
    askRegistry: options.askRegistry,
  });

  const findings = diagnose(snapshot);
  const remedies = remediesFor(findings);
  const report = [...findings, runtimeFinding(process.version)];
  for (const line of describeInstall(report, remedies.length > 0 && !options.fix)) {
    process.stdout.write(`${line}\n`);
  }

  if (!options.fix || remedies.length === 0) {
    return findings.some((finding) => finding.severity === "broken") ? 1 : 0;
  }

  for (const command of remedies) {
    process.stdout.write(`running: ${command}\n`);
    const [file, ...args] = command.split(" ");
    if (file === undefined) {
      continue;
    }
    // An argument vector, not a shell: these are commands this file wrote, and keeping a shell
    // out of the one path that repairs an install keeps it that way.
    const finished = await new Promise<number>((settle) => {
      const child = spawn(file, args, { stdio: "inherit" });
      child.on("error", () => {
        settle(1);
      });
      child.on("close", (code) => {
        settle(code ?? 1);
      });
    });
    if (finished !== 0) {
      process.stdout.write(`\n${command} exited ${finished}, so the rest was not run.\n`);
      return 1;
    }
  }

  process.stdout.write("\nfixed. Run swarm doctor again to see what owns the command now.\n");
  return 0;
}

export async function runningVersion(packageRoot: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const version =
      manifest !== null && typeof manifest === "object"
        ? (manifest as { readonly version?: unknown }).version
        : undefined;
    if (typeof version !== "string") return "unknown";
    let describe: string | null = null;
    try {
      const source: unknown = JSON.parse(
        await readFile(join(import.meta.dirname, "source.json"), "utf8"),
      );
      const recorded = (source as { readonly describe?: unknown } | null)?.describe;
      describe = typeof recorded === "string" ? recorded : null;
    } catch {
      // Run from source, or built before builds recorded their commit: the manifest's version is all there is.
    }
    return describeRunningVersion(version, describe);
  } catch {
    return "unknown";
  }
}
