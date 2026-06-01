# Audit evaluation methodology

How the cheat-detection surface is measured: what the oracle corpus is,
how recall and false-positive rate are computed, and the caveats that keep
the numbers honest.

## The oracle corpus

`benchmarks/oracle-corpus/` holds constructively-injected defects. An
injector (`src/audit/oracle/inject/`) takes a presumed-clean real PR diff
and splices in exactly one labeled defect: it picks a carrier file by
file-kind analysis and appends a self-contained defect hunk (or, for the
whole-PR detectors, emits an isolated single-defect diff). Every entry is
a broken-variant `.diff` plus a `.label.json` stamping the category, the
injector id, the carrier file, the hunk index, the line range, the source
PR url, and a sha256 over the diff. `npm run oracle:build` regenerates the
corpus byte-identical; CI builds it twice and compares.

Twelve categories: the ten structural cheat categories a detector keys on,
plus two semantic categories (`goal-not-fixed`, `cheat-mock-mutation`)
that have no structural tell and are caught only by the judge-primary
path.

## How recall is measured

`npm run benchmarks:oracle` runs each structural detector against its own
injection class and counts a finding of the expected category at any
severity (warn or block) as a catch. Whole-PR-scoped detectors
(comment-only-fix, coverage-erosion) and the source/test detector
(no-op-fix) are measured with isolated single-defect diffs, because
appending a defect into a carrier that already has real changes masks
their signal. The two semantic categories are scored by the judge-primary
path; their structural catch is 0 by construction.

Per-detector recall is in `benchmarks/oracle-corpus/per-detector-recall.md`;
the judge-primary numbers are in `judge-primary-vs-structural.md`.

## How false-positive rate is measured

False positives are measured against the presumed-clean real PRs in
`benchmarks/real-corpus/` (entries hand-labeled `clean`). For the
deterministic detectors this is the block-level firing rate on clean PRs
(captured in the pre-upgrade baseline). For the judge-primary path it is
the fraction of clean PRs the judge falsely flags, measured during
calibration (`judge-calibration.md`) on a seeded sample.

## Splits

Judge calibration uses a deterministic 80/20 split of the semantic
injections (every fifth case by id is held out) for recall, and a seeded
sample of clean reals for false-positive rate. The split is reproducible
without a seed file because it is positional.

## The honesty caveat

Injected recall proves detection of the defect classes we inject; it does
not prove detection of unobserved defect classes. False-positive rate is
measured against presumed-clean real PRs; the "presumed" is load-bearing.
Both numbers are defensible, neither is overclaimed.

## Chunking and per-hunk are infrastructure, not recall wins

Hunk-aware chunking and per-hunk localization put the right substrate in
front of the judge: a tail defect in an oversized PR reaches the judge
instead of being truncated away, and a verdict can be attributed to a
stable (file, hunk-index) id. But the confirm judge defaults to
high-precision and declines isolated patterns, so on the current judge the
recall on these paths stays low (tail-defect 1/10, per-hunk localization
0/10). The mechanism tests (`diff-chunker.test.ts`, `tail-defect.test.ts`)
prove the plumbing; the reports state the recall honestly rather than
claiming a win the judge does not deliver.

A `LOCALIZED_CONFIRM_SYSTEM_PROMPT` (judge a single hunk on its face rather
than withholding a YES for unseen context) lifts tail-defect recall to 5/10
in measurement but does not move per-hunk (a model failure, not prompt
conservatism). It is not shipped: the judge cache key does not fold the
prompt text, so a production switch needs a cache-key discriminator, and
the prompt's false-positive impact on real PRs is unmeasured. Future work:
ship a per-path prompt assignment (conservative whole-diff, localized
single-hunk) once the localized prompt's real-PR false-positive rate is
validated, or move to a stronger judge for per-hunk localization.

## How to add a new injector

