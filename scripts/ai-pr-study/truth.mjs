/**
 * The one definition every study report reads: a row's truth class and status, its independent
 * suite result, each arm's decision, and the denominators. The report, Comparison A and the
 * ablations each used their own filter before (the report scored 13 rows, the comparisons all
 * 22 judged ones) and their own regex for "behavioural"; they now share these functions.
 *
 * Separate dimensions stay separate: suite collection and outcome come from the independent
 * plain-CI arm, the verifier's decision from its report, evidence validity from the bundle's own
 * verifier, and task truth from the adjudication arm. None is derived from another.
 */
import { classifyCheckExecution } from "./check-execution.mjs";

const judgedStatuses = ["requirement-met", "requirement-violated"];

/**
 * A row's truth: `{ class, status, reason, legacy }`. `class` is `behavioural-executed`,
 * `text-inspected` or `unscored`; `status` is `requirement-met`, `requirement-violated` or null.
 * Only `behavioural-executed` with a status is task truth. A row adjudicated before the
 * two-reviewer procedure (one check, one reviewer who saw the head) is classified by what its
 * check executes and marked `legacy`.
 */
export function rowTruth(row) {
  const adjudication = row.adjudication;
  if (adjudication === undefined || adjudication === null)
    return {
      class: "unscored",
      status: null,
      reason: "not adjudicated",
      legacy: false,
      adjudicated: false,
    };
  if (adjudication.truth !== undefined)
    return { ...adjudication.truth, legacy: false, adjudicated: true };
  if (!judgedStatuses.includes(adjudication.status))
    return {
      class: "unscored",
      status: null,
      reason: adjudication.reason ?? "unjudged",
      legacy: true,
      adjudicated: true,
    };
  const executed = classifyCheckExecution(adjudication.check ?? {});
  return {
    class: executed.class,
    status: executed.class === "unscored" ? null : adjudication.status,
    reason: `single-reviewer adjudication before the 2026-09-29 amendment; the check ${executed.reason}`,
    legacy: true,
    adjudicated: true,
  };
}

/** Task truth: behavioural-executed with a status. */
export const hasTaskTruth = (row) => {
  const truth = rowTruth(row);
  return truth.class === "behavioural-executed" && truth.status !== null;
};

/**
 * The independent plain-CI result at the head, or none. A legacy row carries only a green
 * derived from the verifier's own report, which is not this arm and is never read as it.
 */
export function suiteOf(row) {
  const head = row.originalSuite?.head;
  if (head === undefined)
    return {
      status: null,
      source: "none",
      reason:
        "no independent plain-CI run (a legacy row reads the verifier's report, which is not this arm)",
    };
  return {
    status: head.status,
    source: "independent",
    collected: head.collected,
    reason: head.reason ?? null,
  };
}

export const suiteGreen = (row) => suiteOf(row).status === "passed";

/** A0: the repository's own test command, exit only, from the independent arm. */
export function plainCiDecision(row) {
  const suite = suiteOf(row);
  return suite.status === "passed" ? "accept" : suite.status === "failed" ? "refuse" : "unmeasured";
}

/**
 * A1: the verifier's own decision as its report states it. A verified run or a regression pass
 * accepts, a regression the verdict charges to the patch refuses, and anything else (an
 * incomplete run, a refusal before measuring, a blocked row) is unmeasured.
 */
export function verifierDecision(row) {
  if (row.outcome !== "executed") return "unmeasured";
  if (row.verdict?.verified === true || row.verdict?.regression === "pass") return "accept";
  if (row.verdict?.regression === "fail") return "refuse";
  return "unmeasured";
}

/** A1 as the analysis first coded it: any failed check refuses. Kept for the amendment. */
export function verifierDecisionAsFirstCoded(row) {
  if (row.outcome !== "executed") return "unmeasured";
  if (row.verdict?.refusal) return "refuse";
  if (row.verdict?.verified === true || row.verdict?.regression === "pass") return "accept";
  if (Object.values(row.verdict?.checks ?? {}).some((status) => status === "failed"))
    return "refuse";
  return "unmeasured";
}

