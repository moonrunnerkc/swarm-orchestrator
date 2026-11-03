import { createHash } from "node:crypto";

export interface CycleReading {
  /** Turns in a row that put the tree back in a state it had been in before. */
  readonly returns: number;
  /** Why the loop stops, once the returns reach the limit; null before. */
  readonly stop: string | null;
  /** What the model is told the turn before the limit, joined with any other notice. */
  readonly notice: string | null;
}

/**
 * Counts the turns in a row that change the working tree back to a state it was in earlier in
 * the run. A model flipping one line between two forms changes the tree every turn and never
 * repeats a turn, so the repeated-command rule never sees it: claimcheck (session
 * 20261103T222355-8f8758) split an import into two lines and joined it again for 20 turns. A
 * turn that leaves the tree as it was neither counts nor resets; a state not seen before resets.
 */
export function treeCycles(limit: number): (diff: string, other: string | null) => CycleReading {
  const seen = new Set<string>();
  let last: string | null = null;
  let returns = 0;
  return (diff, other) => {
    const state = createHash("sha256").update(diff).digest("hex");
    if (state !== last) {
      returns = seen.has(state) ? returns + 1 : 0;
      seen.add(state);
      last = state;
    }
    const warning =
      returns === limit - 1
        ? `Your last ${returns} changes each put the working tree back the way it already was earlier in this run. Make a change it has not had yet, or mark the task complete as it stands.`
        : null;
    return {
      returns,
      stop:
        returns >= limit
          ? `the working tree went back to a state it had already been in, ${returns} changes running`
          : null,
      notice: [warning, other].filter((part) => part !== null).join("\n\n") || null,
    };
  };
}
