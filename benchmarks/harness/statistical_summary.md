# Statistical Summary

> Generated from 10 scored run(s).
> Computed on 2026-04-17 16:46 UTC.

## Metrics (mean ± 95% CI)

| Metric | N | Mean | 95% CI Lower | 95% CI Upper | Std Dev |
|--------|---|------|-------------|-------------|---------|
| premium_requests_actual | 9 | 1.7778 | 0.3003 | 3.2552 | 1.9221 |
| premium_requests_estimated | 9 | 7.6667 | 6.898 | 8.4353 | 1.0 |
| quality_gate_issues | 10 | 0.1 | -0.1262 | 0.3262 | 0.3162 |
| quality_gates_passed | 9 | 1.0 | 1.0 | 1.0 | 0.0 |
| repair_iterations | 9 | 0.0 | 0.0 | 0.0 | 0.0 |
| step_count | 9 | 3.0 | 1.6143 | 4.3857 | 1.8028 |
| verifications_failed | 9 | 0.8889 | 0.427 | 1.3508 | 0.6009 |
| verifications_passed | 9 | 1.7778 | 0.3003 | 3.2552 | 1.9221 |
| wall_clock_seconds | 9 | 889.7178 | 388.468 | 1390.9676 | 652.103 |

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
