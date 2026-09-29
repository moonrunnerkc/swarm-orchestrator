import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { type CheckNetworkProbe, probeCheckNetwork } from "./check-network-probe.ts";
import {
  editableBuildScript,
  isPlainRequirement,
  nodeHeadersProbeScript,
  npmDeferredScripts,
  type UvEditableProject,
  uvEditableProject,
  uvEnvironmentPython,
  wheelFileName,
} from "./deferred-setup.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";

/** One setup command, planned: what runs, with which network, and how its outcome reads. */
export interface SetupEffect {
  readonly argv: readonly string[];
  readonly network: "registry" | "none";
  readonly stage?: "package-manager" | "build-requirements" | "offline-lifecycle";
  readonly networkProbe?: { readonly contained: true; readonly observed: string };
  readonly toolDirectory?: string;
  readonly describe: (outcome: {
    readonly observed: GateObservation;
    readonly succeeded: boolean;
  }) => string;
}

export interface SetupEffectOutcome {
  readonly observed: GateObservation;
  readonly succeeded: boolean;
  readonly sourceChanged: boolean;
  readonly detail: string;
}

export type NetworkProbe = (commands: GateCommandRunner, cwd: string) => Promise<CheckNetworkProbe>;

export interface DeferredSetupResult {
  readonly details: readonly string[];
  readonly toolDirectories: readonly string[];
  /** A follow-up step changed source files, which fails the whole setup. */
  readonly sourceChanged: boolean;
}

interface FollowUpContext {
  readonly lockfile: string;
  readonly installArgv: readonly string[];
  readonly workspace: string;
  readonly commands: GateCommandRunner;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly probeNetwork?: NetworkProbe;
  /** Runs one planned command as a recorded effect, intent before and completion after. */
  readonly effect: (planned: SetupEffect) => Promise<SetupEffectOutcome>;
}

/** Where a pnpm fetched for the install is kept, relative to the unit it installed. */
const pnpmToolPrefix = "node_modules/.swarm-pnpm";
/** Where the Python build frontend keeps its requirements and wheel, inside uv's own ignored .venv. */
const pythonBuildRoot = ".venv/.swarm-build";

function outputTail(observed: GateObservation): string {
  return (observed.unavailable ?? `${observed.stderr}\n${observed.stdout}`.trim()).slice(-2000);
}

/**
 * The work a scripts-off install leaves undone, in two kinds. A fetch that executes nothing (the
 * pnpm the install used, a build backend's wheels) keeps the install's registry access. Anything
 * that executes registry-served code (a dependency's install script, a build backend) runs only
 * where a check-time command was just measured unable to connect, through the same runner and
 * environment as the checks; where that cannot be shown it does not run, and the detail says so.
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

/** Measured once, only where there is deferred work to run. */
async function offlineProbe(
  context: FollowUpContext,
): Promise<{ proof: OfflineProof | null; probe: CheckNetworkProbe }> {
  const probe = await (context.probeNetwork ?? probeCheckNetwork)(
    context.commands,
    context.workspace,
  );
  return {
    proof: probe.contained === true ? { contained: true, observed: probe.observed } : null,
    probe,
  };
}

type OfflineProof = { readonly contained: true; readonly observed: string };

function notRunOffline(what: string, probe: CheckNetworkProbe): string {
  return `${what} did not run: ${probe.contained === false ? "a check-time command here reaches the network" : `whether the checks' network is off could not be shown (${probe.observed})`}, and registry-served code is never run with network access; the checks measure the tree without it`;
}

