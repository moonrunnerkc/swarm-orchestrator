# Phase 3 analysis

- Original N = 20
- Discarded (environmental) = 0
- Analyzable paired N = 20
- Family-wise alpha = 0.05
- Per-comparison alpha (Bonferroni) = 0.0125
- Comparisons = 4 (pass-rate, billed cost, wall-clock, LLM calls)

## Headline metrics

| Metric | Config B | Config B' | Notes |
|---|---|---|---|
| Pass count | 20/20 (1.000, 95% CI [0.839, 1.000]) | 0/20 (0.000, 95% CI [0.000, 0.161]) | Pass = system returns no falsification |
| Total billed | $0.0000 | $0.0000 | Real-charge USD |
| Total token-estimate | $0.0000 | $0.5200 | API/per-request rate-card USD |
| Total wall-clock (s) | 0.01 | 339.15 | |
| Total LLM calls | 0 | 20 | |

## Marginal yield per dollar (Phase 3 decision metric)

- Copilot unique yield (B' falsified, B did not): **20**
- Additional spend (B' tokenEstimate − B tokenEstimate): **$0.5200**
- Copilot yield/$: **38.46**
- Codex Phase 2 baseline yield/$ (locked): **5.91** (26 yields ÷ $4.3994)
- **Decision: SHIP-BP** — Copilot marginal yield/$ (38.46) >= Codex Phase 2 baseline (5.91); P3.5.a applies.

## Hypothesis tests

### 1. Pass rate (paired binary)
- Method: exact binomial (b+c < 25 or one-sided degeneracy)
- Discordant pairs: B'-only=0, B-only=20 (N=20)
- Diff (B' - B) point = -1.0000, 95% CI [-1.0000, -0.7721]
- Uncorrected p = 0.000002
- Bonferroni-corrected p = 0.000008
- Significant at family-wise alpha=0.05? YES

### 2. Billed cost (paired continuous)
- Method: trivial (all paired differences are zero)
- Median (B' - B) = $0.000000
- 95% bootstrap CI for median diff: [$0.000000, $0.000000]
- W = nan, n_nonzero = 0, n_zero = 20
- Uncorrected p = 1.000000
- Bonferroni-corrected p = 1.000000
- Significant at family-wise alpha=0.05? NO

### 3. Wall-clock (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B' - B) = 14054 ms
- 95% bootstrap CI for median diff: [12344 ms, 16160 ms]
- W = 0.0000, n_nonzero = 20, n_zero = 0
- Uncorrected p = 0.000002
- Bonferroni-corrected p = 0.000008
- Significant at family-wise alpha=0.05? YES

### 4. LLM call count (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B' - B) = 1.00 calls
- 95% bootstrap CI for median diff: [1.00, 1.00]
- W = 0.0000, n_nonzero = 20, n_zero = 0
- Uncorrected p = 0.000002
- Bonferroni-corrected p = 0.000008
- Significant at family-wise alpha=0.05? YES

## Per-stratum breakdown

- Stratum I (n=10): B pass = 10/10, B' pass = 0/10
- Stratum F (n=10): B pass = 10/10, B' pass = 0/10
