// Compute the corroborated structural gate's precision over the outcome-bad
// EG-viable slice. This is the measurement half of the v12 measurement loop: it
// reads the corroborated TP/FP the EG-viable measurement produced
// (benchmarks/real-corpus/eg-viable-corroborated.json) and the outcome-labeled
// viability screen (eg-viability.json), intersects them into the measurable
// slice, and asks assessCorroboratedGate whether the corroborated signal is
// precise enough (Wilson-95 lower >= 0.90) to gate.
//
// It is deterministic given the two committed artifacts, so measure-* writes it
// and check-* recomputes and compares. The number is honest by construction: on
// the current corpus the provisionable slice carries no outcome-bad PR, so the
// verdict is 'undefined-n' and the gate stays advisory.

import * as fs from 'fs';
import {
  assessCorroboratedGate,
  CORROBORATED_GATE_WILSON_FLOOR,
  CORROBORATED_GATE_MIN_TRUE_POSITIVE,
  type CorroboratedGateReadiness,
  type DetectorCorroboration,
} from '../../src/audit/gate/corroborated-gate';

const OUTCOME_BAD = new Set(['reverted', 'hotfixed']);

interface CorroboratedArtifact {
  prsMeasured?: number;
  prsCovered?: number;
  corroboratedByDetector?: Record<string, { truePositive: number; falsePositive: number }>;
}

interface ViabilityRecord {
  outcome: string;
  ecosystem: string | null;
  viable: boolean;
}

interface ViabilityArtifact {
  screened?: number;
  viableCount?: number;
  provisionableCount?: number;
  records?: ViabilityRecord[];
}

export interface CorroboratedGatePrecisionComparable {
  computedBy: string;
  note: string;
  wilsonFloor: number;
  minTruePositive: number;
  source: { corroborated: string; viability: string };
  slice: {
    screened: number;
    viableCount: number;
    provisionableCount: number;
    outcomeBadInProvisionable: number;
    outcomeBreakdownProvisionable: Record<string, number>;
    prsMeasured: number;
    prsCovered: number;
  };
  aggregate: CorroboratedGateReadiness;
  perDetector: DetectorCorroboration[];
}

export interface ComputeInputs {
  corroboratedFile: string;
  viabilityFile: string;
}

/**
 * Compute the corroborated-gate precision artifact (without the wall-clock
 * `generatedAt`, which the writer stamps) from the two committed inputs.
 *
 * @param inputs paths to eg-viable-corroborated.json and eg-viability.json.
 * @returns the comparable artifact: slice sizes, per-detector TP/FP, and the
 *   readiness verdict.
 * @throws {Error} if either artifact is missing or unparseable.
 */
export function computeCorroboratedGatePrecision(
  inputs: ComputeInputs,
): CorroboratedGatePrecisionComparable {
  const corroborated = readJson<CorroboratedArtifact>(inputs.corroboratedFile);
  const viability = readJson<ViabilityArtifact>(inputs.viabilityFile);

  const byDetector = corroborated.corroboratedByDetector ?? {};
  const perDetector: DetectorCorroboration[] = Object.keys(byDetector)
    .sort()
    .map((detector) => ({
      detector,
      truePositive: byDetector[detector]!.truePositive,
      falsePositive: byDetector[detector]!.falsePositive,
    }));

  const provisionable = (viability.records ?? []).filter(
    (r) => r.viable && r.ecosystem === 'node',
  );
  const outcomeBreakdown = tallyOutcomes(provisionable);
  const outcomeBadInProvisionable = provisionable.filter((r) => OUTCOME_BAD.has(r.outcome)).length;

  const aggregate = assessCorroboratedGate({
    perDetector,
    outcomeBadInSlice: outcomeBadInProvisionable,
  });

  return {
    computedBy: 'scripts/gate/measure-corroborated-gate.ts',
    note:
      'Corroborated structural gate precision over the outcome-bad EG-viable slice. ' +
      'A corroborated finding on an outcome-bad PR is a true positive, on an outcome-clean PR ' +
      'a false positive. The gate lights up only when the Wilson-95 lower bound clears the floor ' +
      'with enough true positives; a slice with no outcome-bad PR is undefined-n and never lights up.',
    wilsonFloor: CORROBORATED_GATE_WILSON_FLOOR,
    minTruePositive: CORROBORATED_GATE_MIN_TRUE_POSITIVE,
    source: { corroborated: inputs.corroboratedFile, viability: inputs.viabilityFile },
    slice: {
      screened: viability.screened ?? 0,
      viableCount: viability.viableCount ?? 0,
      provisionableCount: viability.provisionableCount ?? provisionable.length,
      outcomeBadInProvisionable,
      outcomeBreakdownProvisionable: outcomeBreakdown,
      prsMeasured: corroborated.prsMeasured ?? 0,
      prsCovered: corroborated.prsCovered ?? 0,
    },
    aggregate,
    perDetector,
  };
}

function tallyOutcomes(records: readonly ViabilityRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) out[r.outcome] = (out[r.outcome] ?? 0) + 1;
  // Sort keys for a deterministic object.
  return Object.keys(out)
    .sort()
    .reduce<Record<string, number>>((acc, k) => {
      acc[k] = out[k]!;
      return acc;
    }, {});
}

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`corroborated-gate precision: input not found: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    throw new Error(`corroborated-gate precision: ${file} is not valid JSON: ${(err as Error).message}`, {
      cause: err,
    });
  }
}
