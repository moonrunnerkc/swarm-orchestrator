# A/B: pre-upgrade vs post-upgrade auditor

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

## Cost and latency (judge-primary)

| metric | value | source |
|---|---|---|
| mean cost / judge call (Haiku list-price estimate) | ~$0.0045 | judge-calibration.md |
| per-PR cost delta with judge-primary on | ~$0.009 (2 semantic calls) | judge-calibration.md |
| p95 judge latency (local model) | ~13 s small diff, up to ~40 s on a 48k-token diff | judge-calibration.md / pre-upgrade baseline |

## Robustness deltas

- **Tail-defect recovery** (`tail-defect-recovery.md`): head-truncation 0/10,
  hunk-aware chunking 1/10. Head-truncation never shows the tail defect to
  the judge; chunking does. The absolute is capped by the conservative
  confirm prompt; the mechanism is pinned in the tail-defect test.
- **Per-hunk localization** (`per-hunk-localization.md`): whole-diff judging
  localizes 0 by construction (one verdict, no hunk id); per-hunk judging
  attributes a verdict to a stable (file, hunk-index) id. The local confirm
  judge is too noisy to score the synthetic fixture cleanly; the splitter is
  pinned in the chunker test.
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
