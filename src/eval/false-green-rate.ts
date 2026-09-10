import { wilsonInterval } from "./statistics.ts";

/**
 * The false-green rate over one corpus, and everything a reader needs to know what it is a rate
 * of.
 *
 * The denominator is the patches the tool certified, because only a claim can be false: a run the
 * tool refused made no claim to be wrong about. That makes the denominator move when the tool
 * changes, which is why the refusals are reported beside it. A check that refuses more makes the
 * tool safer and the measurement weaker at the same time, and a number that hides one of those
 * halves is telling half the story.
 */
export interface CorpusJudgement {
  readonly corner: string;
  /**
   * What bonding the tool's own oracle showed, where the row records it. `not-recorded` stands
   * for a row written before bonding existed, and is kept separate from `not-bonded`: one is a
   * patch no mutant could be built from, the other is a question nobody asked.
   */
  readonly oracleBond?: string;
}

export interface FalseGreenTally {
  /** Patches the tool certified, which is what a false green can be a defect in. */
  readonly opportunities: number;
  readonly falseGreens: number;
  /** Null where nothing was certified: zero of nothing is not zero. */
  readonly point: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
  /** Refused because the tool's own oracle never ran part of the change. */
  readonly refusedOnReach: number;
  /** Refused because the sealed half rejected work the held-back half accepts. */
  readonly refusedOnSealed: number;
  /** Refused because the oracle accepted a change to a line it demonstrably ran. */
  readonly refusedOnBond: number;
  /**
   * The certified patches split by what bonding their oracle showed, and the false greens among
   * them likewise. `verified` is not one word: a patch certified on an oracle that refused every
   * mutant of the change is a stronger claim than one certified on an oracle nothing was asked
   * of, and a rate that flattens the two describes neither.
   */
  readonly certifiedByBond: Readonly<Record<string, number>>;
  readonly falseGreensByBond: Readonly<Record<string, number>>;
  /** Refused with both oracles accepting and no refusal the tool can point at. */
  readonly falseReds: number;
  /** An oracle on one side or the other could judge nothing, so the task is evidence of nothing. */
  readonly unjudgeable: number;
}

/** How many rows carry each bond state, with an unrecorded one named rather than assumed. */
function byBondState(rows: readonly CorpusJudgement[]): Readonly<Record<string, number>> {
  const counted: Record<string, number> = {};
  for (const row of rows) {
    const state = row.oracleBond ?? "not-recorded";
    counted[state] = (counted[state] ?? 0) + 1;
  }
  return counted;
}

export function tallyFalseGreens(rows: readonly CorpusJudgement[]): FalseGreenTally {
  const count = (corner: string) => rows.filter((row) => row.corner === corner).length;
  const certified = rows.filter(
    (row) => row.corner === "true-green" || row.corner === "false-green",
  );
  const falseGreens = count("false-green");
  const opportunities = count("true-green") + falseGreens;
  const rate = opportunities === 0 ? null : wilsonInterval(falseGreens, opportunities);

  return {
    opportunities,
    falseGreens,
    point: rate?.point ?? null,
    lower: rate?.lower ?? null,
    upper: rate?.upper ?? null,
    refusedOnReach: count("refused-on-reach"),
    refusedOnSealed: count("refused-on-sealed"),
    refusedOnBond: count("refused-on-bond"),
    certifiedByBond: byBondState(certified),
    falseGreensByBond: byBondState(certified.filter((row) => row.corner === "false-green")),
    falseReds: count("false-red"),
    unjudgeable: count("unjudgeable"),
  };
}

/** What one half said about a patch, as the passes record it. */
/**
 * The rows produced by showing the model its oracle, kept apart from the rest.
 *
 * A different sampling process, not a harder subset of one. The adversarial arm asks a model to
 * satisfy the acceptance test it was shown and leave an adjacent case broken, which is an upper
 * bound on the tool's blindness against a reader of that test; the ordinary arm is what a
 * contributor who cannot see it produces. A rate over the two together describes a population
 * nobody sampled.
 *
 * The two arms write to different files, which is a convention. This is the check, so a row that
 * ends up in the wrong one is still not pooled. A row with no prompt recorded was not shown its
 * oracle, because the field is written only where it was.
 */
export function separateAdversarialRows<Row extends { readonly prompt?: string }>(
  rows: readonly Row[],
): { readonly ordinary: readonly Row[]; readonly adversarial: readonly Row[] } {
  return {
    ordinary: rows.filter((row) => row.prompt !== "sealed-oracle-shown"),
    adversarial: rows.filter((row) => row.prompt === "sealed-oracle-shown"),
  };
}

