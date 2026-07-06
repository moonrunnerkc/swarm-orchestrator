// Readiness of the corroborated structural gate, measured over the outcome-bad
// EG-viable slice. A structural finding is "corroborated" when a runtime signal
// (a surviving mutant, a coverage gap, a still-failing repro) lands on its
// changed line; corroborate.ts computes that. This module answers a different
// question: is that corroboration precise enough, against real merged-PR
// outcomes, to let the corroborated signal gate a merge?
//
// The gate lights up only when the Wilson 95% lower bound of its precision
// clears 0.90 with enough true positives. The honest failure mode this guards
// against is "undefined n": a slice with no outcome-bad PRs has no positive
// class, so precision is not a meaningful readiness signal at any point value.
// assessCorroboratedGate returns 'undefined-n' in that case and never 'ready',
// so the gate cannot be lit on a denominator that cannot support it.

import { wilsonInterval, type WilsonInterval } from './wilson';

/** The Wilson lower-bound floor the corroborated gate must clear to light up.
 *  Mirrors the block-eligibility and promotions floors. */
export const CORROBORATED_GATE_WILSON_FLOOR = 0.9;

/** The minimum true-positive count before precision is trusted, so a 1/1 does
 *  not promote on luck. Mirrors DEFAULT_MIN_TRUE_POSITIVE elsewhere. */
export const CORROBORATED_GATE_MIN_TRUE_POSITIVE = 5;

/** ready: precision proven; not-ready: measured but below the bar; undefined-n:
 *  no positive class or no corroborated findings, so precision is unmeasurable. */
export type CorroboratedGateStatus = 'ready' | 'not-ready' | 'undefined-n';

/** Corroborated true/false positives for one detector over the measured slice.
 *  A true positive is a corroborated finding on an outcome-bad PR; a false
 *  positive is one on an outcome-clean PR. */
export interface DetectorCorroboration {
  readonly detector: string;
  readonly truePositive: number;
  readonly falsePositive: number;
}

export interface CorroboratedGateInput {
  /** Per-detector corroborated TP/FP over the measurable (provisionable) slice. */
  readonly perDetector: readonly DetectorCorroboration[];
  /** Outcome-bad PR count in the measurable slice. Zero means no positive class. */
  readonly outcomeBadInSlice: number;
  /** Override the Wilson floor (defaults to CORROBORATED_GATE_WILSON_FLOOR). */
  readonly wilsonFloor?: number;
  /** Override the min-TP bar (defaults to CORROBORATED_GATE_MIN_TRUE_POSITIVE). */
  readonly minTruePositive?: number;
}

export interface CorroboratedGateReadiness {
  readonly status: CorroboratedGateStatus;
  readonly truePositive: number;
  readonly falsePositive: number;
  /** Total corroborated findings scored (TP + FP). */
  readonly trials: number;
  readonly outcomeBadInSlice: number;
  /** Point precision, or null when undefined-n (no meaningful precision). */
  readonly precision: number | null;
  /** Wilson 95% interval, or null when undefined-n. */
  readonly wilson: WilsonInterval | null;
  readonly wilsonFloor: number;
  readonly minTruePositive: number;
  readonly reason: string;
}

/**
 * Assess whether the corroborated structural gate is ready to gate merges.
 *
 * The gate is 'ready' only when there is a positive class to measure against
 * (at least one outcome-bad PR in the slice), at least one corroborated finding
 * was scored, the true-positive count clears the minimum, and the Wilson 95%
 * lower bound of the precision clears the floor. A slice with no outcome-bad PRs
 * or no corroborated findings is 'undefined-n' and can never be 'ready': you
 * cannot establish precision on a denominator with no positives.
 *
 * @param input per-detector corroborated TP/FP, the outcome-bad slice size, and
 *   optional floor/min-TP overrides.
 * @returns the readiness verdict with the precision, Wilson interval, and reason.
 */
export function assessCorroboratedGate(input: CorroboratedGateInput): CorroboratedGateReadiness {
  const wilsonFloor = input.wilsonFloor ?? CORROBORATED_GATE_WILSON_FLOOR;
  const minTruePositive = input.minTruePositive ?? CORROBORATED_GATE_MIN_TRUE_POSITIVE;
  const truePositive = input.perDetector.reduce((sum, d) => sum + d.truePositive, 0);
  const falsePositive = input.perDetector.reduce((sum, d) => sum + d.falsePositive, 0);
  const trials = truePositive + falsePositive;

  const base = {
    truePositive,
    falsePositive,
    trials,
    outcomeBadInSlice: input.outcomeBadInSlice,
    wilsonFloor,
    minTruePositive,
  };

  // No positive class or no corroborated findings: precision is unmeasurable,
  // so the gate is undefined-n and never lights up. This is the honest floor
  // the mission calls for: never report readiness on undefined n.
  if (input.outcomeBadInSlice === 0 || trials === 0) {
    return {
      ...base,
      status: 'undefined-n',
      precision: null,
      wilson: null,
      reason:
        input.outcomeBadInSlice === 0
          ? `no outcome-bad PR in the measured slice (n_bad=0); precision has no positive class, ` +
            `so the corroborated gate cannot be proven and stays advisory`
          : `no corroborated finding was scored over the slice (trials=0); nothing to measure, ` +
            `so the corroborated gate stays advisory`,
    };
  }

  const wilson = wilsonInterval(truePositive, trials);
  const clears = wilson.lower >= wilsonFloor && truePositive >= minTruePositive;
  return {
    ...base,
    status: clears ? 'ready' : 'not-ready',
    precision: wilson.point,
    wilson,
    reason: clears
      ? `corroborated precision Wilson-95 lower ${wilson.lower.toFixed(4)} >= ${wilsonFloor} ` +
        `with ${truePositive} true positive(s); the gate is eligible to block`
      : `corroborated precision Wilson-95 lower ${wilson.lower.toFixed(4)} below ${wilsonFloor} ` +
        `(or true positives ${truePositive} < ${minTruePositive}); the gate stays advisory`,
  };
}

/**
 * One-line human summary of a readiness verdict, for logs and reports.
 *
 * @param readiness a corroborated-gate readiness verdict.
 * @returns e.g. "UNDEFINED-N (n_bad=0)" or "READY (wilson-lower 0.91)".
 */
export function summarizeCorroboratedGate(readiness: CorroboratedGateReadiness): string {
  if (readiness.status === 'undefined-n') {
    return `UNDEFINED-N (n_bad=${readiness.outcomeBadInSlice}, trials=${readiness.trials})`;
  }
  const lower = readiness.wilson !== null ? readiness.wilson.lower.toFixed(4) : 'n/a';
  return `${readiness.status.toUpperCase()} (wilson-lower ${lower}, tp=${readiness.truePositive}/${readiness.trials})`;
}
