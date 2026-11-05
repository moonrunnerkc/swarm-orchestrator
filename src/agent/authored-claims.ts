import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Requirement, structureEvidence } from "swarm-verify";
import { z } from "zod";
import { gitText } from "./git.ts";

type StructureClaim = Requirement["evidence"]["structure"][number];

const claimSchema = z.strictObject({
  path: z.string().min(1),
  symbol: z
    .string()
    .regex(/^[A-Za-z_$][\w$]*$/)
    .optional(),
  provides: z.boolean().optional(),
  contains: z.string().min(1).optional(),
  absent: z.boolean().optional(),
});

/** Claims that do not hold at the base tell the refactor apart; one that holds already does not. */
export async function claimsAtBase(
  workspace: string,
  raw: readonly unknown[],
): Promise<{ readonly kept: StructureClaim[]; readonly reasons: string[] }> {
  const kept: StructureClaim[] = [];
  const reasons: string[] = [];
  const misplaced: string[] = [];
  const tracked = (await gitText(workspace, ["ls-files"])).split("\n");
  for (const entry of raw) {
    const parsed = claimSchema.safeParse(entry);
    if (!parsed.success) {
      reasons.push(
        `a claim is not {"path", "symbol", "absent"?, "provides"?}: ${JSON.stringify(entry)}`,
      );
      continue;
    }
    const claim = { ...parsed.data, authority: "independently-generated" as const };
    const placed = await placement(workspace, claim, tracked);
    if (placed !== null) {
      misplaced.push(placed);
      continue;
    }
    const unmoved = await notInSource(workspace, claim, tracked);
    if (unmoved !== null) {
      reasons.push(unmoved);
      continue;
    }
    const read = await structureEvidence(workspace, claim);
    if (read.outcome === "observed") reasons.push(`${read.ref} already holds at the base`);
    else kept.push(claim);
  }
  if (misplaced.length > 0) return { kept, reasons: [...new Set(misplaced)] };
  if (kept.length === 0) reasons.unshift("no claim fails at the base");
  return { kept, reasons: kept.length === 0 ? reasons : [] };
}

const exists = (workspace: string, rel: string) =>
  access(join(workspace, rel)).then(
    () => true,
    () => false,
  );

/**
 * Why a claim's path cannot be where a correct change puts the file. It is under a top-level
 * directory the repository does not have, named for a package it keeps under src/
 * (tracemantle, replayed 2026-11-05: the wording says tracemantle/history/); or it is the tail of
 * a path the repository has, written without the directories above it (tracemantle, the rc.7 run:
 * "core/history_io.py" for src/tracemantle/core/history_io.py), or an old path said to provide a
 * name that the repository keeps elsewhere ("core/history_store.py" for src/tracemantle/history_store.py).
 */
async function placement(
  workspace: string,
  claim: z.infer<typeof claimSchema>,
  tracked: readonly string[],
): Promise<string | null> {
  const path = claim.path;
  if (await exists(workspace, path)) return null;
  const top = path.split("/")[0] ?? path;
  if (!path.includes("/") || (await exists(workspace, top))) return null;
  if (await exists(workspace, join("src", top)))
    return `${path} is under ${top}/, which the repository does not have; its ${top} package is at src/${top}/`;
  const whole = tracked.filter((one) => one.endsWith(`/${path}`));
  // An old path that still provides a name is one the base has.
  const named =
    claim.provides === true ? tracked.filter((one) => basename(one) === basename(path)) : [];
  const has = whole.length > 0 ? whole : named;
  if (has.length === 0) return null;
  return `${path} is not a path from the repository's root; the repository has ${has.slice(0, 3).join(" and ")}`;
}

/**
 * Why a claim that a new module defines a name cannot hold after a move: the file it moves from,
 * the tracked file of that name nearest it, does not define the name itself (it imports it). tracemantle
 * (the rc.7 run): history_store.py imports Ledger from core/history, so no move of that file
 * makes the new module define Ledger.
 */
async function notInSource(
  workspace: string,
  claim: z.infer<typeof claimSchema>,
  tracked: readonly string[],
): Promise<string | null> {
  if (claim.symbol === undefined || claim.absent === true || claim.provides === true) return null;
  if (await exists(workspace, claim.path)) return null;
  const source = nearest(
    claim.path,
    tracked.filter((one) => basename(one) === basename(claim.path)),
  );
  if (source === null) return null;
  const read = await structureEvidence(workspace, { path: source, symbol: claim.symbol });
  if (read.outcome === "observed") return null;
  return `${claim.path} cannot come to define ${claim.symbol} by a move: ${source}, the file of that name, does not define it at the base (a name it imports stays defined where it is)`;
}

/** The candidate sharing the most leading directories with the path; null on none or a tie. */
function nearest(path: string, candidates: readonly string[]): string | null {
  const shared = (one: string) => {
    const a = path.split("/");
    const b = one.split("/");
    let n = 0;
    while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) n += 1;
    return n;
  };
  const ranked = [...candidates].sort((x, y) => shared(y) - shared(x));
  const [first, second] = ranked;
  if (first === undefined) return null;
  return second !== undefined && shared(second) === shared(first) ? null : first;
}
