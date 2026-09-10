import { wilsonInterval } from "./statistics.ts";

/**
 * How hard a task set is for the model that ran it.
 *
 * Gate 7 asks whether task success is non-inferior to the strongest single-agent baseline. Its
 * blocker was never a comparison anybody had to build: it was that the golden set does not
 * discriminate. This model solves those twenty cases first-try, so every arm accepts everything
 * and a paired test has nothing to work on.
 *
 * This measures whether a set leaves a comparison anything to measure, off rows a pass already
 * recorded. It says nothing about arms, and it is not gate 7: what it establishes is which set
 * that gate should be run over.
 */
export interface TaskSuccessTally {
  /** Tasks whose outcome is known. A task nothing could judge is not one of them. */
  readonly attempted: number;
  readonly solved: number;
  /** Runs where the model wrote no patch at all, which is a failure and stays in the count. */
  readonly producedNoChange: number;
  readonly unjudgeable: number;
  readonly point: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
  /**
   * Whether the model both succeeded and failed inside this set. A set where it does neither
   * cannot support a paired comparison whatever is run over it.
   */
  readonly discriminates: boolean;
}

interface TaskRow {
  readonly sealedOracle?: string;
  readonly heldBackOracle?: string;
  readonly producedNoChange?: boolean;
}

/**
 * Success as an oracle the run did not control sees it, which is both halves accepting.
 *
 * Not what the tool certified. A certification is the tool's claim about its own evidence, and a
 * set's difficulty has to be a property of the tasks and the model rather than of how strict the
 * verifier is that week: a check that refuses more would otherwise make every task look harder.
 */
export function tallyTaskSuccess(rows: readonly TaskRow[]): TaskSuccessTally {
  const wroteNothing = rows.filter((row) => row.producedNoChange === true);
  // A task the harness could not judge says nothing about whether the model solved it, so it
  // leaves the denominator. A run that wrote nothing was judged: the model produced no patch.
  const judged = rows.filter(
    (row) =>
      row.producedNoChange === true ||
      (row.sealedOracle !== "unjudged" && row.heldBackOracle !== "unjudged"),
  );
  const solved = judged.filter(
    (row) => row.sealedOracle === "accepted" && row.heldBackOracle === "accepted",
  );
  const rate = judged.length === 0 ? null : wilsonInterval(solved.length, judged.length);
  return {
    attempted: judged.length,
    solved: solved.length,
    producedNoChange: wroteNothing.length,
    unjudgeable: rows.length - judged.length,
    point: rate?.point ?? null,
    lower: rate?.lower ?? null,
    upper: rate?.upper ?? null,
    discriminates: solved.length > 0 && solved.length < judged.length,
  };
}
