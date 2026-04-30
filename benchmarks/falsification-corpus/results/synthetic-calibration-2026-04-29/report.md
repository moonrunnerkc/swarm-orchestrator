# synthetic adversarial corpus - layer calibration falsification benchmark

## Summary

| Benchmark | Corpus | n | Catch rate | Status |
| --- | --- | ---: | ---: | --- |
| Falsification battery | synthetic adversarial corpus - layer calibration | 36 | 16.7% (3/18) | publishable |

## Labels

- Clean: 18
- Broken: 18
- Ambiguous: 0
- Skipped unlabeled: 0
- Invalid labels: 0

## Per-Layer Metrics

| Layer | False positive rate | False negative rate | Mean ms | Median ms | P95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| intent | 0.0% (0/18) | n/a (0/0) | 0 | 0 | 1 |
| regression | 0.0% (0/18) | 0.0% (0/3) | 37 | 36 | 40 |
| cheat | 0.0% (0/18) | 0.0% (0/12) | 0 | 0 | 1 |
| property | 0.0% (0/18) | 0.0% (0/3) | 6 | 0 | 40 |
| attestation | 0.0% (0/18) | n/a (0/0) | 8 | 8 | 9 |

## Composite Calibration

Lower composite scores should have higher broken fractions.

```text
0.0-0.2 n= 0 broken= n/a
0.2-0.4 n= 0 broken= n/a
0.4-0.6 n= 0 broken= n/a
0.6-0.8 n= 3 broken=100% ####################
0.8-1.0 n=33 broken= 45% #########
```

## Inter-Rater Reliability

Cohen's kappa: n/a (no double-reviewed labels)

## Known Limitations

- Synthetic adversarial patches are reported separately and are not averaged into agent-authored catch rate.
- Skipped layers are not counted as hard-gate breakage.
- Environmental errors halt publication when they make an entry unrunnable.
- Inter-rater reliability limitation: no double-reviewed labels.

## Reproducibility

- Run ID: synthetic-calibration-2026-04-29
- Generated at: 2026-04-29T22:30:03.418Z
- Corpus directory: /home/brad/projects/swarm-orchestrator/benchmarks/falsification-corpus/synthetic
- Labels directory: /home/brad/projects/swarm-orchestrator/benchmarks/falsification-corpus/synthetic
- Label commit hash: c64e13cc20b89ae3db142651ec9cafc11e3b8f59
- Battery library commit hash: c64e13cc20b89ae3db142651ec9cafc11e3b8f59


## Synthetic Per-Pattern Calibration

| Pattern | Target layer | Broken cases | Target misses | Clean controls | Target false positives |
| --- | --- | ---: | ---: | ---: | ---: |
| cheat-exception-swallowing | cheat | 3 | 0 | 3 | 0 |
| cheat-hardcoded-answer | cheat | 3 | 0 | 3 | 0 |
| cheat-mock-mutation | cheat | 3 | 0 | 3 | 0 |
| cheat-test-modification | cheat | 3 | 0 | 3 | 0 |
| edge-case-failure | property | 3 | 0 | 3 | 0 |
| regression | regression | 3 | 0 | 3 | 0 |
