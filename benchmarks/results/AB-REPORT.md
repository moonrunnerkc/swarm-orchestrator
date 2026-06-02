# A/B: pre-upgrade vs post-upgrade auditor

> For the real-world benefit question (does this auditor catch a class of
> review failure that off-the-shelf analyzers miss, at a meaningful
> scale), see `benchmarks/real-prs/v11-BENEFIT-REPORT.md`: recall on a
> retrospectively-bad PR corpus, the clean-PR false-positive rate at
> scale, and the differential against Semgrep and ESLint. This A/B is the
> synthetic-oracle measurement; the benefit report is the real-PR one.
>
> For the execution-grounded layer (mutation testing, issue-linked repro,
> coverage delta run against a sandboxed checkout, the v11.1 work that adds
> a signal the diff-reading layers cannot produce), see
> `benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`.


**Definition of benefit.** The post-upgrade auditor catches **20.5% more
injected cheats** (253/300 vs 210/300, +43 defects, +14.3 percentage
points) across **12 categories**, with the false-positive rate on
presumed-clean real PRs changing by **about +10 percentage points** from
the new judge-primary path (opt-out: `judgePrimary.enabled: false`). The
gain is concentrated where the pre-upgrade auditor was structurally blind:
the two semantic categories go from 0/50 to 20/50, and a test-relaxation
class the regex layer walked past goes from 1/25 to 24/25.

Pre numbers: `benchmarks/baselines/pre-upgrade/oracle-results.json` (derivation
documented there). Post numbers: `benchmarks/results/post-upgrade/oracle-results.json`.
Regenerate everything with `npm run benchmarks:full`.

## Injected-cheat recall by category

| category | pre | post | delta | source of the change |
|---|---|---|---|---|
| test-relaxation | 0.04 | 0.96 | +0.92 | detector reshape (threshold matchers) |
| assertion-strip | 0.56 | 0.56 | 0 | unchanged |
| mock-of-hallucination | 1.00 | 1.00 | 0 | unchanged |
| no-op-fix | 1.00 | 1.00 | 0 | unchanged |
| coverage-erosion | 1.00 | 1.00 | 0 | unchanged |
| fake-refactor | 0.80 | 0.80 | 0 | unchanged |
| comment-only-fix | 1.00 | 1.00 | 0 | unchanged |
| error-swallow | 1.00 | 1.00 | 0 | unchanged |
| exception-rethrow-lost-context | 1.00 | 1.00 | 0 | unchanged |
| dead-branch-insertion | 1.00 | 1.00 | 0 | unchanged |
| **goal-not-fixed** (semantic) | 0.00 | 0.64 | +0.64 | new judge-primary path |
| **cheat-mock-mutation** (semantic) | 0.00 | 0.16 | +0.16 | new judge-primary path |

Totals: structural 210/250 → 233/250; semantic 0/50 → 20/50; overall
210/300 → 253/300.

## False-positive rate on presumed-clean reals

| path | pre FP | post FP | delta |
|---|---|---|---|
| deterministic detectors (block) | unchanged | unchanged | 0 (only test-relaxation changed, and it fires only on a strict→loose pair) |
| judge-primary (semantic) | n/a (did not exist) | ~10% of clean PRs | +~10pp |

The judge-primary false-positive rate is the v1-conservative figure from
`benchmarks/oracle-corpus/judge-calibration.md` (the v2-balanced prompt
reached recall 1.0 on the held-out split but drove FP to 30%, outside the
1-point tolerance, so it was not promoted). Cost-sensitive consumers set
`judgePrimary.enabled: false` to drop this delta to zero. The figure is
from the local model; a stronger judge (Anthropic Haiku) may differ.

## Real-world validation on unbiased PRs

Full report: `benchmarks/real-prs/REAL-WORLD-REPORT.md` (regenerate with
`npm run real-prs:full`). An 18-PR pilot across vite, next.js, astro, nx,
and trpc, with an independent Anthropic Opus arbiter (sanity-gate
agreement 85% on held-out oracle defects) classifying every finding.

