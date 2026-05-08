/**
 * Phase 6 streaming-verification benchmark goals.
 *
 * Each goal has a `doomed` and a `clean` variant:
 *   - `doomed`: the architect persona emits a forbidden import early in
 *     its response. Streaming aborts mid-stream; the rest of the response
 *     is not paid for.
 *   - `clean`: same architect output without the forbidden import; the
 *     stream completes normally.
 *
 * The benchmark compares output-token cost between streaming-aborted and
 * non-streaming runs of the same doomed scenario, validating impl guide
 * §9 "Token savings on aborted generations measurable in run output".
 */

import type { ObligationV1 } from '../../src/contract/types';

export interface StreamingGoal {
  id: string;
  goal: string;
  obligations: ObligationV1[];
  /** Modules the streaming verifier flags as forbidden. */
  forbiddenImports: string[];
  /** When true, the responder emits a forbidden import early. */
  doomed: boolean;
  /**
   * Approximate response length the architect persona produces. The
   * doomed variant aborts well short of this; the clean variant
   * produces all of it.
   */
  responseLength: number;
}

const STD_OBLIGATIONS: ObligationV1[] = [
  { type: 'file-must-exist', path: 'src/feature.ts' },
  { type: 'build-must-pass', command: 'true' },
  { type: 'test-must-pass', command: 'true' },
];

export const STREAMING_GOALS: StreamingGoal[] = [
  {
    id: 'doomed-small',
    goal: 'add a feature using a doomed package (small)',
    obligations: STD_OBLIGATIONS,
    forbiddenImports: ['doomed-pkg'],
    doomed: true,
    responseLength: 256,
  },
  {
    id: 'doomed-medium',
    goal: 'add a feature using a doomed package (medium)',
    obligations: STD_OBLIGATIONS,
    forbiddenImports: ['doomed-pkg'],
    doomed: true,
    responseLength: 1024,
  },
  {
    id: 'doomed-large',
    goal: 'add a feature using a doomed package (large)',
    obligations: STD_OBLIGATIONS,
    forbiddenImports: ['doomed-pkg'],
    doomed: true,
    responseLength: 4096,
  },
  {
    id: 'clean-baseline',
    goal: 'add a clean feature without forbidden imports',
    obligations: STD_OBLIGATIONS,
    forbiddenImports: ['doomed-pkg'],
    doomed: false,
    responseLength: 1024,
  },
];

/** Sanity check that benchmark wiring matches the file's expected shape. */
export function assertStreamingGoalsShape(): void {
  if (STREAMING_GOALS.length < 4) {
    throw new Error(
      `streaming-goals shape regression: expected >=4 goals, got ${STREAMING_GOALS.length}`,
    );
  }
  const doomed = STREAMING_GOALS.filter((g) => g.doomed).length;
  if (doomed < 3) {
    throw new Error(`streaming-goals: expected at least 3 doomed variants, got ${doomed}`);
  }
}