1. Add `src/audit/oracle/inject/<category>.ts` exporting an `Injector`
   (`id`, `category`, `description`, `plan(input)`). The plan picks a
   carrier from the PR's files and returns the defect hunk; return `null`
   to refuse a PR with no suitable carrier.
2. Register it in `src/audit/oracle/inject/index.ts` (one import, one array
   entry).
3. Map the category in `src/audit/oracle/category-map.ts` to a detector or
   the judge-primary path. The `category-mapping` test fails CI if a new
   injector category resolves to neither, so detection is measurable from
   day one.
4. Run `npm run oracle:build` and `npm run benchmarks:oracle`.

A new cheat detector should land with its injector in the same change, so
its recall is measured against constructive ground truth rather than
asserted.

## How to add a new judge prompt version

1. Add `src/audit/cheat-detector/judge-prompts/<version>.ts` exporting a
   `JudgePromptSet`. Versions are additive and never edited in place, so a
   committed benchmark always replays the wording it was scored against.
2. Register it in `judge-prompts/index.ts`.
3. Run `npm run calibrate:judge`. It scores every version on the held-out
   split and the clean-PR sample and promotes the one with the highest
   recall whose clean-PR false-positive rate stays within one percentage
   point of the most conservative version. Wire the chosen version as
   `DEFAULT_JUDGE_PROMPT_VERSION` and record the rationale in
   `judge-calibration.md`.

## Migrating existing audit configs

The judge-primary path is on by default. A cost-sensitive consumer opts
out in `.swarm/audit-config.yaml`:

```yaml
judgePrimary:
  enabled: false
```

With judge-primary on, each PR costs roughly two extra judge calls (one
per semantic category), about $0.009 per PR at Anthropic Haiku list price
(see `benchmarks/results/AB-REPORT.md`), and adds about 10 percentage
points to the false-positive rate on presumed-clean reals. Leave it off if
you cannot afford either. `swarm doctor` warns when it is enabled with no
inference provider configured.

## Promoting judge-primary from advisory to blocking

Judge-primary findings ship advisory by default: severity `warn`, never
`block`. A semantic finding rests on a single LLM verdict, and the +10pp
false-positive cost above is measured on our presumed-clean corpus, not on
the consumer's repo. Blocking a merge on that without per-repo evidence
trains maintainers to disable the auditor. So the default is advisory, and
promotion to blocking requires the consumer to measure the path on their
own code first.

The bar a consumer should clear before flipping `judgePrimary.block: true`:

- Run the post-upgrade auditor (judge-primary on) across the consumer's own
  last 100 merged PRs, which are presumed clean because they were reviewed
  and merged.
- Count the judge-primary findings raised. The false-positive rate is that
  count over the window (a finding on an already-merged PR is, by
  assumption, a false alarm).
- Compare against the pre-upgrade auditor's false-positive rate on the same
  window. Promote only when the judge-primary false-positive rate is within
  **2 percentage points** of that baseline, on a window of **at least 100
  PRs**.

Record the measurement in
`benchmarks/real-corpus/judge-primary-measurements.json` keyed by category:

```json
{
  "goal-not-fixed": {
    "fpRatePostPp": 3.0,
    "fpRateBaselinePp": 2.0,
    "windowPrCount": 120,
    "source": "acme/widgets last-120-merged, 2026-06"
  }
}
```

`npm run promotions:compute` reads that file and flips the category to
`block: true` only when the delta and window clear the bar; otherwise it
stays advisory and records why. `npm run promotions:check` fails CI if a
category is set to block without a qualifying measurement on file, so the
gate cannot be hand-edited open. Once the policy promotes the category, set
`judgePrimary.block: true` in the consumer's `.swarm/audit-config.yaml` to
make the findings gate:

```yaml
judgePrimary:
  enabled: true
  block: true
```

Until both the measurement and the config flip are in place, judge-primary
stays advisory and a semantic finding never fails a build on its own.
