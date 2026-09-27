import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { TaskPreset } from "../evidence/task-preset.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import { pathsInPatch } from "./patch-paths.ts";
import { validateUpgradeManifest } from "./upgrade-contract.ts";

/** Authorize narrow dependency changes before preparation executes candidate code. */
export async function enforceUpgrade(options: {
  preset: TaskPreset;
  patch: string;
  checkout: string;
  base: string;
  commands: GateCommandRunner;
  timeoutMs: number;
  evidence?: EvidenceRecorder;
}): Promise<string | undefined> {
  const { preset } = options;
  if (preset.kind !== "upgrade") return;
  const allowed = new Set([preset.manifest, preset.lockfile, ...preset.sourcePaths]);
  const outside = pathsInPatch(options.patch).filter((path) => !allowed.has(path));
  if (outside.length)
    throw new Error(`upgrade change outside declared scope: ${outside.join(", ")}`);
  const original = await options.commands.runVouched(
    ["git", "show", `${options.base}:${preset.manifest}`],
    { cwd: options.checkout, timeoutMs: options.timeoutMs },
  );
  if (original.exitCode !== 0 || original.outputTruncated)
    throw new Error("cannot read pinned base manifest for upgrade");
  const candidate = await readFile(join(options.checkout, preset.manifest), "utf8");
  const problem = validateUpgradeManifest(original.stdout, candidate, preset);
  if (problem) throw new Error(problem);
  if (original.stdout.length + candidate.length > 1_000_000)
    throw new Error("upgrade manifests exceed the evidence size bound");
  const recorded = await options.evidence?.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["file"],
    payload: asJsonValue({
      rule: "upgrade-authorization-v1",
      presetDigest: digestOfJson(asJsonValue(preset)),
      base: original.stdout,
      candidate,
      manifest: preset.manifest,
      lockfile: preset.lockfile,
      touched: pathsInPatch(options.patch),
      manifestDigest: digestOfBytes(candidate),
      lockDigest: digestOfBytes(await readFile(join(options.checkout, preset.lockfile))),
    }),
  });
  return recorded?.record.payloadDigest;
}

/** A bug reproduces only through a completed executable with wrong checked output, never a startup failure. */
export function reproducedBug(
  contract: GoalContract,
  evidence: EvidenceRecorder,
  tree: string,
): boolean {
  const preset = contract.preset;
  if (preset?.kind !== "bugfix") return false;
  const check = contract.checks.find((entry) => entry.id === preset.reproducer);
  if (
    check?.behavior?.kind !== "cli" ||
    check.behavior.stdout.length + check.behavior.stderr.length === 0
  )
    return false;
  const expectedExit = check.behavior.exitCode;
  return evidence
    .records()
    .filter((record) => record.type === "goal-check")
    .some((record) => {
      const payload = evidence.payloads().get(record.payloadDigest) as
        | {
            tree?: string;
            checkId?: string;
            status?: string;
            observation?: {
              exitCode?: number;
              unavailable?: string | null;
              outputTruncated?: boolean;
            };
          }
        | undefined;
      return (
        payload?.tree === tree &&
        payload.checkId === check.id &&
        payload.status === "rejected" &&
        payload.observation?.exitCode === expectedExit &&
        payload.observation?.unavailable === null &&
        !payload.observation?.outputTruncated
      );
    });
}