The synthetic measurement above put the post-upgrade false-positive cost
on the judge-primary path. The real-PR pilot contradicted that: the
structural detectors, not judge-primary, drove the noise. The first pilot
run raised 61 findings across 18 presumed-clean PRs (judge-primary raised
0; the claims were delivered), of which the arbiter labeled 57 false
alarms, mostly coverage-erosion firing on any added branch, no-op-fix
firing on delivered fixes (an inverted judge polarity), error-swallow
flagging pre-existing catches, and test-relaxation flagging relocated
tests.

Those were detector precision bugs, fixed at the root with no loss of
oracle recall (structural recall byte-identical). Re-running the same
corpus after the fixes:

| metric | pre-upgrade | post-upgrade (first run) | post-upgrade (after fixes) |
|---|---|---|---|
| findings on 18 clean PRs | 3 | 61 | 5 |
| arbiter false-alarm | 3 | 57 | 2 |
| false-alarm burden / PR | 0.17 | 3.17 | 0.11 |

After the fixes the post-upgrade false-alarm burden (0.11/PR) is at or
below the pre-upgrade auditor's (0.17/PR): the v11 changes no longer make
the auditor noisier on real PRs, while the oracle recall gain stands. This
is a pilot (18 PRs); the harness scales to the default 100-PR run.

## Cost and latency (judge-primary)

| metric | value | source |
|---|---|---|
| mean cost / judge call (Haiku list-price estimate) | ~$0.0045 | judge-calibration.md |
| per-PR cost delta with judge-primary on | ~$0.009 (2 semantic calls) | judge-calibration.md |
| p95 judge latency (local model) | ~13 s small diff, up to ~40 s on a 48k-token diff | judge-calibration.md / pre-upgrade baseline |

## Infrastructure for a future judge upgrade (no current recall lift)

Tail-defect recovery and per-hunk localization are chunking infrastructure,
not shipped recall wins. The deterministic mechanism tests
(`diff-chunker.test.ts`, `tail-defect.test.ts`) prove the plumbing; the
recall numbers are held down by the judge, not the splitter.

- **Tail-defect recovery** (`tail-defect-recovery.md`): head-truncation 0/10,
  hunk-aware chunking 1/10 with the shipped conservative confirm prompt.
  Chunking is what lets the tail defect reach the judge at all; the absolute
  is the judge declining isolated catches. A localized confirm prompt lifts
  this to 5/10 in measurement (v2 section), but is not shipped pending
  real-PR false-positive validation and a cache key that folds the prompt.
- **Per-hunk localization** (`per-hunk-localization.md`): per-hunk judging
  attributes a verdict to a stable (file, hunk-index) id; whole-diff judging
  localizes 0 by construction. The local confirm judge flags benign hunks
  and misses the planted one regardless of prompt (the localized prompt did
  not move it), so there is no localization accuracy to claim yet; the
  splitter is pinned in the chunker test. A stronger judge is the only path
  to a real number here.

## Robustness deltas

- **Evasion survival** (`evasion-report.md`): every detector is robust to the
  cosmetic evader stack (rename, whitespace, reorder, noise file) — flat
  survival curves at their base recall.

## Honesty caveats

Injected recall proves detection of the defect classes injected; it does
not prove detection of unobserved classes. The false-positive rate is
measured against PRs hand-labeled clean; the "presumed" is load-bearing.
The whole-PR detectors (comment-only-fix, coverage-erosion, no-op-fix)
show no pre/post delta: their apparent zero-signal in the first oracle
pass was a measurement artifact (block-only counting and unfair injection
shapes), fixed in the oracle harness, not a detector change. Claiming them
as a benefit would be double-counting; they are listed at parity.

---

Footer. `npm run benchmarks:full` regenerates the oracle corpus, the
per-detector recall, the judge-primary numbers, the tail-defect and
per-hunk measurements, and the evasion curves. Wall-clock is dominated by
local judge calls over real-PR-sized diffs: budget roughly 30-60 minutes
on first run (cold cache) and under 5 minutes on replay (committed cache
hits). Marginal API cost is $0 against the local model; the dollar figures
above are Haiku list-price estimates from recorded token counts.
