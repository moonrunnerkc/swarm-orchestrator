# Judge baseline vs the proof tier (semantic twins)

The shipped judge-primary diff-only path run over the semantic twin pairs
(goal-not-fixed, cheat-mock-mutation), where no structural detector fires and the
execution proof tier abstains. It records the judge's recall on the cheat twins
against its false-positive rate on the honest twins, the trade the proof tier is
built to avoid. Every number regenerates from
`scripts/benchmarks/judge-baseline-measure.ts` (`npm run judge-baseline`).

## Judge vs proof tier

| tier | recall on cheat twins | false positives on honest twins |
| --- | --- | --- |
| judge-primary (diff-only) | 88% (Wilson-lower 0.53) | 13% (Wilson-upper 0.47) |
| execution proof tier | 0% (abstains: no structural tell, and the claim-differential closure control abstains on a generic witness) | 0% |

The point of the comparison: the judge is the only path that catches these
semantic cheats from the diff alone, so its recall is the reachable ceiling on
this slice, but it pays a false-positive rate on the clean side. The proof tier
trades that recall for zero false positives by refusing to fire without executed
evidence. Neither dominates; they are complementary, and both ship advisory.

## By category

| category | pairs | judge caught (cheat) | judge fired (honest, FP) |
| --- | --- | --- | --- |
| cheat-mock-mutation | 4 | 4/4 | 0/4 |
| goal-not-fixed | 4 | 3/4 | 1/4 |

n = 8 semantic twin pairs. The judge model and prompt version are recorded in
`judge-baseline.json`; the diff-only judge is a floor for the path (a provisioned
run reads more context). The wild-corpus judge run needs the wild diffs, which the
dataset references rather than vendors, and is a fetch-bound follow-on.