async function npmDeferredWork(
  context: FollowUpContext,
): Promise<{ detail: string; sourceChanged: boolean } | null> {
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

/**
 * The project itself, which `uv sync --no-install-project` left out, installed editable the way
 * uv would, with nothing registry-served executed while the network is reachable: the build
 * backend's wheels are fetched without being run (`--only-binary :all:`, into a target directory
 * by the system interpreter, never by the environment that holds the project's packages), the
 * backend runs offline to name its editable requirements and to build, and uv installs the
 * wheel offline. Tests then import the package and find its console scripts.
 */
async function uvDeferredWork(
  context: FollowUpContext,
): Promise<{ detail: string; sourceChanged: boolean } | null> {
  const project = await uvEditableProject(context.workspace);
  if (project === null) return null;
  const what = "the project's own editable install";
  if (project.kind === "refused")
    return { detail: `${what} did not run: ${project.reason}`, sourceChanged: false };
  const python = await uvEnvironmentPython(context.workspace);
  if (python === null)
    return {
      detail: `${what} did not run: .venv/pyvenv.cfg names no interpreter version`,
      sourceChanged: false,
    };
  const { proof, probe } = await offlineProbe(context);
  if (proof === null) return { detail: notRunOffline(what, probe), sourceChanged: false };
  const buildRoot = join(context.workspace, pythonBuildRoot);
  await rm(buildRoot, { recursive: true, force: true });
  try {
    return await buildEditableOffline(context, project, python, proof);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

async function buildEditableOffline(
  context: FollowUpContext,
  project: Extract<UvEditableProject, { kind: "editable" }>,
  python: string,
  probe: OfflineProof,
): Promise<{ detail: string; sourceChanged: boolean }> {
  const what = "the project's own editable install";
  const backendDirectory = `${pythonBuildRoot}/backend`;
  const wheelDirectory = `${pythonBuildRoot}/wheel`;
  const failed = (outcome: SetupEffectOutcome) => ({
    detail: outcome.sourceChanged ? outcome.detail : `${what} did not complete: ${outcome.detail}`,
    sourceChanged: outcome.sourceChanged,
  });
  const fetch = (requirements: readonly string[]) =>
    context.effect({
      argv: [
        "uv",
        "pip",
        "install",
        "--system",
        "--target",
        backendDirectory,
        "--only-binary",
        ":all:",
        "--python-version",
        python,
        "--",
        ...requirements,
      ],
      network: "registry",
      stage: "build-requirements",
      describe: ({ observed, succeeded }) =>
        succeeded
          ? `build requirements ${requirements.join(", ")} fetched as wheels, nothing executed`
          : `build requirements ${requirements.join(", ")} could not be fetched as wheels (exit ${observed.exitCode}): ${outputTail(observed)}`,
    });
  const hook = (mode: "requires" | "build") =>
    context.effect({
      argv: [
        ".venv/bin/python",
        "-I",
        "-S",
        "-c",
        editableBuildScript,
        mode,
        backendDirectory,
        wheelDirectory,
        project.backend,
        ...project.backendPath,
      ],
      network: "none",
      stage: "offline-lifecycle",
      networkProbe: probe,
      describe: ({ observed, succeeded }) =>
        succeeded
          ? `${project.backend} ${mode === "requires" ? "named its editable requirements" : "built the editable wheel"} offline where the checks run (network measured off)`
          : `${project.backend} failed offline (${mode === "requires" ? "naming its editable requirements" : "building the editable wheel"}, exit ${observed.exitCode}): ${outputTail(observed)}`,
    });
  const declared = await fetch(project.requires);
  if (!declared.succeeded) return failed(declared);
  const named = await hook("requires");
  if (!named.succeeded) return failed(named);
  let extra: unknown;
  try {
    extra = JSON.parse(named.observed.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    extra = null;
  }
  if (
    !Array.isArray(extra) ||
    !extra.every((entry) => typeof entry === "string" && isPlainRequirement(entry))
  )
    return {
      detail: `${what} did not complete: the backend named editable requirements that are not plain registry requirements`,
      sourceChanged: false,
    };
  if (extra.length > 0) {
    const fetched = await fetch(extra as string[]);
    if (!fetched.succeeded) return failed(fetched);
  }
  const built = await hook("build");
  if (!built.succeeded) return failed(built);
  const wheel = built.observed.stdout.trim().split("\n").at(-1) ?? "";
  if (!wheelFileName.test(wheel))
    return {
      detail: `${what} did not complete: the backend named no wheel file`,
      sourceChanged: false,
    };
  const installed = await context.effect({
    argv: [
      "uv",
      "pip",
      "install",
      "--offline",
      "--no-deps",
      "--python",
      ".venv/bin/python",
      `${wheelDirectory}/${wheel}`,
    ],
    network: "none",
    stage: "offline-lifecycle",
    networkProbe: probe,
    describe: ({ observed, succeeded }) =>
      succeeded
        ? `${what} built by ${project.backend} and installed offline where the checks run (network measured off)`
        : `${what} could not be installed offline (exit ${observed.exitCode}): ${outputTail(observed)}`,
  });
  return installed.succeeded
    ? { detail: installed.detail, sourceChanged: false }
    : failed(installed);
}
