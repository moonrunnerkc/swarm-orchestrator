# Statistical Summary

> Generated from 10 scored run(s).
> Computed on 2026-04-16 23:51 UTC.

## Metrics (mean ± 95% CI)

| Metric | N | Mean | 95% CI Lower | 95% CI Upper | Std Dev |
|--------|---|------|-------------|-------------|---------|
| premium_requests_actual | 9 | 3.8889 | 2.5887 | 5.1891 | 1.6915 |
| premium_requests_estimated | 9 | 7.3333 | 6.3165 | 8.3502 | 1.3229 |
| quality_gate_issues | 10 | 0.2 | -0.2524 | 0.6524 | 0.6325 |
| quality_gates_passed | 9 | 1.0 | 1.0 | 1.0 | 0.0 |
| repair_iterations | 9 | 0.0 | 0.0 | 0.0 | 0.0 |
| step_count | 9 | 4.5556 | 3.3955 | 5.7157 | 1.5092 |
| verifications_failed | 9 | 0.3333 | -0.051 | 0.7177 | 0.5 |
| verifications_passed | 9 | 3.8889 | 2.5887 | 5.1891 | 1.6915 |
| wall_clock_seconds | 9 | 1216.8278 | 737.1978 | 1696.4577 | 623.9765 |

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
