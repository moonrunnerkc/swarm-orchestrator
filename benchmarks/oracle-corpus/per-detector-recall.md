# Per-detector recall on the oracle

Each structural detector run against its own injection class. Recall counts a finding of the expected category at any severity (warn or block). Whole-PR-scoped detectors (comment-only-fix, coverage-erosion) and the source/test detector (no-op-fix) are measured with isolated single-defect diffs, since appending into a carrier that already has real changes masks their signal. A detector below 0.2 after fair measurement is retired or reshaped. Regenerate with `npm run benchmarks:oracle`.

| detector | injections | tp | recall | decision |
|---|---|---|---|---|
| assertion-strip | 25 | 14 | 0.560 | keep |
| comment-only-fix | 25 | 25 | 1.000 | keep |
| coverage-erosion | 25 | 25 | 1.000 | keep |
| dead-branch-insertion | 25 | 25 | 1.000 | keep |
| error-swallow | 25 | 25 | 1.000 | keep |
| exception-rethrow-lost-context | 25 | 25 | 1.000 | keep |
| fake-refactor | 25 | 20 | 0.800 | keep |
| mock-of-hallucination | 25 | 25 | 1.000 | keep |
| no-op-fix | 25 | 25 | 1.000 | keep |
| test-relaxation | 25 | 24 | 0.960 | keep |
| type-suppression | 25 | 25 | 1.000 | keep |

