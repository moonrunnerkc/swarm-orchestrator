/** The admission rule over recorded probe runs, independently implemented. */
export function readAdmission(
  runs: readonly { purpose: string; reference: string | null; status: string }[],
  references: readonly string[],
): { admitted: boolean; reasons: string[] };

/** Why a revision is not its parent with only the admitted checks appended; null where it is. */
export function readRevision(
  parent: unknown,
  revised: unknown,
  admitted: readonly unknown[],
): string | null;

/** Every check admission and contract revision on the chain, re-derived. */
export function strengtheningAgrees(
  records: readonly { sequence: number; type: string; payloadDigest: string }[],
  payloads: ReadonlyMap<string, unknown>,
): readonly { sequence: number; agrees: boolean; problems: string[] }[];
