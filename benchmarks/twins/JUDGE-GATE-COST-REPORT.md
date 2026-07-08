# Judge false-positive rate at gate stakes (Experiment 2)

What an LLM judge allowed to block merges costs on clean PRs, at every reachable
confidence threshold, against the proof tier's committed zero-false-positive
point. Every number regenerates from `scripts/experiments/judge-gate-cost.ts`
(`npm run judge-gate-cost`).

## The judge has no confidence dial

The shipped judge-primary path runs the **v1-conservative** prompt on
**claude-haiku-4-5-20251001** at **temperature 0**, content-cached. It returns a binary
yes/no with no confidence score, and repeats of the same diff return the cached
answer. So a threshold sweep over the pinned judge collapses to a single
operating point. That point is the primary result below. Only one model family
(Anthropic) is configured; a second family is recorded as absent.

## Operating point (pinned deterministic judge)

Each set judged once at the pinned temperature 0. Tiers never blend.

| tier | kind | n | judge blocks | block rate | Wilson-95 |
| --- | --- | --- | --- | --- | --- |
| semi-synthetic | clean | 8 | 1 | 13% | [0.02, 0.47] |
| semi-synthetic | positive | 8 | 8 | 100% | [0.68, 1.00] |
| semi-synthetic-clean-broad | clean | 44 | 0 | 0% | [0.00, 0.08] |
| wild | positive | 7 | 1 | 14% | [0.03, 0.51] |

The clean rows are the false-block rate: the share of clean PRs the judge would
block if it gated. The positive rows are recall on cheats.

## Reachable confidence curve (self-consistency, sampled)

The pinned prompt and model, sampled **K=5** times at
**temperature 1** (the only departure from the
deterministic point; the prompt is unchanged), confidence = yes-votes / K, block
threshold swept. This is the reachable false-positive/recall frontier for a judge
built on top of the pinned classifier. Over the 5-threshold
sweep on the 8 semantic honest twins (clean) and 8 semantic cheat twins
(positive):

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

**The trade.** The judge is the only diff-only path that catches these semantic
cheats. What the curve above measures, on n = 8 semantic honest twins and n = 8
semantic cheat twins: the judge's false-positive rate does not drop to zero at any
swept threshold that still keeps recall above zero. The single false block is
unanimous across all K = 5 samples, so raising the threshold cannot remove it
without also dropping recall (recall stays high across every threshold in the
table). The proof tier holds a 0% false-positive rate on the same set and certifies
each block with executed, replayable evidence. So on this sample the two points do
not coincide: the judge trades a nonzero false-positive rate for the only diff-only
recall on these categories, and it cannot certify a block the way an executed
restoration proof can. This is what these sixteen pairs show, stated with their
Wilson-95 intervals in the tables above — the intervals are wide at n = 8, so read
it as this sample's frontier, not a general impossibility. Neither path dominates;
they are complementary, and both ship advisory.

## Spend

124 judge verdicts, 475942 input +
12313 output tokens on claude-haiku-4-5-20251001
($1/$5 per
MTok): **$0.5375 total**, $0.00433 per
verdict, 1565ms wall clock per verdict.

## Bound follow-ons

- outcome-clean provisionable slice (real corpus): needs a PR-title/claim join not vendored inline with the cached diffs
- wild-pair honest twins: 1 resolved pair, diff fetch-bound (honest-twins.json)

The semi-synthetic honest twins are the primary clean measurement here; they are
labeled semi-synthetic, not the real-corpus outcome-clean slice, and are reported
in their own tier.
