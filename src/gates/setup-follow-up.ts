import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { nodeHeadersProbeScript, npmDeferredScripts } from "./deferred-setup.ts";
import { uvDeferredWork } from "./python-offline-build.ts";
import {
  type DeferredWork,
  type FollowUpContext,
  notRunOffline,
  offlineProbe,
  outputTail,
} from "./setup-effect.ts";

export type { NetworkProbe, SetupEffect, SetupEffectOutcome } from "./setup-effect.ts";

export interface DeferredSetupResult {
  readonly details: readonly string[];
  readonly toolDirectories: readonly string[];
  /** A follow-up step changed source files, which fails the whole setup. */
  readonly sourceChanged: boolean;
}

/** Where a pnpm fetched for the install is kept, relative to the unit it installed. */
const pnpmToolPrefix = "node_modules/.swarm-pnpm";

/**
 * The work a scripts-off install leaves undone, in two kinds. A fetch that executes nothing (the
 * pnpm the install used, a build backend's wheels, a source archive's bytes) keeps the install's
 * registry access. Anything that executes registry-served code (a dependency's install script, a
 * build backend, a source distribution's setup.py) runs only where a check-time command was just
 * measured unable to connect, through the same runner and environment as the checks; where that
 * cannot be shown it does not run, and the detail says so.
 */
export async function completeDeferredSetup(
  context: FollowUpContext,
): Promise<DeferredSetupResult> {
  const details: string[] = [];
  const toolDirectories: string[] = [];
  if (context.lockfile === "pnpm-lock.yaml" && context.installArgv[0] === "npx") {
    const kept = await keepFetchedPnpm(context);
    if (kept.sourceChanged) return { details: [kept.detail], toolDirectories, sourceChanged: true };
    details.push(kept.detail);
    if (kept.directory !== null) toolDirectories.push(kept.directory);
  }
  const deferred =
    context.lockfile === "package-lock.json"
      ? await npmDeferredWork(context)
      : context.lockfile === "uv.lock"
        ? await uvDeferredWork(context)
        : null;
  if (deferred !== null) {
    details.push(deferred.detail);
    if (deferred.sourceChanged) return { details, toolDirectories, sourceChanged: true };
  }
  return { details, toolDirectories, sourceChanged: false };
}

/**
 * The install fetched pnpm for its own command only, so a script calling `pnpm` found none. The
 * same declared version is fetched again, scripts off, into the checkout's ignored
 * node_modules, and its bin directory goes on the checks' PATH through the built environment.
 */
async function keepFetchedPnpm(
  context: FollowUpContext,
): Promise<{ detail: string; directory: string | null; sourceChanged: boolean }> {
  const version = context.installArgv[3] ?? "";
  const directory = join(context.workspace, pnpmToolPrefix, "node_modules", ".bin");
  const outcome = await context.effect({
    argv: [
      "npm",
      "install",
      "--prefix",
      pnpmToolPrefix,
      "--no-save",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      version,
    ],
    network: "registry",
    stage: "package-manager",
    toolDirectory: directory,
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${version} kept at ${pnpmToolPrefix} and put first on the checks' PATH, so a script that calls pnpm runs the pnpm that installed`
        : `${version} could not be kept for the checks (exit ${observed.exitCode}), so a script that calls pnpm finds none: ${outputTail(observed)}`,
  });
  const present =
    outcome.succeeded &&
    (await lstat(join(directory, "pnpm")).then(
      () => true,
      () => false,
    ));
  return {
    detail:
      outcome.succeeded && !present
        ? `${version} was fetched but left no pnpm in ${pnpmToolPrefix}, so a script that calls pnpm finds none`
        : outcome.detail,
    directory: present ? directory : null,
    sourceChanged: outcome.sourceChanged,
  };
}

async function npmDeferredWork(context: FollowUpContext): Promise<DeferredWork | null> {
  const deferred = await npmDeferredScripts(context.workspace);
  const refused =
    deferred.refused.length === 0
      ? ""
      : `; lockfile entries under names no command is handed were left out: ${deferred.refused.join(", ")}`;
  if (deferred.packages.length === 0)
    return refused === "" ? null : { detail: refused.slice(2), sourceChanged: false };
  const what = `install scripts of ${deferred.packages.length} dependenc${deferred.packages.length === 1 ? "y" : "ies"} (${deferred.packages.join(", ")})`;
  const { proof, probe } = await offlineProbe(context);
  if (proof === null)
    return { detail: `${notRunOffline(what, probe)}${refused}`, sourceChanged: false };
  // node-gyp downloads node's headers unless told where local ones are, and that download is
  // refused offline; the running node's own prefix carries them in the default image.
  const headers = await context.commands.runVouched(["node", "-e", nodeHeadersProbeScript], {
    cwd: context.workspace,
    timeoutMs: Math.max(1, Math.min(60_000, context.timeoutMs)),
  });
  const prefix = headers.stdout.trim();
  const nodedir =
    headers.exitCode === 0 && /^\/[\w./+-]*$/.test(prefix) ? [`--nodedir=${prefix}`] : [];
  const headerNote =
    nodedir.length === 0
      ? "; the running node carries no headers, so a native build cannot compile offline"
      : "";
  const outcome = await context.effect({
    argv: ["npm", "rebuild", "--foreground-scripts", ...nodedir, ...deferred.packages],
    network: "none",
    stage: "offline-lifecycle",
    networkProbe: proof,
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${what} ran offline where the checks run (network measured off)`
        : `${what} ran offline where the checks run (network measured off) and failed (exit ${observed.exitCode}): ${outputTail(observed)}`,
  });
  return {
    detail: `${outcome.detail}${headerNote}${refused}`,
    sourceChanged: outcome.sourceChanged,
  };
}
