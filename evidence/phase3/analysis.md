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
| Total billed | $0.0000 | $0.0000 | Real-charge USD (`dollarsBilled`); Copilot is subscription-imputed zero |
| Total token-estimate | $0.0000 | $0.5200 | Subscription-imputed USD (`dollarsTokenEstimate` = Premium requests × $0.026/Pro+) |
| Total API-equivalent | $0.0000 | $1.0000 | Like-for-like API-rate-card USD (`dollarsApiEquivalent` = Premium requests × $0.05/GPT-4-Turbo-equivalent); audit-and-corrections 2026-05-09 |
| Total wall-clock (s) | 0.01 | 339.15 | |
| Total LLM calls | 0 | 20 | |

## Marginal yield per dollar (Phase 3 decision metric — both bases)

The audit-and-corrections fix (DECISIONS.md 2026-05-09) re-states the
Phase 3 ratio on two bases. The original headline used
`dollarsTokenEstimate` for both numerator-side adapters; for Copilot
that field is *subscription-imputed* at $0.026/Premium-request, not
derived from a per-token API rate card, while Codex's
`dollarsTokenEstimate` is API-billed. The like-for-like comparison
surface is `dollarsApiEquivalent`.

- Copilot unique yield (B' falsified, B did not): **20** (machine-claimed; awaiting operator inspection at `evidence/phase3/run/config-b-prime/inspection.md`).

**Billed basis** (preserved for back-compat with the original headline):

- Additional `dollarsBilled` spend (Σ B' − Σ B): **$0.0000** — Copilot
  subscription is flat-rate, so the billed surface is degenerate (the
  ratio is undefined / infinite).
- Codex Phase 2 baseline `dollarsBilled` yield/$ (locked,
  `evidence/phase2/analysis.md`): **5.91** (26 yields ÷ $4.3994 billed).
- **Billed-basis comparison is undefined** — Copilot's denominator is
  zero. The original Phase 3 headline used `dollarsTokenEstimate` to
  sidestep this, but `dollarsTokenEstimate` is heterogeneous (see
  next section).

**API-equivalent basis** (the like-for-like surface):

- Additional `dollarsApiEquivalent` spend: **$1.0000** (20 × $0.05 / Premium request, GPT-4-Turbo-equivalent).
- Codex Phase 2 baseline `dollarsApiEquivalent` yield/$ (locked): **5.91** (26 yields ÷ $4.3994).
- **Copilot API-equivalent yield/$: 20.00.**
- **API-equivalent-basis ratio (Copilot / Codex): 20.00 / 5.91 ≈ 3.4×.**

**Subscription-imputed-token-estimate basis** (the original headline,
preserved for back-compat with the Phase 3 close-out):

- Additional `dollarsTokenEstimate` spend: **$0.5200**.
- Copilot `dollarsTokenEstimate` yield/$: **38.46**.
- Subscription-imputed-basis ratio (Copilot / Codex): **38.46 / 5.91 ≈ 6.5×.**

**Note: subscription pricing flatters the billed-basis ratio.** The
original 6.5× headline used a denominator that mixes Codex's
true-API-rate spend with Copilot's $0.026/Premium-request
subscription-imputed spend. On the like-for-like API-equivalent
surface the ratio falls to ~3.4×; on the billed-basis surface it is
undefined because Copilot's denominator is zero. The "Copilot earns
its slot" decision survives on the API-equivalent basis (3.4× ≫ 1×)
but the headline magnitude is overstated by roughly 1.9×.

**Operator-inspection caveat.** The yield count `20` above is
machine-claimed. Phase 3 had no operator hand inspection; Phases 1
and 2 each surfaced ~33 % predicate-gaming-or-mechanical-FP after
hand inspection. The corrected close-out lands in DECISIONS.md
*after* `evidence/phase3/run/config-b-prime/inspection.md` is
operator-completed, with confirmed-only yield substituted for the
machine-claimed numerator.

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
