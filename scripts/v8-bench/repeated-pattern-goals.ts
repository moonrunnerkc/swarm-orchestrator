/**
 * Phase 4 §7 memoization-benchmark goal suite.
 *
 * The §7 exit criterion calls for a measurable cost reduction on goals
 * that contain "repeated obligation patterns (e.g., 'add health checks
 * to 4 services')." Each goal in this suite is a contract whose
 * file-must-exist obligations all share the same architect output —
 * the natural shape for "repeat the same change in N locations."
 *
 * The synthetic responder under scripts/v8-bench/run-goal.ts returns a
 * deterministic architect body regardless of obligation, so when the
 * memoization layer is enabled, the second-and-later tournaments
 * inherit the first tournament's verdict.
 */

import type { ObligationV1 } from '../../src/contract/types';

export interface RepeatedPatternGoal {
  id: string;
  goal: string;
  /** Canonical-order obligation list. */
  obligations: ObligationV1[];
  /** Number of obligations of the repeated type — for reporting. */
  repeatedCount: number;
  /** Obligation type the repetition is over. */
  repeatedType: ObligationV1['type'];
}

export const REPEATED_PATTERN_GOALS: RepeatedPatternGoal[] = [
  {
    id: 'health-checks-3',
    goal: 'add health-check files to 3 services',
    obligations: [
      { type: 'file-must-exist', path: 'src/svc-a/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-b/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-c/health.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
    repeatedCount: 3,
    repeatedType: 'file-must-exist',
  },
  {
    id: 'health-checks-4',
    goal: 'add health-check files to 4 services (the §7 example)',
    obligations: [
      { type: 'file-must-exist', path: 'src/svc-a/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-b/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-c/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-d/health.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
    repeatedCount: 4,
    repeatedType: 'file-must-exist',
  },
  {
    id: 'health-checks-6',
    goal: 'add health-check files to 6 services',
    obligations: [
      { type: 'file-must-exist', path: 'src/svc-a/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-b/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-c/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-d/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-e/health.ts' },
      { type: 'file-must-exist', path: 'src/svc-f/health.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
    repeatedCount: 6,
    repeatedType: 'file-must-exist',
  },
];

/** Sanity assertion used by tests + the bench CLI. */
export function assertRepeatedPatternGoalsShape(): void {
  if (REPEATED_PATTERN_GOALS.length !== 3) {
    throw new Error(`expected 3 repeated-pattern goals, got ${REPEATED_PATTERN_GOALS.length}`);
  }
  for (const g of REPEATED_PATTERN_GOALS) {
    const repeated = g.obligations.filter((o) => o.type === g.repeatedType).length;
    if (repeated !== g.repeatedCount) {
      throw new Error(
        `repeated-pattern goal ${g.id} declares repeatedCount=${g.repeatedCount} but contract has ${repeated} obligations of type ${g.repeatedType}`,
      );
    }
    const hasBuild = g.obligations.some((o) => o.type === 'build-must-pass');
    const hasTest = g.obligations.some((o) => o.type === 'test-must-pass');
    if (!hasBuild || !hasTest) {
      throw new Error(`repeated-pattern goal ${g.id} is missing build- or test-must-pass`);
    }
  }
}
