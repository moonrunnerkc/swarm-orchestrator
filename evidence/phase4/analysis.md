# Phase 4 analysis

- Original N = 20
- Discarded (environmental) = 0
- Analyzable paired N = 20
- Family-wise alpha = 0.05
- Per-comparison alpha (Bonferroni) = 0.0125
- Comparisons = 4

## Headline metrics

| Metric | Config B' | Config B'' | Notes |
|---|---|---|---|
| Pass count | 0/20 (0.000, 95% CI [0.000, 0.161]) | 0/20 (0.000, 95% CI [0.000, 0.161]) | Pass = no adapter reported a counter-example |
| Total billed | $0.0000 | $1.0121 | Subscription = $0 by construction |
| Total token-estimate | $0.4680 | $1.5321 | API rate-card USD |
| Total wall-clock (s) | 371.26 | 461.08 | |
| Total LLM calls | 20 | 40 | |

## ClaudeCode marginal yield per dollar (Phase 4 diversity-thesis signal)

- ClaudeCode unique yield (B'' falsified, B' did not): **0**
- Additional spend (Σ B'' tokenEstimate − Σ B' tokenEstimate): **$1.0641**
- ClaudeCode yield/$: **0.00**

**Cross-family diversity thesis: CONFIRMED.** ClaudeCode (same family as the producer) added zero unique yield over the cross-family Codex+Copilot pair. The cross-family diversity is doing the work the architecture's premise expects — a same-family adapter is redundant.

**Phase 5 gate: SKIP.**
ClaudeCode marginal yield is zero; per the agent brief and the plan's Phase 5 gate, two adapters running fire-all is the production configuration. Phase 5 (bandit dispatcher) is not built in this session.

## Hypothesis tests

### 1. Pass rate (paired binary)
- Method: trivial (no discordant pairs)
- Discordant pairs: B''-only=0, B'-only=0 (N=20)
- Diff (B'' - B') point = 0.0000, 95% CI [-0.1611, 0.1611]
- Uncorrected p = 1.000000
- Bonferroni-corrected p = 1.000000
- Significant at family-wise alpha=0.05? NO

### 2. Token-estimate cost (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = $0.049277
- 95% bootstrap CI for median diff: [$0.048639, $0.054111]
- W = 0.0000, n_nonzero = 20, n_zero = 0
- Uncorrected p = 0.000002
- Bonferroni-corrected p = 0.000008
- Significant at family-wise alpha=0.05? YES

### 3. Wall-clock (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = 5612 ms
- 95% bootstrap CI for median diff: [4691 ms, 6800 ms]
- W = 22.0000, n_nonzero = 20, n_zero = 0
- Uncorrected p = 0.001017
- Bonferroni-corrected p = 0.004066
- Significant at family-wise alpha=0.05? YES

### 4. LLM call count (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = 1.00 calls
- 95% bootstrap CI for median diff: [1.00, 1.00]
- W = 0.0000, n_nonzero = 20, n_zero = 0
- Uncorrected p = 0.000002
- Bonferroni-corrected p = 0.000008
- Significant at family-wise alpha=0.05? YES

## Per-stratum breakdown

- Stratum I (n=10): B' pass = 0/10, B'' pass = 0/10
- Stratum F (n=10): B' pass = 0/10, B'' pass = 0/10
