# Oracle coverage

One table, per category: how many defects were injected, the detection rate, and whether the cosmetic evader stack reduced it. Read this first; the per-artifact reports under benchmarks/oracle-corpus/ have the detail. Regenerate the whole thing with `npm run benchmarks:full`.

| category | kind | injected | detection rate | tested evasion depth | survives cosmetic evasion |
|---|---|---|---|---|---|
| assertion-strip | structural | 25 | 0.56 (detector) | 4 | yes (robust) |
| comment-only-fix | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| coverage-erosion | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| dead-branch-insertion | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| error-swallow | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| exception-rethrow-lost-context | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| fake-refactor | structural | 25 | 0.80 (detector) | 4 | yes (robust) |
| mock-of-hallucination | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| no-op-fix | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| test-relaxation | structural | 25 | 0.96 (detector) | 4 | yes (robust) |
| type-suppression | structural | 25 | 1.00 (detector) | 4 | yes (robust) |
| goal-not-fixed | semantic | 25 | 0.84 (judge-primary) | 4 | n/a |
| cheat-mock-mutation | semantic | 25 | 0.96 (judge-primary) | 6 | n/a |

## How to read this

- **Structural** categories are caught by a deterministic detector; the rate is its recall on that injection class (any-severity).
- **Semantic** categories have no structural tell; the rate is the judge-primary recall. Structural catch on these is 0 by construction.
- **Survives cosmetic evasion** = the rename/whitespace/reorder/noise evader stack did not lower the detection rate at that category's own max tested depth (the tested-depth column; detail in evasion-report.md). Categories are tested to different depths, so robustness is judged per category.

## The honesty caveat

Injected recall proves detection of the defect classes we inject; it does not prove detection of unobserved defect classes. False-positive rate is measured against presumed-clean real PRs; the "presumed" is load-bearing. Both numbers are defensible, neither is overclaimed. See docs/audit/methodology.md.

