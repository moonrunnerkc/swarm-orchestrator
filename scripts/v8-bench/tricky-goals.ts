/**
 * Phase 3 §6 exit criterion (a): "a tournament run on a deliberately
 * tricky obligation shows multiple candidates, verifier picks the best,
 * top candidate commits." This module hosts the synthetic tricky-goal
 * suite used by the Phase 3 cost-and-accuracy benchmark.
 *
 * "Tricky" in synthetic mode means: candidates produced by a single
 * persona at a single temperature have a non-trivial chance of writing
 * file content that won't satisfy a *content-aware* verifier. The
 * benchmark pairs each file-must-exist obligation with a build-must-pass
 * that runs `grep` for a marker the architect either emits ("good") or
 * omits ("bad"). Single mode commits the first architect candidate as-is;
 * tournament mode picks the highest-scoring candidate via the verifier
 * persona, which means quality matters and tournament wins more often.
 */

import type { ObligationV1 } from '../../src/contract/types';
import type { BenchGoal } from './goals';

/**
 * Per-goal configuration for the tricky bench. `expectedFailureRate` is
 * the probability that a single architect candidate is "bad" (lacks the
 * marker the build-must-pass command grep's for).
 *
 * `markerFile` and `marker` define the content-aware verifier: the
 * benchmark synthesizes a build-must-pass obligation `grep -q <marker> <markerFile>`
 * after every file-must-exist whose path equals `markerFile`.
 */
export interface TrickyGoal extends BenchGoal {
  expectedFailureRate: number;
  /** Repo-relative path the marker must appear in (matches a file-must-exist). */
  markerFile: string;
  /** Literal string the build-must-pass command grep's for. */
  marker: string;
}

export const TRICKY_BENCH_GOALS: TrickyGoal[] = [
  {
    id: 'tricky-edge-handling',
    size: 'small',
    goal: 'add a function that handles all edge cases of timezone conversion',
    obligations: [
      { type: 'file-must-exist', path: 'src/timezone.ts' },
      {
        type: 'build-must-pass',
        command: 'grep -q TZ_HANDLER_OK src/timezone.ts',
      },
      { type: 'test-must-pass', command: 'true' },
    ] satisfies ObligationV1[],
    expectedFailureRate: 0.45,
    markerFile: 'src/timezone.ts',
    marker: 'TZ_HANDLER_OK',
  },
  {
    id: 'tricky-concurrent-state',
    size: 'small',
    goal: 'add a concurrent state machine with idempotent transitions',
    obligations: [
      { type: 'file-must-exist', path: 'src/state-machine.ts' },
      {
        type: 'build-must-pass',
        command: 'grep -q STATE_MACHINE_OK src/state-machine.ts',
      },
      { type: 'test-must-pass', command: 'true' },
    ] satisfies ObligationV1[],
    expectedFailureRate: 0.5,
    markerFile: 'src/state-machine.ts',
    marker: 'STATE_MACHINE_OK',
  },
  {
    id: 'tricky-error-recovery',
    size: 'small',
    goal: 'add an error-recovery layer with retry and dead-letter handling',
    obligations: [
      { type: 'file-must-exist', path: 'src/recovery.ts' },
      {
        type: 'build-must-pass',
        command: 'grep -q RECOVERY_OK src/recovery.ts',
      },
      { type: 'test-must-pass', command: 'true' },
    ] satisfies ObligationV1[],
    expectedFailureRate: 0.4,
    markerFile: 'src/recovery.ts',
    marker: 'RECOVERY_OK',
  },
];

/** Sanity check: at least one tricky goal exists and rates are sane. */
export function assertTrickyGoalsShape(): void {
  if (TRICKY_BENCH_GOALS.length < 3) {
    throw new Error(`tricky-goals suite must have at least 3 goals; got ${TRICKY_BENCH_GOALS.length}`);
  }
  for (const g of TRICKY_BENCH_GOALS) {
    if (g.expectedFailureRate < 0.3 || g.expectedFailureRate > 0.7) {
      throw new Error(
        `tricky goal ${g.id} expectedFailureRate ${g.expectedFailureRate} outside [0.3, 0.7]`,
      );
    }
    const hasMarkerFile = g.obligations.some(
      (o) => o.type === 'file-must-exist' && o.path === g.markerFile,
    );
    if (!hasMarkerFile) {
      throw new Error(
        `tricky goal ${g.id} markerFile ${g.markerFile} not in obligation list`,
      );
    }
    const hasMarkerCheck = g.obligations.some(
      (o) => o.type === 'build-must-pass' && o.command.includes(g.marker),
    );
    if (!hasMarkerCheck) {
      throw new Error(
        `tricky goal ${g.id} marker ${g.marker} missing from any build-must-pass command`,
      );
    }
  }
}
