# Judge prompt calibration

Each committed prompt version scored on a held-out 20% split of the semantic injections (recall) and a seeded sample of presumed-clean real PRs (false-positive rate), against glm47-flash-abl. Regenerate with `npm run calibrate:judge`.

| prompt version | held-out | recall | clean sample | FP rate | mean cost/call | p95 latency |
|---|---|---|---|---|---|---|
| v1-conservative | 10 | 0.500 | 30 | 10.0% | $0.004517 | 13230 ms |
| v2-balanced | 10 | 1.000 | 30 | 30.0% | $0.004643 | 13298 ms |

## Selection

Chosen: **v1-conservative** (wired as the default).

Most conservative clean-PR FP rate is 10.0%; the eligibility ceiling is +1pp (11.0%). Among versions within that ceiling, v1-conservative has the highest held-out recall (0.500) at FP 10.0%.

> The presumed in "presumed-clean" is load-bearing: the FP rate is measured against PRs hand-labeled clean, not provably-clean PRs. Cost is a Haiku list-price estimate from token counts; the run used a local model.

