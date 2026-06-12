# Judge prompt calibration

Each committed prompt version scored on a held-out 20% split of the semantic injections (recall) and a seeded sample of presumed-clean real PRs (false-positive rate), against qwen3.6:35b-a3b. Regenerate with `npm run calibrate:judge`.

| prompt version | held-out | recall | clean sample | FP rate | mean cost/call | p95 latency |
|---|---|---|---|---|---|---|
| v1-conservative | 10 | 0.800 | 30 | 0.0% | $0.004524 | 19647 ms |
| v2-balanced | 10 | 1.000 | 30 | 16.7% | $0.004480 | 20967 ms |

## Selection

Chosen: **v1-conservative** (wired as the default).

Most conservative clean-PR FP rate is 0.0%; the eligibility ceiling is +1pp (1.0%). Among versions within that ceiling, v1-conservative has the highest held-out recall (0.800) at FP 0.0%.

> The presumed in "presumed-clean" is load-bearing: the FP rate is measured against PRs hand-labeled clean, not provably-clean PRs. Cost is a Haiku list-price estimate from token counts; the run used a local model.

