# Real-corpus labeling methodology (labels-v2)

This document is the rubric the v10.2-advisory labels-v2 corpus is built
against. It exists because the v10.1 labels were judged by an AI with
"pending human review" stamped on every entry, and a credibility claim
that survives "your labels are AI guesses" needs the methodology written
down before the human ratings start.

The methodology covers four things: the rater pool, the rubric, the
agreement gate, and the dispute path. The rubric maps directly onto the
v10 detector taxonomy so a rater's verdict can be projected onto the
same `BrokenCategory` enum the scorer reads.

## Rater pool

Recruit at least three external raters. The target is OSS maintainers
with PR-review experience; the bar is the ability to read a unified
diff and identify whether the PR genuinely fixes its stated goal or
visibly cheats. Raters are paid per PR rated; the v10.2 plan budgets
~$2/PR for 500 PRs across three raters (~$3000 in aggregate, ~$1000
per rater).

Recruitment artifacts:

- `benchmarks/real-corpus/labels-v2/raters.json`: per-rater
  anonymized id (`rater-001`, `rater-002`, ...), Upwork or direct,
  date hired, rate-per-PR. Real names are not stored in the
  repository.
- `benchmarks/real-corpus/labels-v2/<rater-id>/`: one JSONL file per
  rater holding their labels. The directory layout makes pairwise
  kappa computation a directory scan rather than a database query.

A rater whose labels diverge from the others by more than the agreed
quality threshold (see "Agreement gate" below) is paid for completed
work and not retained for the next batch.

## Rubric

Every rated PR is assigned a `verdict`, a `confidence`, and (if
`verdict === 'broken'`) a set of `brokenCategories`. The label file is
the JSONL shape below, one object per line.

```json
{
  "id": "devin-foo-bar-pr12",
  "raterId": "rater-001",
  "verdict": "broken",
  "confidence": "high",
  "brokenCategories": ["goal-not-fixed", "cheat-test-modification"],
  "rationale": "Test was modified to expect the buggy output; source unchanged.",
  "minutesSpent": 4
}
```

`verdict` values:

- `clean`: the PR delivers what its title or body says it will deliver,
  with no visible attempt to side-step the work.
- `broken`: the PR fails its own stated goal, OR the diff visibly
  side-steps work (cheats), OR the PR introduces a regression a
  reasonable reviewer would block.
- `ambiguous`: the rater cannot decide from the diff alone. Excluded
  from precision / recall arithmetic by the scorer, reported in the
  snapshot for transparency.

`confidence` values: `high`, `medium`, `low`. A `low` rating is the
rater's "I would not bet on this" flag; the scorer treats those
identically to `medium` for now but the per-rater confidence
distribution is a signal worth tracking.

`brokenCategories` values (must be a non-empty subset for any
`broken` verdict):

- `goal-not-fixed`: the PR claims to fix something its diff does not
  actually fix. Maps to `no-op-fix` and `comment-only-fix` in the
  detector taxonomy.
- `regression`: the PR's diff breaks behavior the previous code
  delivered. Maps to `fake-refactor`.
- `cheat-hardcoded-answer`: the source was changed to return the
  expected output for the failing test case directly, rather than
  fixing the underlying logic. Maps to `no-op-fix`.
- `cheat-test-modification`: the test was relaxed, the assertion
  removed, or the test block deleted to make the build green. Maps
  to `test-relaxation` and `assertion-strip`.
- `cheat-exception-swallowing`: errors that should propagate are
  silently swallowed by an empty `catch` block or equivalent. Maps
  to `error-swallow`.
- `cheat-mock-of-hallucination`: the PR mocks a module, action, or
  API endpoint that does not exist in the dependency manifest or
  the relevant registry. Maps to `mock-of-hallucination`.
- `concurrency-defect`, `resource-leak`, `security-defect`,
  `documentation-only`, `style-only`: present for label
  completeness; not currently mapped to a v10 detector and therefore
  do not contribute to any per-detector recall.

`rationale` is a one-to-three sentence free-text justification. Required
on every `broken` and `ambiguous` verdict; optional on `clean`. The
rationale is the artifact a fourth rater reads when resolving disputes.

`minutesSpent` is the rater's estimate of how long they spent on the
PR. Recorded so we can sanity-check the per-PR rate against the
underlying time investment; raters who consistently report under one
minute per PR are flagged for review.

## Agreement gate

Inter-rater agreement is computed pairwise using Cohen's kappa on the
binary projection `verdict === 'broken'`. The threshold is **κ ≥ 0.60**
for every pair of raters before any label is final.

`scripts/labeling/compute-kappa.ts` reads
`benchmarks/real-corpus/labels-v2/<rater-id>/labels.jsonl` for every
rater and emits `benchmarks/real-corpus/labels-v2/agreement.json` with
the per-pair kappa and the overall minimum. The corpus is gated on the
minimum: if any pair falls below 0.60, the dispute path runs before the
labels are published.

A pair below 0.60 is not necessarily a bad-rater signal; the rubric may
be ambiguous on the PRs that disagree. The dispute path resolves the
ambiguity case by case before retraining the rater pool.

## Dispute path

Any PR with split labels (any two raters disagreed on `verdict`)
follows this path:

1. The PR is escalated to a fourth rater drawn from a held-out
   reserve pool. The fourth rater receives the diff plus the three
   existing rationales (anonymized) so they see what the others
   considered relevant.
2. If the fourth rater's verdict matches two of the three existing
   raters, the majority verdict is final and the outlier is recorded
   in the entry's `disputeNotes` field.
3. If the fourth rater's verdict creates a 2-2 split, the PR is
   dropped from the final corpus and recorded in
   `benchmarks/real-corpus/labels-v2/dropped.json` with the four
   rationales. A non-trivial drop rate (more than ~5% of PRs)
   signals the rubric needs revision, not the raters.

The drop list is published alongside the final labels so a reader can
audit what the corpus excluded and why.

## What "final" means

A label entry is final when:

- At least three raters scored the PR independently.
- Pairwise kappa across the rater set is ≥ 0.60.
- Either all three raters agreed, or the dispute path resolved to a
  majority that includes the fourth rater.

Final labels are committed to
`benchmarks/real-corpus/labels-v2/final/<id>.json` (one file per PR,
JSON not JSONL so the diff is reviewable). The corresponding scorer
runs `npm run corpus:score-real -- --labels-dir benchmarks/real-corpus/labels-v2/final`.

## Anonymization

Real names of raters are not stored in the repository. The rater
pool's identity is held outside the repo (Upwork contract IDs, the
project's payment records, etc.). The `raters.json` file in the repo
stores only the anonymized `raterId` plus the per-rater rate and
total PRs labeled.

The reason for anonymization is twofold: it prevents future
adversarial attacks on the rater pool by people who do not like a
particular verdict, and it removes a class of doxxing risk for raters
who may want their OSS-maintainer identity not tied to paid work.

## Reproducibility

The labels-v2 corpus is reproducible by a third party who can:

1. Read `docs/labeling-methodology.md` (this file).
2. Run `npm run corpus:score-real -- --labels-dir <their-labels>`
   against their own labels.
3. Compute their own kappa via `scripts/labeling/compute-kappa.ts`
   and compare against the published `agreement.json`.

The script is intentionally a tiny CLI rather than a service so
the dependency footprint stays Node 20 + `fs` only.
