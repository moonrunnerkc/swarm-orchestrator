import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { GlobalEntry, InstallSnapshot } from "./health.ts";

const runProcess = promisify(execFile);

/** Long enough for npm to answer on a cold cache, short enough that a broken npm is not a hang. */
const npmTimeoutMs = 15_000;

interface InspectOptions {
  readonly runningVersion: string;
  readonly runningFrom: string;
  readonly path: string;
  /** False skips the registry lookup, which is the only part that needs a network. */
  readonly askRegistry: boolean;
}

/**
 * Everything the report is computed from, gathered here so `diagnose` stays pure and the
 * awkward half, npm subprocesses and symlink stats, is the part with no branching in it.
 */
export async function inspectInstall(options: InspectOptions): Promise<InstallSnapshot> {
  const globalRoot = await npmValue(["root", "-g"]);
  const globalEntry = globalRoot === null ? null : await readGlobalEntry(globalRoot);

  return {
    runningVersion: options.runningVersion,
    runningFrom: options.runningFrom,
    globalRoot,
    globalEntry,
    binsOnPath: await swarmBinariesOn(options.path),
    publishedVersion: options.askRegistry
      ? await npmValue(["view", "swarm-orchestrator", "version"])
      : null,
  };
}

async function npmValue(args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await runProcess("npm", [...args], { timeout: npmTimeoutMs });
    const value = stdout.trim();
    return value.length === 0 ? null : value;
  } catch {
    // npm missing, offline, or a registry that will not answer. None of those is this tool's
    // to report, and a snapshot with a null in it says less rather than something untrue.
    return null;
  }
}

async function readGlobalEntry(globalRoot: string): Promise<GlobalEntry | null> {
  const path = join(globalRoot, "swarm-orchestrator");
  let isLink: boolean;
  try {
    isLink = (await lstat(path)).isSymbolicLink();
  } catch {
    return null;
  }

  const target = isLink ? await realpath(path).catch(() => null) : null;
  return { path, isLink, target, version: await versionAt(target ?? path) };
}

async function versionAt(directory: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const version =
      manifest !== null && typeof manifest === "object"
        ? (manifest as { readonly version?: unknown }).version
        : undefined;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Every `swarm` on PATH rather than the first, because the whole failure is one of them
 * shadowing another and `command -v` shows only the winner.
 */
async function swarmBinariesOn(path: string): Promise<readonly string[]> {
  const found: string[] = [];
  for (const directory of path.split(delimiter).filter((entry) => entry.length > 0)) {
    const candidate = join(directory, "swarm");
    try {
      await lstat(candidate);
      if (!found.includes(candidate)) {
        found.push(candidate);
      }
    } catch {
      // Not there, which is the ordinary case for most of PATH.
    }
  }
  return found;
}
