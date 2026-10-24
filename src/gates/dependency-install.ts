import { execFile } from "node:child_process";
import { lstat, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { uvSourceBuilds } from "./deferred-setup.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";
import {
  completeDeferredSetup,
  type NetworkProbe,
  type SetupEffect,
  type SetupEffectOutcome,
} from "./setup-follow-up.ts";

export interface DependencyInstall {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly command: string;
  readonly detail: string;
  /**
   * Directories the install prepared for the checks' PATH, such as the pnpm it fetched for a
   * project whose scripts call pnpm. Absent where it prepared none.
   */
  readonly toolDirectories?: readonly string[];
}

export class DependencySetupReconciliationError extends Error {
  constructor(detail: string) {
    super(
      `dependency setup has an unresolved effect: ${detail}; preserve its checkout and reconcile before retrying`,
    );
    this.name = "DependencySetupReconciliationError";
  }
}

const execution = promisify(execFile);
const observationSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(["intent", "completed"]),
  id: z.string(),
  workspace: z.string(),
  argv: z.array(z.string()),
  /**
   * `registry` for a command that may reach the registry (the lockfile install and a fetch that
   * executes nothing); `none` for deferred work, which runs where the checks run with the
   * network measured off. Records written before deferred work existed carry `registry` alone.
   */
  network: z.enum(["registry", "none"]).optional(),
  /** Absent for the lockfile install itself; otherwise which follow-up step this is. */
  stage: z
    .enum(["package-manager", "build-requirements", "source-archive", "offline-lifecycle"])
    .optional(),
  /** Where the command ran, relative to the unit, where that is not the unit itself. */
  directory: z.string().optional(),
  /** For offline work: the measurement that showed a check-time command could not connect. */
  networkProbe: z.strictObject({ contained: z.literal(true), observed: z.string() }).optional(),
  /** For a fetched package manager: the directory put on the checks' PATH once it succeeds. */
  toolDirectory: z.string().optional(),
  lockDigest: z.string(),
  sourceDigest: z.string(),
  succeeded: z.boolean().optional(),
  /** Files the command rewrote that were put back to their bytes from before it (`keep`). */
  restored: z.array(z.string()).optional(),
  sourceAfter: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  unavailable: z.string().nullable().optional(),
  detail: z.string().optional(),
});
const lockfiles = [
  {
    file: "package-lock.json",
    manager: "npm",
    argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  },
  {
    file: "pnpm-lock.yaml",
    manager: "pnpm",
    argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
  },
  {
    file: "yarn.lock",
    manager: "yarn",
    argv: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"],
  },
  // Every dependency group and every extra. Groups are development-only by definition
  // (PEP 735), and a project that keeps pytest in a `test` group had no runner after a default
  // sync. The older layout keeps the same tools in a `dev` extra, and the study found most of its
  // Python rows reading "no test ran" for that reason alone. Installing every extra is also what
  // a suite that tests optional features needs. A lockfile that declares conflicting extras makes
  // uv refuse, which is reported as a failed install, not worked around.
  {
    file: "uv.lock",
    manager: "uv",
    // `--no-build`: installing never runs a build backend while the registry is reachable. A
    // package that would need one is left out here by name and built in the deferred offline
    // phase, or left out with its reason where that cannot be done safely.
    argv: [
      "uv",
      "sync",
      "--locked",
      "--all-groups",
      "--all-extras",
      "--no-install-project",
      "--no-build",
    ],
  },
] as const;
type Lockfile = (typeof lockfiles)[number];

/**
 * Which lockfile an install reads. One present is the one. Several present name different
 * package managers, and installing from the wrong one measures dependencies the project does
 * not run with, so the caller's choice is taken where it names one, then the manifest's own
 * `packageManager` declaration, and otherwise nothing is guessed.
 */
