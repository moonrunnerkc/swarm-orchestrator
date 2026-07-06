// The frozen v12 ground-truth baseline: the measured numbers the upgrade
// must hold or beat. Each floor names the committed artifact its live value
// is read from and the direction a regression would move it. The floors are
// code constants (GROUND_TRUTH_V12) so the bar cannot be quietly lowered by
// hand-editing the committed reference JSON; the check asserts the reference
// still carries these exact floors AND that the live metrics recomputed from
// the current artifacts sit at or above every one. Mirrors the compute/check
// discipline in scripts/promotions/check-policy.ts and
// scripts/gate/check-block-policy.ts.

import * as crypto from 'crypto';
import * as fs from 'fs';

/** A single measured floor the upgrade must hold or beat. */
export interface BaselineFloor {
  /** Stable metric id, e.g. "oracle-structural-recall". */
  readonly id: string;
  /** One-line human description. */
  readonly label: string;
  /** The value the live metric must stay at or above. */
  readonly floor: number;
  /** Denominator for count-style floors (recall counts), else null. */
  readonly denominator: number | null;
  /** Committed artifact the live value is read from, repo-relative. */
  readonly source: string;
  /** Why this floor exists and how the live value is derived. */
  readonly note: string;
}

/**
 * The v12 baseline, frozen from the current committed artifacts. Numbers are
 * the exact GROUND TRUTH the mission must hold or beat; every one is read back
 * from a committed file at check time, never re-derived.
 *
 * Oracle recall is split into a deterministic structural floor (recomputable
 * on any machine) and an overall floor that folds the two judge-primary
 * semantic categories (replayed from the committed judge cache, since this
 * repo cannot run the local judge on GPU-less hardware).
 */
export const GROUND_TRUTH_V12: readonly BaselineFloor[] = [
  {
    id: 'oracle-structural-recall',
    label: 'Oracle structural detector recall (true positives over injections)',
    floor: 258,
    denominator: 275,
    source: 'benchmarks/oracle-corpus/oracle-results.json',
    note: 'Sum of per-detector tp across 11 structural detectors. Deterministic and byte-identical across runs; no judge involved.',
  },
  {
    id: 'oracle-overall-recall',
    label: 'Oracle overall recall including judge-primary semantic categories',
    floor: 301,
    denominator: 325,
    source: 'benchmarks/oracle-corpus/oracle-results.json',
    note: 'Structural tp plus semantic judgeTp (goal-not-fixed, cheat-mock-mutation). The semantic component replays from the committed qwen3.6 v1-conservative judge cache.',
  },
  {
    id: 'real-corpus-precision-point-vs-interval',
    label: 'Real-corpus PR-level union precision (point) held above the frozen interval floor',
    floor: 0.09663835601719065,
    denominator: null,
    source: 'benchmarks/real-corpus/scores-outcome/latest.json',
    note: 'Live point precision must stay at or above the frozen Wilson-95 lower bound. Outcome-grounded over 197 PRs at an 11.2% bad base rate; point 0.217, interval [0.097, 0.419].',
  },
  {
    id: 'real-corpus-precision-wilson-lower',
    label: 'Real-corpus PR-level union precision Wilson-95 lower bound',
    floor: 0.09663835601719065,
    denominator: null,
    source: 'benchmarks/real-corpus/scores-outcome/latest.json',
    note: 'The interval floor itself must not collapse below where it was frozen.',
  },
  {
    id: 'eg-viable-count',
    label: 'Execution-grounded-viable PRs over the 197-PR corpus',
    floor: 12,
    denominator: 197,
    source: 'benchmarks/real-corpus/eg-viability.json',
    note: 'Phase 2 (pytest and Go runners) must beat this; as a floor it must never drop. The sandbox is Node-only today, so 185 of 197 PRs are dark.',
  },
];

/** Live metrics read from the current committed artifacts. */
export interface LiveMetrics {
  readonly oracleStructuralTp: number;
  readonly oracleStructuralInjections: number;
  readonly oracleSemanticJudgeTp: number;
  readonly oracleSemanticInjections: number;
  readonly realCorpusPrecisionPoint: number;
  readonly realCorpusPrecisionWilsonLower: number;
  readonly realCorpusRecall: number;
  readonly realCorpusF1: number;
  readonly realCorpusTruePositive: number;
  readonly realCorpusFalsePositive: number;
  readonly egViableCount: number;
  readonly egScreened: number;
}

/** A floor the live tree failed to hold. */
export interface Regression {
  readonly id: string;
  readonly label: string;
  readonly floor: number;
  readonly live: number;
  readonly source: string;
}

/** Result of comparing live metrics against the frozen floors. */
export interface BaselineEvaluation {
  readonly pass: boolean;
  readonly checked: number;
  readonly regressions: readonly Regression[];
}

// Floats read from JSON are exact doubles; a tiny epsilon keeps an
// equal-to-the-floor value (the common case on the frozen tree) from
// tripping on representation noise.
const EPSILON = 1e-12;

