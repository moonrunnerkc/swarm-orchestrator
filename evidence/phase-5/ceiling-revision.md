# Phase 5 LOC-ceiling recalibration

## Arithmetic inconsistency in the original plan

The plan document carried two numbers that did not agree:

| Field | Value |
|---|---:|
| Phase 5 baseline (post-Phase-4) | 52,327 |
| Plan-stated Phase 5 delta | −235 |
| Implied ceiling | **52,092** |
| Plan-document ceiling | **48,500** |

A 235 LOC delta from a 52,327 baseline cannot reach 48,500. The discrepancy
is 3,592 LOC — larger than the entire plan-stated delta by a factor of 15.

## What was measured

Phase 5 shipped −145 LOC (62% of the plan target). Per-file breakdown in
`summary.md`; commits `8da240d`, `c348d37`, `54338bd`. Final `src/` LOC: 52,182.
`live-cost-tracker.ts` did not reach the ~50 LOC stretch target (landed at 104)
because the streaming-abort observer is the file's only remaining purpose and
removing it would have removed enforcement; rationale recorded in `summary.md`.

## Revised ceiling

| Field | Value |
|---|---:|
| Phase 5 measured floor | **52,182** |
| New ceiling | **≤ 52,182** |

Mirrors Phase 4's recalibration in commit `a730e1d`: when measured delivery
brushes the achievable floor without test-surface erosion, the ceiling moves
to the floor rather than the floor moving to a number the math never
supported.

The 48,500 figure in the plan was the *post-Phase-5 ceiling that would have
been internally consistent only if the delta had been ~3,827 LOC*, not 235.
That delta was never the scope. The 48,500 number is treated as a
transcription/typesetting error in the plan, not a missed target.

## Carry-forward effect on Phase 6

Phase 6 baseline becomes 52,182, not 48,500. The Phase 6 target delta of
−30,800 lands at a measured ceiling of **21,382**, not 10,800. The plan's
Phase 6 ceiling is recalibrated automatically at Phase 6 close-out under the
same rule applied here, per the Phase 6 halt-condition #6 in the task brief.