/** A2: the verifier with the held-back checks as its oracle, where that arm ran. */
export function oracleDecision(row) {
  const oracle = row.comparisonA2;
  if (oracle === undefined || oracle === null) return "not-run";
  if (oracle.outcome !== "executed") return "unmeasured";
  return oracle.verified === true
    ? "accept"
    : oracle.refusal || oracle.task === "rejected"
      ? "refuse"
      : "unmeasured";
}

/** Whether the verifier's exported evidence verified by its own embedded verifier. */
export function evidenceOf(row) {
  if (row.evidence === undefined)
    return { valid: null, detail: "evidence validity was not checked (legacy row)" };
  return row.evidence;
}

/**
 * Every set the reports count, from one place. Each is a list of rows; the report names the
 * denominator next to each count.
 */
export function studySets(rows) {
  const truth = new Map(rows.map((row) => [row, rowTruth(row)]));
  const where = (predicate) => rows.filter(predicate);
  const behavioural = where(
    (row) => truth.get(row).class === "behavioural-executed" && truth.get(row).status !== null,
  );
  const textInspected = where(
    (row) => truth.get(row).class === "text-inspected" && truth.get(row).status !== null,
  );
  const suiteMeasured = where((row) => suiteOf(row).source === "independent");
  const suiteGreenRows = where(suiteGreen);
  const greenWithTruth = suiteGreenRows.filter((row) => behavioural.includes(row));
  const violated = behavioural.filter((row) => truth.get(row).status === "requirement-violated");
  const met = behavioural.filter((row) => truth.get(row).status === "requirement-met");
  return {
    truth,
    fetched: where((row) => row.outcome !== undefined),
    verifierExecuted: where((row) => row.outcome === "executed"),
    verifierBlocked: where((row) => row.outcome === "blocked"),
    verifierPending: where((row) => row.outcome === "fetched"),
    suiteMeasured,
    suiteByStatus: Object.fromEntries(
      ["passed", "failed", "not-collected", "setup-failed"].map((status) => [
        status,
        suiteMeasured.filter((row) => suiteOf(row).status === status),
      ]),
    ),
    suiteGreen: suiteGreenRows,
    evidenceChecked: where((row) => evidenceOf(row).valid !== null),
    evidenceValid: where((row) => evidenceOf(row).valid === true),
    evidenceInvalid: where((row) => evidenceOf(row).valid === false),
    behavioural,
    textInspected,
    unscored: where((row) => truth.get(row).adjudicated && truth.get(row).status === null),
    notAdjudicated: where((row) => !truth.get(row).adjudicated),
    legacyTruth: where((row) => truth.get(row).legacy && truth.get(row).status !== null),
    violated,
    met,
    greenWithTruth,
    falseGreen: greenWithTruth.filter((row) => violated.includes(row)),
  };
}

/** Wilson score interval, 95%, as percentages, or null for an empty denominator. */
export function wilson(k, n) {
  if (n === 0) return null;
  const z = 1.959964;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - half) * 100, high: Math.min(1, centre + half) * 100 };
}

/** `k / n = p% [low, high]`, or `n/a` over an empty denominator. */
export function share(k, n) {
  if (n === 0) return "n/a";
  const w = wilson(k, n);
  return `${k} / ${n} = ${((100 * k) / n).toFixed(1)}% [${w.low.toFixed(1)}, ${w.high.toFixed(1)}]`;
}

/** Tally one arm's decisions against task truth, over the rows with task truth. */
export function tallyDecisions(rows, decide) {
  const judged = rows.filter(hasTaskTruth);
  const t = { agree: 0, falseGreen: 0, falseRed: 0, unmeasured: 0, notRun: 0, n: judged.length };
  for (const row of judged) {
    const decision = decide(row);
    const status = rowTruth(row).status;
    if (decision === "not-run") t.notRun += 1;
    else if (decision === "unmeasured") t.unmeasured += 1;
    else if ((decision === "accept") === (status === "requirement-met")) t.agree += 1;
    else if (decision === "accept") t.falseGreen += 1;
    else t.falseRed += 1;
  }
  return t;
}
