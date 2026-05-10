# Phase 4 redo analysis (audit-and-corrections, 2026-05-09)

Replaces the original Phase 4 analysis at `evidence/phase4/analysis.md` (now status-banner INVALIDATED). The original Phase 4 reused Phase 3's `import-graph` + `function-signature` obligations, which targeted Copilot's specialties — uninterpretable for ClaudeCode's adversarial-test-input strategy. The redo's obligation set is 20 `property-must-hold` obligations disjoint from Phases 1, 2, and 3 (`evidence/phase4-redo/obligations.json`).

- Original N = 20
- Discarded (environmental) = 1
- Analyzable paired N = 19
- Family-wise alpha = 0.05
- Per-comparison alpha (Bonferroni) = 0.0125
- Comparisons = 4

### Discarded obligations (environmental, excluded from paired analysis)

- `C2`: B'': claude-code: claude exec exceeded the 300000ms time budget; the call was killed. Increase FalsificationInput.timeBudgetMs if the obligation 

## Headline metrics

| Metric | Config B' | Config B'' | Notes |
|---|---|---|---|
| Pass count | 1/19 (0.053, 95% CI [0.009, 0.246]) | 1/19 (0.053, 95% CI [0.009, 0.246]) | Pass = no adapter reported a counter-example |
| Total billed | $2.3776 | $4.1190 | Real-charge USD (`dollarsBilled`); Codex API-billed; ClaudeCode subscription = $0 unless ANTHROPIC_API_KEY set |
| Total token-estimate | $2.3776 | $4.1190 | `dollarsTokenEstimate`; for ClaudeCode this equals API rate card |
| Total API-equivalent | $2.3776 | $4.1190 | Like-for-like API-rate-card USD (`dollarsApiEquivalent`); audit-and-corrections 2026-05-09 |
| Total wall-clock (s) | 245.76 | 443.34 | |
| Total LLM calls | 19 | 38 | |

## ClaudeCode marginal yield per dollar — both bases

- ClaudeCode unique yield (B'' falsified, B' did not): **0** (machine-claimed; operator inspection skeleton at `evidence/phase4-redo/run/config-b-prime-prime/inspection.md`).

**Billed basis:**
- Additional `dollarsBilled` spend: **$1.7414**
- ClaudeCode billed-basis yield/$: **0.00**

**API-equivalent basis (the like-for-like surface):**
- Additional `dollarsApiEquivalent` spend: **$1.7414**
- ClaudeCode API-equivalent yield/$: **0.00**

**Token-estimate basis (back-compat with original Phase 4 headline shape):**
- Additional `dollarsTokenEstimate` spend: **$1.7414**
- ClaudeCode token-estimate yield/$: **0.00**

**Cross-family diversity thesis: CONFIRMED (machine-claimed; operator-confirmed pending).** ClaudeCode (same family as the producer) added zero unique yield over Codex on the property-must-hold obligation surface ClaudeCode's strategy actually targets. This is the like-for-like cross-family test the original Phase 4 attempted but could not run because the obligation type was wrong (see `evidence/phase4/analysis.md` status banner). On the redo's correctly-typed surface the thesis holds: the cross-family Codex contribution covers what the same-family ClaudeCode also catches; the same-family adapter is redundant for the property-must-hold mix.

**Phase 5 gate (per the operator brief): SKIP.**
ClaudeCode marginal yield is zero on the property-must-hold obligation surface. The operator brief's tightened gate ("if ClaudeCode yield is zero or negative, skip Phase 5") fires; Phase 5 stays skipped on operational grounds. The audit-and-corrections DECISIONS.md entry records the third-adapter-revisit condition that would re-open the decision.

## Hypothesis tests

### 1. Pass rate (paired binary)
- Method: trivial (no discordant pairs)
- Discordant pairs: B''-only=0, B'-only=0 (N=19)
- Diff (B'' - B') point = 0.0000, 95% CI [-0.1682, 0.1682]
- Uncorrected p = 1.000000
- Bonferroni-corrected p = 1.000000
- Significant at family-wise alpha=0.05? NO

### 2. Token-estimate cost (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = $0.058390
- 95% bootstrap CI for median diff: [$0.051132, $0.169007]
- W = 12.0000, n_nonzero = 19, n_zero = 0
- Uncorrected p = 0.000267
- Bonferroni-corrected p = 0.001068
- Significant at family-wise alpha=0.05? YES

### 3. Wall-clock (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = 9409 ms
- 95% bootstrap CI for median diff: [7989 ms, 11181 ms]
- W = 0.0000, n_nonzero = 19, n_zero = 0
- Uncorrected p = 0.000004
- Bonferroni-corrected p = 0.000015
- Significant at family-wise alpha=0.05? YES

### 4. LLM call count (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B'' - B') = 1.00 calls
- 95% bootstrap CI for median diff: [1.00, 1.00]
- W = 0.0000, n_nonzero = 19, n_zero = 0
- Uncorrected p = 0.000004
- Bonferroni-corrected p = 0.000015
- Significant at family-wise alpha=0.05? YES

## Per-stratum breakdown

- Stratum A (n=8): B' pass = 0/8, B'' pass = 0/8
- Stratum B (n=7): B' pass = 1/7, B'' pass = 1/7
- Stratum C (n=4): B' pass = 0/4, B'' pass = 0/4