async function selectLockfile(
  workspace: string,
  present: readonly Lockfile[],
  named: string | undefined,
): Promise<{ ok: true; candidates: readonly Lockfile[] } | { ok: false; detail: string }> {
  const names = present.map((candidate) => candidate.file).join(", ");
  if (named !== undefined) {
    const chosen = present.find((candidate) => candidate.file === named);
    if (chosen === undefined)
      return {
        ok: false,
        detail: `${named} was named for setup but is not here (${present.length === 0 ? "no supported lockfile" : `present: ${names}`}); no dependency setup ran`,
      };
    return { ok: true, candidates: [chosen] };
  }
  if (present.length <= 1) return { ok: true, candidates: present };
  const declared = await declaredPackageManager(workspace);
  const chosen =
    declared === null ? undefined : present.find((candidate) => candidate.manager === declared);
  if (chosen === undefined)
    return {
      ok: false,
      detail: `multiple lockfiles (${names}): name the one to install from with --lockfile, or declare packageManager in package.json; no dependency setup ran`,
    };
  return { ok: true, candidates: [chosen] };
}

/** The package manager the manifest's `packageManager` field names, or null. */
async function declaredPackageManager(workspace: string): Promise<string | null> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const declared = (manifest as { packageManager?: unknown } | null)?.packageManager;
  const match = typeof declared === "string" ? /^(npm|pnpm|yarn)@/.exec(declared) : null;
  return match?.[1] ?? null;
}

