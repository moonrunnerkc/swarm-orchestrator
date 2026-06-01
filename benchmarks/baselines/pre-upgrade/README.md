# Pre-upgrade baseline

Frozen detector and judge behavior captured before the defect-injection oracle work. Every recall / false-positive delta in the A/B report is computed against `metrics.json` in this directory.

Regenerate: `npm run benchmarks:baseline`. The deterministic detector
numbers are byte-identical across runs; the judge numbers replay from
`benchmarks/judge-cache/cache.json`. Only the header timestamp changes.

## Judge

- model: `glm47-flash-abl` (local)
- confirmation calls: 43
- confirm rate (judge says the flagged block is real): 0.093
- mean cost / call (Haiku list price estimate): $0.010994
- p95 latency: 42390 ms

## synthetic corpus (520 cases)

| detector | tp | fp | fn | precision | recall | judge confirm |
|---|---|---|---|---|---|---|
| test-relaxation | 70 | 0 | 0 | 1.000 | 1.000 | n/a |
| mock-of-hallucination | 50 | 0 | 0 | 1.000 | 1.000 | n/a |
| assertion-strip | 50 | 0 | 0 | 1.000 | 1.000 | n/a |
| no-op-fix | 0 | 0 | 50 | 0.000 | 0.000 | n/a |
| coverage-erosion | 0 | 0 | 50 | 0.000 | 0.000 | n/a |
| fake-refactor | 50 | 0 | 0 | 1.000 | 1.000 | n/a |
| comment-only-fix | 0 | 0 | 50 | 0.000 | 0.000 | n/a |
| error-swallow | 50 | 0 | 0 | 1.000 | 1.000 | n/a |
| exception-rethrow-lost-context | 50 | 0 | 0 | 1.000 | 1.000 | n/a |
| dead-branch-insertion | 50 | 0 | 0 | 1.000 | 1.000 | n/a |

## real corpus (205 cases)

| detector | tp | fp | fn | precision | recall | judge confirm |
|---|---|---|---|---|---|---|
| test-relaxation | 0 | 4 | 0 | 0.000 | 0.000 | 0.000 |
| mock-of-hallucination | 0 | 3 | 2 | 0.000 | 0.000 | 0.000 |
| assertion-strip | 0 | 5 | 0 | 0.000 | 0.000 | 0.000 |
| no-op-fix | 0 | 9 | 5 | 0.000 | 0.000 | 0.222 |
| coverage-erosion | 0 | 4 | 0 | 0.000 | 0.000 | 0.000 |
| fake-refactor | 0 | 2 | 0 | 0.000 | 0.000 | 0.000 |
| comment-only-fix | 0 | 0 | 5 | 0.000 | 0.000 | n/a |
| error-swallow | 3 | 13 | 0 | 0.188 | 1.000 | 0.125 |
| exception-rethrow-lost-context | 0 | 0 | 0 | 0.000 | 0.000 | n/a |
| dead-branch-insertion | 0 | 0 | 0 | 0.000 | 0.000 | n/a |

