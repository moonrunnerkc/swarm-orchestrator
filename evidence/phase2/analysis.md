# Phase 2 analysis

- Original N = 30
- Discarded (environmental) = 2
- Analyzable paired N = 28
- Family-wise alpha = 0.05
- Per-comparison alpha (Bonferroni) = 0.0125
- Comparisons = 4 (pass-rate, billed cost, wall-clock, LLM calls)

### Discarded obligations (environmental, excluded from paired analysis)

- `C1`: B: codex exec failed with exit code 1. stderr: Reading additional input from stdin... OpenAI Codex v0.130.0 -------- workdir: /private/var/fold
- `C6`: B: codex exec exceeded the 300000ms time budget; the call was killed. Increase FalsificationInput.timeBudgetMs if the obligation legitimately n

## Headline metrics

| Metric | Config A | Config B | Notes |
|---|---|---|---|
| Pass count | 28/28 (1.000, 95% CI [0.879, 1.000]) | 2/28 (0.071, 95% CI [0.020, 0.226]) | Pass = system returns no falsification |
| Total billed | $0.0000 | $4.3994 | Real-charge USD (`dollarsBilled`) |
| Total token-estimate | $0.0000 | $4.3994 | Subscription-imputed-or-API-rate-card USD (`dollarsTokenEstimate`) |
| Total API-equivalent | $0.0000 | $4.3994 | Like-for-like API-rate-card USD (`dollarsApiEquivalent`); audit-and-corrections 2026-05-09 |
| Total wall-clock (s) | 0.11 | 390.16 | |
| Total LLM calls | 0 | 28 | |

### Cost-basis note (audit-and-corrections, 2026-05-09)

For Codex (Phase 2), `dollarsBilled` and `dollarsApiEquivalent` are
identical because Codex meters every call at API token rates regardless
of auth tier. Both surfaces report the same `$4.3994` total. The
billed-basis vs API-equivalent-basis distinction is therefore a no-op
for Phase 2 on its own; the distinction is load-bearing only when
comparing across phases that mixed Codex and Copilot (Phase 2 vs Phase
3). See `evidence/phase3/analysis.md` for the cross-phase comparison.

**Phase 2 yield-per-dollar (locked baseline for Phase 3 / Phase 4 redo):**

- Confirmed yields: 26 (machine-claimed; not operator-audited).
- `dollarsBilled` total: `$4.3994` → **billed-basis yield/$ = 5.91**.
- `dollarsApiEquivalent` total: `$4.3994` → **API-equivalent yield/$ = 5.91**.

Both bases coincide for Phase 2. The Phase 3 close-out's "6.5×"
headline is the value at risk under the audit; this entry pins the
Phase 2 denominators that the Phase 3 ratio re-computation uses.

## Hypothesis tests

### 1. Pass rate (paired binary)
- Method: exact binomial (b+c < 25 or one-sided degeneracy)
- Discordant pairs: B-only=0, A-only=26 (N=28)
- Diff (B - A) point = -0.9286, 95% CI [-0.9802, -0.7321]
- Uncorrected p = 0.000000
- Bonferroni-corrected p = 0.000000
- Significant at family-wise alpha=0.05? YES

### 2. Billed cost (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B - A) = $0.150655
- 95% bootstrap CI for median diff: [$0.150045, $0.151325]
- W = 0.0000, n_nonzero = 28, n_zero = 0
- Uncorrected p = 0.000000
- Bonferroni-corrected p = 0.000000
- Significant at family-wise alpha=0.05? YES

### 3. Wall-clock (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B - A) = 12125 ms
- 95% bootstrap CI for median diff: [11542 ms, 13600 ms]
- W = 0.0000, n_nonzero = 28, n_zero = 0
- Uncorrected p = 0.000000
- Bonferroni-corrected p = 0.000000
- Significant at family-wise alpha=0.05? YES

### 4. LLM call count (paired continuous)
- Method: paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')
- Median (B - A) = 1.00 calls
- 95% bootstrap CI for median diff: [1.00, 1.00]
- W = 0.0000, n_nonzero = 28, n_zero = 0
- Uncorrected p = 0.000000
- Bonferroni-corrected p = 0.000000
- Significant at family-wise alpha=0.05? YES

## Per-stratum breakdown

- Stratum A (n=12): A pass = 12/12, B pass = 0/12
- Stratum B (n=11): A pass = 11/11, B pass = 1/11
- Stratum C (n=5): A pass = 5/5, B pass = 1/5