/**
 * Resolve the live value a floor is compared against. Kept explicit so the
 * coupling between a floor id and the metric it gates is visible and typed.
 *
 * @throws if the id is not a known floor.
 */
export function liveValueForFloor(id: string, live: LiveMetrics): number {
  switch (id) {
    case 'oracle-structural-recall':
      return live.oracleStructuralTp;
    case 'oracle-overall-recall':
      return live.oracleStructuralTp + live.oracleSemanticJudgeTp;
    case 'real-corpus-precision-point-vs-interval':
      return live.realCorpusPrecisionPoint;
    case 'real-corpus-precision-wilson-lower':
      return live.realCorpusPrecisionWilsonLower;
    case 'eg-viable-count':
      return live.egViableCount;
    default:
      throw new Error(
        `unknown baseline floor id "${id}"; add a case to liveValueForFloor in ` +
          'scripts/baseline/ground-truth.ts when you add a floor to GROUND_TRUTH_V12',
      );
  }
}

/**
 * Compare live metrics against a set of floors.
 *
 * @param floors the frozen floors (normally GROUND_TRUTH_V12).
 * @param live metrics read from the current committed artifacts.
 * @returns pass/fail plus the list of floors the live tree dropped below.
 */
export function evaluateBaseline(
  floors: readonly BaselineFloor[],
  live: LiveMetrics,
): BaselineEvaluation {
  const regressions: Regression[] = [];
  for (const f of floors) {
    const value = liveValueForFloor(f.id, live);
    if (value < f.floor - EPSILON) {
      regressions.push({
        id: f.id,
        label: f.label,
        floor: f.floor,
        live: value,
        source: f.source,
      });
    }
  }
  return { pass: regressions.length === 0, checked: floors.length, regressions };
}

// ---- artifact readers ------------------------------------------------------

interface OracleCategory {
  readonly injections: number;
  readonly tp?: number;
  readonly judgeTp?: number;
}
interface OracleResults {
  readonly structural: OracleCategory[];
  readonly semantic: OracleCategory[];
}
interface ScoresOutcome {
  readonly aggregatePrLevel: {
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly precisionWilson: { readonly lower: number };
  };
}
interface EgViability {
  readonly viableCount: number;
  readonly screened: number;
}

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(
      `baseline source artifact not found: ${file}. Regenerate it (see the note on the ` +
        'matching floor in GROUND_TRUTH_V12) before freezing or checking the baseline.',
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** Paths to the three committed artifacts the baseline reads. */
export interface SourcePaths {
  readonly oracleResults: string;
  readonly scoresOutcome: string;
  readonly egViability: string;
}

export const DEFAULT_SOURCES: SourcePaths = {
  oracleResults: 'benchmarks/oracle-corpus/oracle-results.json',
  scoresOutcome: 'benchmarks/real-corpus/scores-outcome/latest.json',
  egViability: 'benchmarks/real-corpus/eg-viability.json',
};

/**
 * Read the live metrics from the current committed artifacts.
 *
 * @param sources artifact paths (defaults to the canonical committed set).
 * @returns the live metrics used for both freezing and checking.
 * @throws if an artifact is missing or malformed.
 */
export function readLiveMetrics(sources: SourcePaths = DEFAULT_SOURCES): LiveMetrics {
  const oracle = readJson<OracleResults>(sources.oracleResults);
  let structuralTp = 0;
  let structuralInjections = 0;
  for (const c of oracle.structural) {
    structuralTp += requireNumber(c.tp, 'structural.tp', sources.oracleResults);
    structuralInjections += requireNumber(c.injections, 'structural.injections', sources.oracleResults);
  }
  let semanticTp = 0;
  let semanticInjections = 0;
  for (const c of oracle.semantic) {
    semanticTp += requireNumber(c.judgeTp, 'semantic.judgeTp', sources.oracleResults);
    semanticInjections += requireNumber(c.injections, 'semantic.injections', sources.oracleResults);
  }

  const scores = readJson<ScoresOutcome>(sources.scoresOutcome);
  const agg = scores.aggregatePrLevel;

  const eg = readJson<EgViability>(sources.egViability);

  return {
    oracleStructuralTp: structuralTp,
    oracleStructuralInjections: structuralInjections,
    oracleSemanticJudgeTp: semanticTp,
    oracleSemanticInjections: semanticInjections,
    realCorpusPrecisionPoint: requireNumber(agg.precision, 'aggregatePrLevel.precision', sources.scoresOutcome),
    realCorpusPrecisionWilsonLower: requireNumber(
      agg.precisionWilson?.lower,
      'aggregatePrLevel.precisionWilson.lower',
      sources.scoresOutcome,
    ),
    realCorpusRecall: requireNumber(agg.recall, 'aggregatePrLevel.recall', sources.scoresOutcome),
    realCorpusF1: requireNumber(agg.f1, 'aggregatePrLevel.f1', sources.scoresOutcome),
    realCorpusTruePositive: requireNumber(agg.truePositive, 'aggregatePrLevel.truePositive', sources.scoresOutcome),
    realCorpusFalsePositive: requireNumber(agg.falsePositive, 'aggregatePrLevel.falsePositive', sources.scoresOutcome),
    egViableCount: requireNumber(eg.viableCount, 'viableCount', sources.egViability),
    egScreened: requireNumber(eg.screened, 'screened', sources.egViability),
  };
}

function requireNumber(value: number | undefined, field: string, file: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(
      `baseline artifact ${file} is missing numeric field "${field}"; the artifact shape ` +
        'changed. Update the reader in scripts/baseline/ground-truth.ts to match.',
    );
  }
  return value;
}

