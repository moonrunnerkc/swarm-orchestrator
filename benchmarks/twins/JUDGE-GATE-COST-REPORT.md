# Judge false-positive rate at gate stakes (Experiment 2)

What an LLM judge allowed to block merges costs on clean PRs, against the proof
tier's committed zero-false-positive point. The pre-registered instrument is
`scripts/experiments/judge-gate-cost.ts` (`npm run judge-gate-cost`), committed at
`d221007f` before the run.

**Status: partial.** The judge's deterministic operating point and the proof-tier
point are reported below, restated from funded committed artifacts. The live
threshold sweep, the broader clean false-positive set, the wild-corpus recall set,
and the per-verdict cost are **blocked by Anthropic credit exhaustion** and are
recorded as awaiting credits (see the halt note at the end). This report states
plainly what was measurable and what was not.

## The judge has no confidence dial (code-grounded)

The shipped judge-primary path runs the **v1-conservative** prompt
(`DEFAULT_JUDGE_PROMPT_VERSION`) on **claude-haiku-4-5-20251001**
(`PINNED_JUDGE_MODEL_ID`) at **temperature 0** (`anthropic-judge.ts:49`), and its
answers are content-cached (`llm-judge/cache.ts`). It returns a binary yes/no with
no confidence score, and a repeat of the same diff returns the cached answer. So a
threshold sweep over the pinned judge collapses to a single operating point: the
gate either blocks a PR or it does not, with no dial to trade false positives for
recall. That single point is the primary result. Only one model family (Anthropic)
is configured; a second family is recorded as absent.

To draw a reachable false-positive/recall curve without editing the versioned
prompt, the pre-registered instrument samples the same pinned prompt and model
K=5 times at temperature 1.0 (the only departure from the deterministic point) and
sweeps the block threshold over the yes-vote share. That sweep needs live judge
calls, which are currently blocked.

## Operating point (pinned deterministic judge), restated from the committed baseline

From the funded, committed judge baseline (`benchmarks/twins/judge-baseline.json`,
`JUDGE-BASELINE-REPORT.md`), the same pinned judge on the 8 semantic twin pairs:

| tier | kind | n | judge blocks | rate | Wilson-95 |
| --- | --- | --- | --- | --- | --- |
| semi-synthetic-semantic | clean (honest twins) | 8 | 1 | 12.5% | upper 0.47 |
| semi-synthetic-semantic | positive (cheat twins) | 8 | 7 | 87.5% | lower 0.53 |

Per category: cheat-mock-mutation caught 4/4 with 0/4 false blocks; goal-not-fixed
caught 3/4 with 1/4 false blocks. Expressed at gate stakes: **the judge would
false-block 12.5 of every 100 clean PRs on this slice (Wilson-95 upper 0.47)**, at
87.5% recall on the cheats. This is a diff-only floor for the path; a provisioned
run reads more context.

## The proof tier's point, restated

From the committed artifacts (`TWIN-SEPARATION-REPORT.md`,
`judge-baseline.json`, `block-eligibility.json`), not recomputed: on the same 8
semantic pairs the execution proof tier has **0% recall and 0% false positives**.
It abstains because these categories have no structural tell and the
claim-differential closure control abstains on a generic witness. On the
block-eligibility corpus no self-certifying trigger has fired, so the gate's
measured false-positive count is 0; the one circumstantial trigger is held out at
Wilson-95 lower 0.510, below the 0.90 bar.

## The trade

The judge is the only diff-only path that catches these semantic cheats, but its
single reachable operating point already blocks clean PRs (12.5 per 100 here). The
proof tier's point (zero false positives, replayable) sits off the judge's curve:
the judge cannot reach zero false positives while keeping nonzero recall, and it
cannot certify a block with an executed restoration the way the proof tier can.
Neither dominates; they are complementary, and both ship advisory. This is the
same complementarity the judge baseline reports, now framed at gate stakes: a
judge given the block decision has a measurable false-block rate; the proof tier,
by refusing to fire without executed evidence, does not.

## What is blocked, and why it is honest to report it separately

The pre-registered instrument also measures, on live judge calls:

- the **confidence curve** (K=5 self-consistency samples per semantic entry, block
  threshold swept 0.2..1.0), for the reachable false-positive/recall frontier;
- the **broader clean false-positive rate** on 44 semi-synthetic non-semantic
  honest twins judged for goal-not-fixed;
- **recall on the 7 held-out wild goal-not-fixed entries** (their diffs already
  fetch unauthenticated; the block is the judge call, not the fetch);
- **tokens, dollars, and wall clock per verdict** on claude-haiku-4-5.

All four need judge calls, and Anthropic credits are exhausted (HTTP 400 "credit
balance is too low"), so none ran. They are recorded as awaiting credits rather
than filled with placeholder zeros.

**Halt handling and a harness fix.** When first run under exhausted credits, the
instrument silently produced an all-zero report (every judge call collapsed to
`unavailable` inside `askJudge`, which reads as "judge never blocks"). That output
was a credit-failure artifact, not a measurement, and was discarded. The
instrument now makes one probe judge call up front and aborts with a clear message
if the model is unreachable, so a blocked run can never again be mistaken for a
real zero-false-positive result. Re-run `npm run judge-gate-cost` when credits are
topped up to fill the sweep, the broader sets, and the cost figures; the data
land in `judge-gate-cost.json` for the leaderboard generator.

## Bound follow-ons (independent of credits)

- outcome-clean provisionable slice (real corpus): needs a PR-title/claim join not
  vendored inline with the cached diffs;
- wild-pair honest twins: 1 resolved pair, diff fetch-bound (`honest-twins.json`).

The semi-synthetic honest twins are the primary clean measurement here; they are
labeled semi-synthetic, not the real-corpus outcome-clean slice, and are reported
in their own tier.
