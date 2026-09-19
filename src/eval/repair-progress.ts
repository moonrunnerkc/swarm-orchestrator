import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";

/**
 * What a repair did to the verifier's findings, read off two observations and nothing else.
 *
 * All nine reach-triggered tasks of the reach-pressure run ended as `reach-repair-exhausted`, and
 * that one word covered three different things: six patches that never changed, two that gained a
 * scratch file, and one that edited the agent's own examples. None of them is a judgement about
 * code. Each is a relation between two sets the harness already holds, the blocking findings
 * before the repair and after it, and between two patches it has already stored.
 *
 * No score is computed and none could be honest: whether arbitrary source is better is not
 * something this harness can observe. A finding set that shrank is reported as a set that shrank.
 */
export const repairRelations = [
  /** The stored patch is byte-identical, so the repair invocation changed nothing that is judged. */
  "patch-unchanged",
  /** The patch changed and the verifier names exactly the same findings. */
  "findings-identical",
  /** The patch changed and the findings are different ones: neither set contains the other. */
  "findings-moved",
  /** Every finding that remains was there before, and at least one is gone. */
  "findings-shrank",
  /** Every earlier finding remains and at least one is new. */
  "findings-grew",
  /** No blocking finding remains: the condition the repair was asked for holds. */
  "satisfied",
] as const;
export type RepairRelation = (typeof repairRelations)[number];

/**
 * One blocking finding, with an identity that survives the patch moving it.
 *
 * A reach finding is a line of the patch, and a repair that adds a line above it renumbers it
 * without touching it. Where the harness holds the patch text the identity is the file and a
 * digest of the line's trimmed text; where it does not, it is the file and the line number, and
 * the record says which, because a renumbered line then reads as one finding gone and one new.
 */
export interface Finding {
  readonly id: string;
  readonly kind: "refusal" | "unreached-line" | "no-change";
  readonly path?: string;
  readonly line?: number;
}

export const patchFileSchema = z.object({
  path: z.string().min(1),
  change: z.enum(["added", "modified", "deleted"]),
  /** SHA-256 of this file's section of the patch, so two patches compare file by file. */
  diffDigest: z.string().regex(digestPattern),
});
export type PatchFile = z.infer<typeof patchFileSchema>;

export const repairProgressSchema = z.object({
  relation: z.enum(repairRelations),
  /** Index into the trajectory's steps of the observation this one is compared with. */
  comparedWithStep: z.number().int().nonnegative(),
  patch: z.object({
    before: z.string().regex(digestPattern),
    after: z.string().regex(digestPattern),
    changed: z.boolean(),
  }),
  findingIdentity: z.enum(["line-text", "line-number"]),
  findings: z.object({
    before: z.array(z.string()),
    after: z.array(z.string()),
    resolved: z.array(z.string()),
    introduced: z.array(z.string()),
  }),
  /**
   * Paths whose section of the patch differs between the two, or null where either snapshot
   * carries no file list. `enteredThePatch` are files the repair brought into the change: a
   * scratch script left behind appears here by name, and so does a legitimate new module. Which
   * of the two it is, is for a reader with both patches. It is on the record either way.
   */
  paths: z
    .object({
      changed: z.array(z.string()),
      enteredThePatch: z.array(z.string()),
      leftThePatch: z.array(z.string()),
    })
    .nullable(),
});
export type RepairProgress = z.infer<typeof repairProgressSchema>;

export interface RepairObservation {
  readonly patchDigest: string;
  readonly findings: readonly Finding[];
  readonly files?: readonly PatchFile[] | undefined;
}

export function repairProgress(input: {
  readonly comparedWithStep: number;
  readonly findingIdentity: "line-text" | "line-number";
  readonly before: RepairObservation;
  readonly after: RepairObservation;
}): RepairProgress {
  const before = [...new Set(input.before.findings.map((one) => one.id))].sort();
  const after = [...new Set(input.after.findings.map((one) => one.id))].sort();
  const held = new Set(before);
  const holds = new Set(after);
  const resolved = before.filter((id) => !holds.has(id));
  const introduced = after.filter((id) => !held.has(id));
  const changed = input.before.patchDigest !== input.after.patchDigest;

  let relation: RepairRelation;
  if (after.length === 0) relation = "satisfied";
  else if (!changed) relation = "patch-unchanged";
  else if (resolved.length === 0 && introduced.length === 0) relation = "findings-identical";
  else if (introduced.length === 0) relation = "findings-shrank";
  else if (resolved.length === 0) relation = "findings-grew";
  else relation = "findings-moved";

  return repairProgressSchema.parse({
    relation,
    comparedWithStep: input.comparedWithStep,
    patch: { before: input.before.patchDigest, after: input.after.patchDigest, changed },
    findingIdentity: input.findingIdentity,
    findings: { before, after, resolved, introduced },
    paths: pathsBetween(input.before.files, input.after.files),
  });
}

function pathsBetween(
  before: readonly PatchFile[] | undefined,
  after: readonly PatchFile[] | undefined,
): RepairProgress["paths"] {
  if (before === undefined || after === undefined) return null;
  const was = new Map(before.map((file) => [file.path, file.diffDigest]));
  const is = new Map(after.map((file) => [file.path, file.diffDigest]));
  const enteredThePatch = [...is.keys()].filter((path) => !was.has(path)).sort();
  const leftThePatch = [...was.keys()].filter((path) => !is.has(path)).sort();
  const rewritten = [...is.keys()].filter(
    (path) => was.has(path) && was.get(path) !== is.get(path),
  );
  return {
    changed: [...enteredThePatch, ...leftThePatch, ...rewritten].sort(),
    enteredThePatch,
    leftThePatch,
  };
}