/** Setup is an authorized harness effect, under the same runner, cancellation and resource pool. */
export async function installFromLockfile(options: InstallOptions): Promise<DependencyInstall> {
  const { workspace, evidence } = options;
  options.signal?.throwIfAborted();
  if (evidence !== undefined) assertDependencyEffectsSettled(evidence);
  const present: Lockfile[] = [];
  for (const candidate of lockfiles) {
    let lock: Awaited<ReturnType<typeof lstat>>;
    try {
      lock = await lstat(join(workspace, candidate.file));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    if (!lock.isFile()) throw new Error(`${candidate.file} must be a regular lockfile, not a link`);
    present.push(candidate);
  }
  const selected = await selectLockfile(workspace, present, options.lockfile);
  if (!selected.ok)
    return { attempted: false, succeeded: false, command: "", detail: selected.detail };
  for (const candidate of selected.candidates) {
    const before = await sourceFingerprint(workspace, options.signal);
    const argv = await installerArgv(candidate, workspace, options);
    const lockDigest = digestOfBytes(await readFile(join(workspace, candidate.file)));
    const effect = (planned: SetupEffect, sourceDigest?: string) =>
      recordedEffect(options, lockDigest, planned, sourceDigest);
    const install = await effect(
      {
        argv,
        network: "registry",
        ...(candidate.manager === "npm" ? { keep: ["yarn.lock"] } : {}),
        describe: ({ observed, succeeded }) =>
          succeeded
            ? `installed from ${candidate.file} using the declared locked preparation command`
            : `dependency setup failed (exit ${observed.exitCode}): ${observed.unavailable ?? (observed.stderr || observed.stdout).trim().slice(-2000)}`,
      },
      before,
    );
    if (!install.succeeded)
      return { attempted: true, succeeded: false, command: argv.join(" "), detail: install.detail };
    // What the scripts-off install left undone, done where the checks run and never with the
    // network the install had: a source change there fails setup the same way it does above.
    const followUp = await completeDeferredSetup({
      lockfile: candidate.file,
      installArgv: argv,
      workspace,
      commands: options.commands,
      timeoutMs: options.timeoutMs,
      effect,
      ...(options.probeNetwork === undefined ? {} : { probeNetwork: options.probeNetwork }),
    });
    return {
      attempted: true,
      succeeded: !followUp.sourceChanged,
      command: argv.join(" "),
      detail: [install.detail, ...followUp.details].join("; "),
      ...(followUp.toolDirectories.length === 0
        ? {}
        : { toolDirectories: followUp.toolDirectories }),
    };
  }
  return {
    attempted: true,
    succeeded: false,
    command: "",
    detail:
      "no supported lockfile: provide package-lock.json, pnpm-lock.yaml, yarn.lock or uv.lock, or omit --install and supply a prepared runtime",
  };
}

interface InstallOptions {
  workspace: string;
  commands: GateCommandRunner;
  timeoutMs: number;
  evidence?: EvidenceRecorder;
  signal?: AbortSignal;
  /** The lockfile to install from where the tree holds several; see `selectLockfile`. */
  lockfile?: string;
  /** How the checks' network is measured before deferred work; the real probe by default. */
  probeNetwork?: NetworkProbe;
}

/**
 * One setup command as a recorded effect: intent before it runs, completion after, with the
 * source fingerprint on both sides. Every command that can execute or fetch registry-served
 * code goes through here, the lockfile install and each deferred step alike, so the ledger
 * names each one with the network it had.
 */
async function recordedEffect(
  options: InstallOptions,
  lockDigest: string,
  planned: SetupEffect,
  sourceDigest?: string,
): Promise<SetupEffectOutcome> {
  const { workspace, evidence } = options;
  options.signal?.throwIfAborted();
  const before = sourceDigest ?? (await sourceFingerprint(workspace, options.signal));
  const identity = {
    version: 1 as const,
    id: `install-${evidence?.records().length ?? 0}`,
    workspace,
    argv: [...planned.argv],
    network: planned.network,
    ...(planned.stage === undefined ? {} : { stage: planned.stage }),
    ...(planned.networkProbe === undefined ? {} : { networkProbe: planned.networkProbe }),
    ...(planned.toolDirectory === undefined ? {} : { toolDirectory: planned.toolDirectory }),
    ...(planned.directory === undefined ? {} : { directory: planned.directory }),
    lockDigest,
    sourceDigest: before,
  };
  const record = async (phase: "intent" | "completed", observed = {}) =>
    evidence?.record({
      type: "dependency-install",
      actor: "harness",
      provenance: ["user", "file", "tool-output"],
      payload: asJsonValue(observationSchema.parse({ ...identity, phase, ...observed })),
    });
  await record("intent");
  // A thrown runner call has ambiguous effects. Keep the intent unanswered for reconciliation.
  const unit = planned.directory === undefined ? workspace : join(workspace, planned.directory);
  const kept = new Map<string, Buffer>();
  for (const path of planned.keep ?? []) {
    const bytes = await readFile(join(unit, path)).catch(() => null);
    if (bytes !== null) kept.set(path, bytes);
  }
  const restored: string[] = [];
  let observed: GateObservation;
  let after: string;
  try {
    observed = await options.commands.runVouched(planned.argv, {
      cwd: unit,
      timeoutMs: Math.max(1, options.timeoutMs),
      ...(planned.network === "registry" ? { network: "registry" as const } : {}),
    });
    for (const [path, bytes] of kept) {
      const now = await readFile(join(unit, path)).catch(() => null);
      if (now?.equals(bytes)) continue;
      await writeFile(join(unit, path), bytes);
      restored.push(path);
    }
    after = await sourceFingerprint(workspace, options.signal);
  } catch (cause) {
    throw new DependencySetupReconciliationError(
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const sourceChanged = before !== after;
  const succeeded = observed.exitCode === 0 && observed.unavailable === null && !sourceChanged;
  const detail = sourceChanged
    ? "dependency setup changed source files; preserve the checkout and inspect the changes"
    : `${planned.describe({ observed, succeeded })}${restored.length === 0 ? "" : `; ${restored.join(", ")} rewritten by the installer was put back as it was`}`;
  await record("completed", {
    succeeded,
    detail,
    ...(restored.length === 0 ? {} : { restored }),
    sourceAfter: after,
    exitCode: observed.exitCode,
    unavailable: observed.unavailable,
  });
  return { observed, succeeded, sourceChanged, detail };
}

/**
 * The installer vector for a lockfile. pnpm is rarely present where the checks run (the default
 * container image carries npm alone), so where the manifest pins `packageManager: pnpm@X` and
 * no pnpm answers, that exact version is fetched from the registry by npm for the install
 * command only, under the same registry access the install already has. The version is the
 * project's own declaration, never a guess at latest; a manifest that declares none keeps the
 * plain command and reports pnpm's absence as the setup failure it is.
 */
async function installerArgv(
  candidate: (typeof lockfiles)[number],
  workspace: string,
  options: { commands: GateCommandRunner; timeoutMs: number },
): Promise<string[]> {
  if (candidate.file === "uv.lock") {
    const plan = await uvSourceBuilds(workspace);
    return [
      ...candidate.argv,
      ...[...plan.builds, ...plan.leftOut].flatMap((entry) => ["--no-install-package", entry.name]),
    ];
  }
  if (candidate.file !== "pnpm-lock.yaml") return [...candidate.argv];
  const probe = await options.commands.runVouched(["pnpm", "--version"], {
    cwd: workspace,
    timeoutMs: Math.max(1, Math.min(60_000, options.timeoutMs)),
  });
  if (probe.unavailable === null && probe.exitCode === 0) return [...candidate.argv];
  let declared: string | undefined;
  try {
    const manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8")) as {
      packageManager?: unknown;
    };
    declared = /^pnpm@([0-9][^\s+]*)/.exec(
      typeof manifest.packageManager === "string" ? manifest.packageManager : "",
    )?.[1];
  } catch {
    declared = undefined;
  }
  // A pnpm lockfile with no pin: the lockfile's own format decides the major that reads it
  // (lockfileVersion 9.0 is written by pnpm 9 and 10, 6.0 by pnpm 8), and that major's latest
  // is fetched, named in the command so the record says which pnpm ran.
  const version = declared ?? (await pnpmMajorForLockfile(workspace));
  return [
    "npx",
    "--yes",
    "--package",
    `pnpm@${version}`,
    "pnpm",
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
  ];
}

/** Every lockfile name an authorized install reads, in the order it is looked for. */
export const lockfileNames: readonly string[] = lockfiles.map((candidate) => candidate.file);

/** The declared locked preparation vector for a lockfile, as data. */
export function lockfileInstallerArgv(file: string): readonly string[] | null {
  return lockfiles.find((candidate) => candidate.file === file)?.argv ?? null;
}

async function pnpmMajorForLockfile(workspace: string): Promise<string> {
  try {
    return pnpmForLockfileText(await readFile(join(workspace, "pnpm-lock.yaml"), "utf8"));
  } catch {
    // No readable lockfile: the plain command reports its absence.
    return "latest";
  }
}

/** The pnpm to fetch for a lockfile that pins none: the major that writes its format. */
export function pnpmForLockfileText(lock: string): string {
  const version = /^lockfileVersion:\s*['"]?([0-9]+)/m.exec(lock)?.[1];
  if (version === "9") return "10";
  if (version === "6") return "8";
  if (version === "5") return "7";
  return "latest";
}

async function sourceFingerprint(workspace: string, signal?: AbortSignal): Promise<string> {
  const listed = await execution(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: workspace,
      env: harnessChildEnvironment().variables,
      ...(signal === undefined ? {} : { signal }),
      timeout: 30000,
      maxBuffer: 64000000,
    },
  );
  const files: { path: string; mode: number | null; digest: string | null }[] = [];
  for (const path of [...new Set(listed.stdout.split("\0").filter(Boolean))].sort()) {
    signal?.throwIfAborted();
    try {
      const full = join(workspace, path);
      const entry = await lstat(full);
      files.push({
        path,
        mode: entry.mode,
        digest: entry.isSymbolicLink()
          ? digestOfBytes(await readlink(full))
          : entry.isFile()
            ? digestOfBytes(await readFile(full))
            : null,
      });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      files.push({ path, mode: null, digest: null });
    }
  }
  return digestOfJson(files);
}

export function assertDependencyEffectsSettled(evidence: EvidenceRecorder): void {
  const pending = new Map<string, ReturnType<typeof observationSchema.parse>>();
  const seen = new Set<string>();
  for (const record of evidence.records()) {
    if (record.type !== "dependency-install") continue;
    if (record.actor !== "harness") throw new Error("dependency setup requires harness authority");
    const observed = observationSchema.parse(evidence.payloads().get(record.payloadDigest));
    if (observed.phase === "intent") {
      if (seen.has(observed.id)) throw new Error("dependency setup intent is duplicated");
      seen.add(observed.id);
      pending.set(observed.id, observed);
    } else {
      const intent = pending.get(observed.id);
      if (
        intent === undefined ||
        ["workspace", "lockDigest", "sourceDigest", "argv"].some(
          (key) =>
            JSON.stringify(Reflect.get(intent, key)) !== JSON.stringify(Reflect.get(observed, key)),
        )
      )
        throw new Error("dependency setup completion has no matching intent");
      if (
        observed.sourceAfter === undefined ||
        observed.exitCode === undefined ||
        observed.unavailable === undefined ||
        observed.succeeded !==
          (observed.exitCode === 0 &&
            observed.unavailable === null &&
            observed.sourceAfter === intent.sourceDigest)
      )
        throw new Error("dependency setup verdict disagrees with its observations");
      pending.delete(observed.id);
    }
  }
  if (pending.size > 0)
    throw new DependencySetupReconciliationError([...pending.keys()].join(", "));
}
