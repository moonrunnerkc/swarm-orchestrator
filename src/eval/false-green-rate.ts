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
  /** Refused with both oracles accepting and no refusal the tool can point at. */
  readonly falseReds: number;
  /** An oracle on one side or the other could judge nothing, so the task is evidence of nothing. */
  readonly unjudgeable: number;
}

export function tallyFalseGreens(rows: readonly CorpusJudgement[]): FalseGreenTally {
  const count = (corner: string) => rows.filter((row) => row.corner === corner).length;
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
    falseReds: count("false-red"),
    unjudgeable: count("unjudgeable"),
  };
}

/** What one half said about a patch, as the passes record it. */
export interface HalfVerdicts {
  readonly sealedOracle?: string;
  readonly heldBackOracle?: string;
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
