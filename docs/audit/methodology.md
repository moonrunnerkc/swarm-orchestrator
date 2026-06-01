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
