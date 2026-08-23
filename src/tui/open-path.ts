import { join } from "node:path";
import { bundleFileNames } from "../evidence/bundle-manifest.ts";

/**
 * Handing a path to the platform's default handler, under the same discipline invariant 7
 * imposes on the arms that measure coverage: an argument vector spawned directly, with no
 * shell in between to re-read an argument, under an environment the harness built rather
 * than inherited. A check that reasons about a command string is reasoning about what a shell
 * will do with text something else wrote, and the path here has a bundle directory in it.
 */

/** Where a path came from. Only one of these may be opened. */
export type PathProvenance = "harness" | "user" | "model" | "tool-output" | "file";

export class UntrustedEvidencePathError extends Error {
  constructor(provenance: PathProvenance) {
    super(
      `refusing to open a path tagged ${provenance}: the evidence panel opens only a directory ` +
        "the harness computed for this session. Nothing a model or a tool produced is opened.",
    );
    this.name = "UntrustedEvidencePathError";
  }
}

/** A bundle directory the harness computed, which is the only thing that can be opened. */
export interface EvidenceLocation {
  readonly directory: string;
}

export function evidenceLocation(directory: string, provenance: PathProvenance): EvidenceLocation {
  if (provenance !== "harness") {
    throw new UntrustedEvidencePathError(provenance);
  }
  return { directory };
}

export type OpenTarget = "review" | "bundle";

export function targetPath(location: EvidenceLocation, target: OpenTarget): string {
  return target === "review"
    ? join(location.directory, bundleFileNames.review)
    : location.directory;
}

export interface OpenCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Windows opens through explorer.exe rather than `start`, which is a cmd.exe builtin and so
 * needs a shell between the harness and the process. The rule is worth more than the idiom.
 */
export function openCommandFor(
  platform: NodeJS.Platform,
  path: string,
  env: Readonly<Record<string, string>>,
): OpenCommand {
  if (platform === "darwin") {
    return { file: "open", args: [path], env };
  }
  if (platform === "win32") {
    return { file: "explorer.exe", args: [path], env };
  }
  return { file: "xdg-open", args: [path], env };
}

/**
 * The names a handler needs to find its way to a display, and nothing that decides what a
 * process loads. `NODE_OPTIONS` is the one this exists to leave behind: it is not in any
 * command string, so no reading of one could have caught it.
 */
const carriedEnvironmentNames: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "SYSTEMROOT",
  "WINDIR",
];

export function openEnvironment(
  ambient: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const built: Record<string, string> = {};
  for (const name of carriedEnvironmentNames) {
    const value = ambient[name];
    if (value !== undefined) {
      built[name] = value;
    }
  }
  return built;
}

/** What a spawn reported. Never throws: failing to open a file must not end a finished run. */
export interface OpenOutcome {
  readonly opened: boolean;
  readonly command: OpenCommand;
  readonly detail: string;
}

export type SpawnHandler = (command: OpenCommand) => Promise<number | null>;

export async function openEvidenceTarget(input: {
  readonly location: EvidenceLocation;
  readonly target: OpenTarget;
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string>>;
  readonly spawn: SpawnHandler;
}): Promise<OpenOutcome> {
  const command = openCommandFor(
    input.platform,
    targetPath(input.location, input.target),
    input.env,
  );
  try {
    const code = await input.spawn(command);
    return code === 0
      ? { opened: true, command, detail: `${command.file} exited 0` }
      : { opened: false, command, detail: `${command.file} exited ${code ?? "on a signal"}` };
  } catch (cause) {
    return {
      opened: false,
      command,
      detail: `${command.file} could not be started: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  }
}
