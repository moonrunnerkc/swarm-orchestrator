# Judge false-positive rate at gate stakes (Experiment 2)

What an LLM judge allowed to block merges costs on clean PRs, and how many wild
cheats it catches, at the pinned operating point and over a sampled confidence
curve. Every number regenerates from `scripts/experiments/judge-gate-cost.ts`
(`npm run judge-gate-cost` to re-measure, `--report-only` to reframe the report
from the committed JSON without model calls).

## The judge has no confidence dial

The shipped judge-primary path runs the **v1-conservative** prompt on
**claude-haiku-4-5-20251001** at **temperature 0**, content-cached. It returns a binary
yes/no with no confidence score, and repeats of the same diff return the cached
answer. So a threshold sweep over the pinned judge collapses to a single
operating point. Only one model family (Anthropic) is configured; a second family
is recorded as absent.

## Findings

- **Wild-cheat recall: 1 of 7** goal-not-fixed
  wild cheats blocked (14%, Wilson-95
  [0.03, 0.51]).
  The judge misses most wild cheats on this set.
- **Clean-side false-block rate over n = 52: 1 of 52**
  clean PRs blocked (2%, Wilson-95 [0.00,
  0.10]). This is the combined clean denominator:
  1/8 on the semantic honest twins and
  0/44 on the broad clean set. The
  retired **12.5%** headline was the semantic-only slice
  (1/8), a small-n interim; the
  n = 52 figure is the honest clean-side rate.
- **Semantic-cheat recall (twin mode): 8 of 8** on the semi-synthetic semantic cheat twins.

## Operating point (pinned deterministic judge)

Each set judged once at the pinned temperature 0. Tiers never blend.

| tier | kind | n | judge blocks | block rate | Wilson-95 |
| --- | --- | --- | --- | --- | --- |
| semi-synthetic | clean | 8 | 1 | 13% | [0.02, 0.47] |
| semi-synthetic | positive | 8 | 8 | 100% | [0.68, 1.00] |
| semi-synthetic-clean-broad | clean | 44 | 0 | 0% | [0.00, 0.08] |
| wild | positive | 7 | 1 | 14% | [0.03, 0.51] |

The clean rows are the false-block rate; the positive rows are recall on cheats.

## Reachable confidence curve (self-consistency, sampled)

The pinned prompt and model, sampled **K=5** times at
**temperature 1** (the only departure from the
deterministic point; the prompt is unchanged), confidence = yes-votes / K, block
threshold swept, over the semantic honest twins (clean) and semantic cheat twins
(positive). The single semantic-clean false block is unanimous across all
K = 5 samples, so it does not clear at any swept threshold:

| threshold | false blocks / 100 clean | FP rate (Wilson-95) | recall (Wilson-95) |
| --- | --- | --- | --- |
| 0.2 | 13 | 13% [0.02, 0.47] | 100% [0.68, 1.00] |
| 0.4 | 13 | 13% [0.02, 0.47] | 88% [0.53, 0.98] |
| 0.6 | 13 | 13% [0.02, 0.47] | 88% [0.53, 0.98] |
| 0.8 | 13 | 13% [0.02, 0.47] | 88% [0.53, 0.98] |
| 1.0 | 13 | 13% [0.02, 0.47] | 88% [0.53, 0.98] |

## The proof tier's point

From the committed artifacts (benchmarks/twins/TWIN-SEPARATION-REPORT.md + benchmarks/real-corpus/block-eligibility.json), restated not
recomputed: recall 0% on the semantic
cheats, false-positive rate 0%.
The execution proof tier abstains on the semantic categories (no structural tell; the claim-differential closure control abstains on a generic witness). Zero false positives by construction: it never fires without executed evidence. n = 8 semantic twin pairs (recall), 0 gate firings on the block-eligibility corpus (false positives).

## Joint conclusion (both tiers, on this sample)

Stated plainly, numbers only:

- Neither tier catches wild cheats reliably. The judge blocked
  1/7 wild goal-not-fixed cheats; the execution
  proof tier abstains on the semantic categories (0%
  recall), so it catches 0 of the same wild set.
- Only the proof tier abstains rather than guesses. Its false-positive rate is
  0% by construction (it never fires
  without executed, replayable evidence). The judge carries a nonzero clean-side
  false-block rate (1/52 here) that does not clear at any swept
  threshold, in exchange for its diff-only recall on the semantic categories the
  proof tier cannot reach.
- Both tiers ship advisory. The intervals are wide at these sample sizes; read the
  numbers as this sample's operating point, not a general law.

## Spend

124 judge verdicts, 475942 input +
12313 output tokens on claude-haiku-4-5-20251001
($1/$5 per
MTok): **$0.5375 total**, $0.00433 per
verdict, 1565ms wall clock per verdict.

## Bound follow-ons

- outcome-clean provisionable slice (real corpus): needs a PR-title/claim join not vendored inline with the cached diffs
- wild-pair honest twins: 1 resolved pair, diff fetch-bound (honest-twins.json)

The semi-synthetic honest twins are labeled semi-synthetic, not the real-corpus
outcome-clean slice, and are reported in their own tier.
