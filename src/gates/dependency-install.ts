import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";

export interface DependencyInstall {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly command: string;
  readonly detail: string;
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
] as const;

/** Setup is an authorized harness effect, under the same runner, cancellation and resource pool. */
export async function installFromLockfile(options: {
  workspace: string;
  commands: GateCommandRunner;
  timeoutMs: number;
  evidence?: EvidenceRecorder;
  signal?: AbortSignal;
}): Promise<DependencyInstall> {
  const { workspace, evidence } = options;
  options.signal?.throwIfAborted();
  if (evidence !== undefined) assertDependencyEffectsSettled(evidence);
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
    const identity = {
      version: 1 as const,
      id: `install-${evidence?.records().length ?? 0}`,
      workspace,
      argv: [...candidate.argv],
      lockDigest: digestOfBytes(await readFile(join(workspace, candidate.file))),
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
      observed = await options.commands.runVouched(candidate.argv, {
        cwd: workspace,
        timeoutMs: Math.max(1, options.timeoutMs),
      });
      after = await sourceFingerprint(workspace, options.signal);
    } catch (cause) {
      throw new DependencySetupReconciliationError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    const succeeded = observed.exitCode === 0 && observed.unavailable === null && before === after;
    const detail =
      before !== after
        ? "dependency setup changed source files; preserve the checkout and inspect the changes"
        : succeeded
          ? `installed from ${candidate.file} with lifecycle scripts disabled`
          : `dependency setup failed (exit ${observed.exitCode}): ${observed.unavailable ?? (observed.stderr || observed.stdout).trim().slice(-2000)}`;
    await record("completed", {
      succeeded,
      detail,
      sourceAfter: after,
      exitCode: observed.exitCode,
      unavailable: observed.unavailable,
    });
    return { attempted: true, succeeded, command: candidate.argv.join(" "), detail };
  }
  return {
    attempted: true,
    succeeded: false,
    command: "",
    detail:
      "no supported lockfile: provide package-lock.json, pnpm-lock.yaml or yarn.lock, or omit --install and supply a prepared runtime",
  };
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
