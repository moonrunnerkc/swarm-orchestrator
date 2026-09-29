import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
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
  stage: z.enum(["package-manager", "build-requirements", "offline-lifecycle"]).optional(),
  /** For offline work: the measurement that showed a check-time command could not connect. */
  networkProbe: z.strictObject({ contained: z.literal(true), observed: z.string() }).optional(),
  /** For a fetched package manager: the directory put on the checks' PATH once it succeeds. */
  toolDirectory: z.string().optional(),
  lockDigest: z.string(),
  sourceDigest: z.string(),
  succeeded: z.boolean().optional(),
  sourceAfter: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  unavailable: z.string().nullable().optional(),
  detail: z.string().optional(),
});
const lockfiles = [
  { file: "package-lock.json", argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
  { file: "pnpm-lock.yaml", argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"] },
  { file: "yarn.lock", argv: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"] },
  // Every dependency group and every extra. Groups are development-only by definition
  // (PEP 735), and a project that keeps pytest in a `test` group had no runner after a default
  // sync. The older layout keeps the same tools in a `dev` extra, and the study found most of its
  // Python rows reading "no test ran" for that reason alone. Installing every extra is also what
  // a suite that tests optional features needs. A lockfile that declares conflicting extras makes
  // uv refuse, which is reported as a failed install, not worked around.
  {
    file: "uv.lock",
    argv: ["uv", "sync", "--locked", "--all-groups", "--all-extras", "--no-install-project"],
  },
] as const;

/** Setup is an authorized harness effect, under the same runner, cancellation and resource pool. */
export async function installFromLockfile(options: InstallOptions): Promise<DependencyInstall> {
  const { workspace, evidence } = options;
  options.signal?.throwIfAborted();
  if (evidence !== undefined) assertDependencyEffectsSettled(evidence);
  const present = await Promise.all(
    lockfiles.map(async (candidate) => ({
      candidate,
      exists: await lstat(join(workspace, candidate.file)).then(
        () => true,
        () => false,
      ),
    })),
  );
  if (present.filter((entry) => entry.exists).length > 1)
    return {
      attempted: false,
      succeeded: false,
      command: "",
      detail: "multiple lockfiles require explicit package selection; no dependency setup ran",
    };
  for (const candidate of lockfiles) {
    let lock: Awaited<ReturnType<typeof lstat>>;
    try {
      lock = await lstat(join(workspace, candidate.file));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    if (!lock.isFile()) throw new Error(`${candidate.file} must be a regular lockfile, not a link`);
    const before = await sourceFingerprint(workspace, options.signal);
    const argv = await installerArgv(candidate, workspace, options);
    const lockDigest = digestOfBytes(await readFile(join(workspace, candidate.file)));
    const effect = (planned: SetupEffect, sourceDigest?: string) =>
      recordedEffect(options, lockDigest, planned, sourceDigest);
    const install = await effect(
      {
        argv,
        network: "registry",
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
      ...(options.signal === undefined ? {} : { signal: options.signal }),
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
  let observed: GateObservation;
  let after: string;
  try {
    observed = await options.commands.runVouched(planned.argv, {
      cwd: workspace,
      timeoutMs: Math.max(1, options.timeoutMs),
      ...(planned.network === "registry" ? { network: "registry" as const } : {}),
    });
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
    : planned.describe({ observed, succeeded });
  await record("completed", {
    succeeded,
    detail,
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
