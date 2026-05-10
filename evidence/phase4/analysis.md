# Phase 4 analysis

- Original N = 20
- Discarded (environmental) = 0
- Analyzable paired N = 20
- Family-wise alpha = 0.05
- Per-comparison alpha (Bonferroni) = 0.0125
- Comparisons = 4

> **STATUS 2026-05-09 (audit-and-corrections):** This analysis is
> retained for the obligation-set-mismatch record, but its
> "diversity-thesis CONFIRMED" conclusion is **invalidated** by the
> obligation-set mismatch flagged in DECISIONS.md `### 2026-05-09 —
> Audit and corrections` (C1). The replacement run lives at
> `evidence/phase4-redo/analysis.md` against an N=20
> `property-must-hold` obligation set disjoint from Phases 1–3.
> The cost columns below are restated on a billed-basis /
> API-equivalent-basis split for completeness; the underlying numbers
> are unchanged.

## Headline metrics

| Metric | Config B' | Config B'' | Notes |
|---|---|---|---|
| Pass count | 0/20 (0.000, 95% CI [0.000, 0.161]) | 0/20 (0.000, 95% CI [0.000, 0.161]) | Pass = no adapter reported a counter-example |
| Total billed | $0.0000 | $1.0121 | Real-charge USD (`dollarsBilled`); Copilot subscription = $0; ClaudeCode billed because `ANTHROPIC_API_KEY` was set in the run env |
| Total token-estimate | $0.4680 | $1.5321 | `dollarsTokenEstimate`; Copilot subscription-imputed at $0.026/Premium-request, ClaudeCode at API rate card |
| Total API-equivalent | $1.0000 | $2.0121 | `dollarsApiEquivalent`; Copilot at $0.05/Premium-request (GPT-4-Turbo-equivalent), ClaudeCode at API rate card; audit-and-corrections 2026-05-09 |
| Total wall-clock (s) | 371.26 | 461.08 | |
| Total LLM calls | 20 | 40 | |

## ClaudeCode marginal yield per dollar — both bases (audit-and-corrections, 2026-05-09)

- ClaudeCode unique yield (B'' falsified, B' did not): **0** (machine-claimed; the obligation-set mismatch makes the underlying number uninterpretable for the cross-family question — see status banner).

**Billed basis:**

- Additional `dollarsBilled` spend (Σ B'' − Σ B'): **$1.0121**.
- ClaudeCode billed-basis yield/$: **0.00**.

**API-equivalent basis (like-for-like):**

- Additional `dollarsApiEquivalent` spend: **$1.0121** (Σ B'' − Σ B' = 2.0121 − 1.0000).
- ClaudeCode API-equivalent yield/$: **0.00**.

**Subscription-imputed-token-estimate basis (preserved for back-compat with the original headline):**

- Additional `dollarsTokenEstimate` spend: **$1.0641**.
- ClaudeCode `dollarsTokenEstimate` yield/$: **0.00**.

The numerator is zero on every basis, so the basis distinction is
not load-bearing for *this* phase's headline — but it is the same
reframing applied uniformly across phases per the audit. The
cross-family-diversity verdict is decided in
`evidence/phase4-redo/analysis.md` against a `property-must-hold`
obligation set, not here.

**Cross-family diversity thesis: ~~CONFIRMED~~ INVALIDATED by obligation set mismatch.**

The original conclusion "same-family adapter is redundant" is **not**
supported by this run because the obligation set targeted Copilot's
specialties (`import-graph-must-satisfy`,
`function-must-have-signature`), not ClaudeCode's strategy
(`property-must-hold` adversarial test inputs). ClaudeCode showing
zero unique yield on a set its strategy does not target tells us
nothing about whether ClaudeCode finds things Codex+Copilot miss on
the obligation surface ClaudeCode was designed to attack. The
re-test lives at `evidence/phase4-redo/`.

**Phase 5 gate: SKIP — but for operational reasons, not the
diversity verdict.** See the Phase 5 skip-rationale entry in
DECISIONS.md (2026-05-09); the skip stands on "2-arm bandit is low
operational leverage", independent of the cross-family-diversity
question.

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