export interface HalfVerdicts {
  readonly sealedOracle?: string;
  readonly heldBackOracle?: string;
}

export interface InadequateOracleTally {
  /**
   * Oracles a held-back oracle proved inadequate: the sealed one accepted a patch the held-back
   * one refuses, with the repository's own suite passing. That is a demonstration, not an
   * opinion, and it is the only denominator here the tool does not choose.
   */
  readonly proved: number;
  /** How many of those the tool declined to certify on, whatever the reason it gave. */
  readonly refused: number;
  readonly point: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
}

/**
 * Gate 3b: of the oracles shown to be inadequate, how many the tool refuses to certify on.
 *
 * This is the capability question, and it is the one gate 3 was always trying to ask. It does not
 * move when a model gets better or worse, because the denominator is oracles rather than tasks,
 * and it does not reward a tool for refusing more, because a tool that refuses everything scores
 * one here and zero on everything else.
 *
 * The denominator is small and it is the honest size: three across both corpora. An interval over
 * three is wide, and reporting the fraction without it would be the overconfidence this whole
 * measurement exists to correct.
 */
export function tallyInadequateOracles(
  rows: readonly (HalfVerdicts & {
    readonly firstOracle?: string;
    readonly regression?: string;
    readonly verified?: boolean;
  })[],
): InadequateOracleTally {
  const proved = rows.filter(
    (row) =>
      (row.sealedOracle ?? row.firstOracle) === "accepted" &&
      row.heldBackOracle === "rejected" &&
      row.regression === "pass",
  );
  const refused = proved.filter((row) => row.verified !== true);
  const rate = proved.length === 0 ? null : wilsonInterval(refused.length, proved.length);
  return {
    proved: proved.length,
    refused: refused.length,
    point: rate?.point ?? null,
    lower: rate?.lower ?? null,
    upper: rate?.upper ?? null,
  };
}

export interface HeldBackAgreement {
  /** Patches both halves actually judged, which is the only place they can agree or disagree. */
  readonly compared: number;
  readonly agreed: number;
  /** Null where neither half judged anything: there is no agreement to have. */
  readonly rate: number | null;
}

/**
 * How often the two halves of one specification reach the same verdict on the same patch.
 *
 * This is the mined corpus's weakness made into a number. Both halves come from one author in one
 * sitting, often in one `describe` block, and they can share a blind spot in a way two separately
 * authored oracles cannot. A split whose halves never disagree on any patch is buying less than it
 * appears to, and the only way to know is to count.
 *
 * Only verdicts about the patch count. A half that accepts the base judges nothing, and one the
 * harness could not run judged nothing either, so neither agrees with anything.
 */
export function heldBackAgreementRate(rows: readonly HalfVerdicts[]): HeldBackAgreement {
  const judged = rows.filter(
    (row) =>
      (row.sealedOracle === "accepted" || row.sealedOracle === "rejected") &&
      (row.heldBackOracle === "accepted" || row.heldBackOracle === "rejected"),
  );
  const agreed = judged.filter((row) => row.sealedOracle === row.heldBackOracle).length;
  return {
    compared: judged.length,
    agreed,
    rate: judged.length === 0 ? null : agreed / judged.length,
  };
}

export interface HarnessGroup {
  /** The commit that judged these rows, or `unrecorded` for rows written before that rule. */
  readonly harness: string;
  readonly tally: FalseGreenTally;
  readonly rows: readonly CorpusJudgement[];
}

/**
 * The rows, split by the tool version that judged them.
 *
 * A corpus can span two commits without spanning two tools: a re-judge under one, a handful of
 * later tasks scored under another, with nothing between them that a verdict depends on. Picking
 * the newest group and dropping the rest reported "no rate" over eight rows that happened to be
 * newest while three certified patches sat in the other group.
 *
 * So every group is reported. The case worth shouting about is more than one of them holding a
 * certified patch, because that is a rate assembled across tool versions rather than a corpus
 * merely recorded across them: a group with nothing certified contributes no opportunity and can
 * change no rate.
 */
export function groupByHarness(
  rows: readonly (CorpusJudgement & { readonly harness?: string })[],
): readonly HarnessGroup[] {
  const perCommit = new Map<string, (CorpusJudgement & { readonly harness?: string })[]>();
  for (const row of rows) {
    const commit = row.harness ?? "unrecorded";
    perCommit.set(commit, [...(perCommit.get(commit) ?? []), row]);
  }
  return [...perCommit.entries()].map(([harness, kept]) => ({
    harness,
    tally: tallyFalseGreens(kept),
    rows: kept,
  }));
}
