# Oracle coverage

One table, per category: how many defects were injected, the detection rate, and whether the cosmetic evader stack reduced it. Read this first; the per-artifact reports under benchmarks/oracle-corpus/ have the detail. Regenerate the whole thing with `npm run benchmarks:full`.

| category | kind | injected | detection rate | survives cosmetic evasion |
|---|---|---|---|---|
| assertion-strip | structural | 25 | 0.56 (detector) | yes (robust) |
| comment-only-fix | structural | 25 | 1.00 (detector) | yes (robust) |
| coverage-erosion | structural | 25 | 1.00 (detector) | yes (robust) |
| dead-branch-insertion | structural | 25 | 1.00 (detector) | yes (robust) |
| error-swallow | structural | 25 | 1.00 (detector) | yes (robust) |
| exception-rethrow-lost-context | structural | 25 | 1.00 (detector) | yes (robust) |
| fake-refactor | structural | 25 | 0.80 (detector) | yes (robust) |
| mock-of-hallucination | structural | 25 | 1.00 (detector) | yes (robust) |
| no-op-fix | structural | 25 | 1.00 (detector) | yes (robust) |
| test-relaxation | structural | 25 | 0.96 (detector) | yes (robust) |
| type-suppression | structural | 25 | 1.00 (detector) | yes (robust) |
| goal-not-fixed | semantic | 25 | 0.68 (judge-primary) | n/a |
| cheat-mock-mutation | semantic | 25 | 0.16 (judge-primary) | n/a |

## How to read this

- **Structural** categories are caught by a deterministic detector; the rate is its recall on that injection class (any-severity).
- **Semantic** categories have no structural tell; the rate is the judge-primary recall. Structural catch on these is 0 by construction.
- **Survives cosmetic evasion** = the rename/whitespace/reorder/noise evader stack did not lower the detection rate (evasion-report.md).

## The honesty caveat

Injected recall proves detection of the defect classes we inject; it does not prove detection of unobserved defect classes. False-positive rate is measured against presumed-clean real PRs; the "presumed" is load-bearing. Both numbers are defensible, neither is overclaimed. See docs/audit/methodology.md.