/** sha256 of a file's bytes, for freeze-time provenance. */
export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---- frozen reference (committed JSON) -------------------------------------

/** One floor as serialized into the committed reference, plus its live value at freeze time. */
export interface FrozenFloor extends BaselineFloor {
  readonly liveAtFreeze: number;
}

/** The committed reference document written by freeze-ground-truth.ts. */
export interface FrozenReference {
  readonly schema: 'swarm.ground-truth.v12';
  readonly generatedAt: string;
  readonly computedBy: string;
  readonly note: string;
  /** sha256 of each source artifact at freeze time (provenance, not a gate). */
  readonly sources: Record<string, { readonly sha256: string; readonly bytes: number }>;
  readonly floors: readonly FrozenFloor[];
  /** Informational context that is recorded but not gated (undefined-n or Phase-target metrics). */
  readonly context: {
    readonly realCorpusRecall: number;
    readonly realCorpusF1: number;
    readonly realCorpusTruePositive: number;
    readonly realCorpusFalsePositive: number;
    readonly egScreened: number;
    readonly proofTierProvenFindingPrecision: {
      readonly n: number;
      readonly precision: number | null;
      readonly note: string;
    };
  };
}

/**
 * Build the committed reference document from the current live metrics.
 *
 * @param live metrics from readLiveMetrics().
 * @param sources source paths (for provenance shas).
 * @param generatedAt ISO timestamp for the freeze; injected so callers control it.
 */
export function buildFrozenReference(
  live: LiveMetrics,
  sources: SourcePaths,
  generatedAt: string,
): FrozenReference {
  const sourceList = [sources.oracleResults, sources.scoresOutcome, sources.egViability];
  const sourceProvenance: Record<string, { sha256: string; bytes: number }> = {};
  for (const s of sourceList) {
    sourceProvenance[s] = { sha256: sha256File(s), bytes: fs.statSync(s).size };
  }
  return {
    schema: 'swarm.ground-truth.v12',
    generatedAt,
    computedBy: 'scripts/baseline/freeze-ground-truth.ts',
    note:
      'Frozen GROUND TRUTH the v12 upgrade must hold or beat. Floors are code constants in ' +
      'scripts/baseline/ground-truth.ts (GROUND_TRUTH_V12); this file is the committed, ' +
      'human-readable mirror. Guarded by npm run baseline:check. Re-freeze with ' +
      'npm run baseline:freeze after a measured improvement, then raise the code floors to match.',
    sources: sourceProvenance,
    floors: GROUND_TRUTH_V12.map((f) => ({ ...f, liveAtFreeze: liveValueForFloor(f.id, live) })),
    context: {
      realCorpusRecall: live.realCorpusRecall,
      realCorpusF1: live.realCorpusF1,
      realCorpusTruePositive: live.realCorpusTruePositive,
      realCorpusFalsePositive: live.realCorpusFalsePositive,
      egScreened: live.egScreened,
      proofTierProvenFindingPrecision: {
        n: 0,
        precision: null,
        note: 'No fully-controlled block trigger has fired on the EG-viable slice; proven-finding precision is undefined (n=0). Recorded for honesty, not gated. Phase 4 lights this up only once n is real and the Wilson-95 lower bound clears 0.90.',
      },
    },
  };
}

/**
 * Assert the committed reference carries the same floors as GROUND_TRUTH_V12.
 * This is the anti-tamper half of the check: a hand-edit that lowers a floor
 * in the JSON without editing the code constant (or vice versa) is caught here.
 *
 * @returns null if consistent, else a message describing the mismatch.
 */
export function referenceMatchesConstants(ref: FrozenReference): string | null {
  const strip = (f: BaselineFloor): BaselineFloor => ({
    id: f.id,
    label: f.label,
    floor: f.floor,
    denominator: f.denominator,
    source: f.source,
    note: f.note,
  });
  const fromFile = ref.floors.map(strip);
  const fromCode = GROUND_TRUTH_V12.map(strip);
  if (JSON.stringify(fromFile) !== JSON.stringify(fromCode)) {
    return (
      'the committed reference floors do not match GROUND_TRUTH_V12 in ' +
      'scripts/baseline/ground-truth.ts. Someone edited one without the other. ' +
      'Re-run: npm run baseline:freeze (and, if you intend to move the bar, edit the code ' +
      'constant first).'
    );
  }
  return null;
}
