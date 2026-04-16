# Statistical Summary

> Generated from 9 scored run(s).
> Computed on 2026-04-16 18:45 UTC.

## Metrics (mean ± 95% CI)

| Metric | N | Mean | 95% CI Lower | 95% CI Upper | Std Dev |
|--------|---|------|-------------|-------------|---------|
| premium_requests_actual | 1 | 1.0 | 1.0 | 1.0 | 0.0 |
| premium_requests_estimated | 1 | 8.0 | 8.0 | 8.0 | 0.0 |
| quality_gate_issues | 3 | 10.0 | -26.7648 | 46.7648 | 14.7986 |
| quality_gates_passed | 1 | 1.0 | 1.0 | 1.0 | 0.0 |
| repair_iterations | 6 | 0.0 | 0.0 | 0.0 | 0.0 |
| step_count | 6 | 4.0 | 2.2437 | 5.7563 | 1.6733 |
| verifications_failed | 6 | 0.5 | -0.0749 | 1.0749 | 0.5477 |
| verifications_passed | 6 | 3.3333 | 1.7531 | 4.9136 | 1.5055 |
| wall_clock_seconds | 6 | 873.7983 | -72.2519 | 1819.8486 | 901.3382 |

## Interpretation

- **N** = number of runs contributing data for that metric.
- **95% CI** = confidence interval computed via t-distribution (exact for small N).
- Metrics with N < 10 should be treated as preliminary.
- A wider CI indicates higher variance across runs (non-determinism).

## How to Add More Runs

```bash
# Score a completed run
./benchmarks/harness/scoring/score.sh ./runs/<execution-id>

# Re-compute summary with all available scores
python3 benchmarks/harness/scoring/compute_ci.py ./runs/
```
