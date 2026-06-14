# Phase 0 gate: distant-supervision label validity

Does the revert-derived label (a PR proven retrospectively bad by a revert or hotfix) co-occur with the cheat categories the detectors fire? The triage pipeline can only stand on this label if the answer is yes. This is measured, not asserted.

Corpus: 72 revert-bad PRs (positives, from `benchmarks/regression-corpus`) and 232 presumed-clean merged PRs (not-bad, from `benchmarks/real-prs/audit-results-v2`). Auditor findings are the `post` list of each per-PR audit record.

## Per-category correlation (revert label vs detector firing)

phi is the Matthews correlation between the bad label and "this category fired".
A phi near 0 means the label carries no information about the category.
Oracle recall is the detector's catch rate on injected defects of its own category.

| category | phi | fires on bad | fires on clean | lift | oracle recall |
|---|---:|---:|---:|---:|---:|
| coverage-erosion | 0.476 | 27.8% (20/72) | 0.0% (0/232) | ∞ | 100.0% (25/25) |
| fake-refactor | 0.198 | 8.3% (6/72) | 0.9% (2/232) | 9.667 | 80.0% (20/25) |
| type-suppression | 0.107 | 18.1% (13/72) | 9.9% (23/232) | 1.821 | 100.0% (25/25) |
| error-swallow | 0.005 | 2.8% (2/72) | 2.6% (6/232) | 1.074 | 100.0% (25/25) |
| comment-only-fix | 0.000 | 0.0% (0/72) | 0.0% (0/232) | n/a | 100.0% (25/25) |
| exception-rethrow-lost-context | 0.000 | 0.0% (0/72) | 0.0% (0/232) | n/a | 100.0% (25/25) |
| dead-branch-insertion | 0.000 | 0.0% (0/72) | 0.0% (0/232) | n/a | 100.0% (25/25) |
| test-relaxation | -0.055 | 2.8% (2/72) | 5.6% (13/232) | 0.496 | 96.0% (24/25) |
| mock-of-hallucination | -0.062 | 2.8% (2/72) | 6.0% (14/232) | 0.460 | 100.0% (25/25) |
| no-op-fix | -0.092 | 88.9% (64/72) | 94.4% (219/232) | 0.942 | 100.0% (25/25) |
| assertion-strip | -0.106 | 2.8% (2/72) | 9.5% (22/232) | 0.293 | 56.0% (14/25) |

**Aggregate ("any cheat category fired"): phi = -0.052**, firing 93.1% on bad vs 95.7% on clean.

## Read

The aggregate phi is -0.052: the auditor fires on revert-bad and presumed-clean PRs at indistinguishable rates (93.1% vs 95.7%). The oracle column shows the detectors do catch injected cheats of their own category at high recall, so a weak correlation here is a label problem, not a detector problem.

This reproduces the v11 redundancy finding (`benchmarks/real-prs/REDUNDANCY-FINDING.md`) per category and quantitatively: a reverted PR ships a behavioral defect (a logic bug), which leaves no cheat-shaped tell, so the revert label measures regression-proneness, not cheating. As a general cheat label the two concepts barely overlap.

The one exception is `coverage-erosion` (phi 0.476, 20/72 bad vs 0/232 clean). That co-occurrence is real and sensible: removing coverage is one of the few cheat shapes that can itself cause the regression the revert undoes. It is not enough to make the revert anchor a primary cheat label, but it is signal worth keeping.

### Decision: PIVOT the anchor

The aggregate phi (-0.052) is below the primary-anchor bar (0.3), so the revert/SZZ anchor is rejected as the primary label. It is retained as a weak labeling function (a low-accuracy vote the Phase 3 label model can down-weight from agreement structure), never as ground truth. The primary anchor pivots to a cheat-specific signal: a restoration event, where a later PR re-adds a test, assertion, or coverage that an earlier PR deleted. The earlier deleting PR is labeled a cheat positive, because its own later restoration demonstrates the deletion was wrong. This anchor targets the cheat concept directly and is mined from the same git history the regression pipeline already walks.

The revert signal is kept additionally as a per-category labeling function for `coverage-erosion`, where it carries measured signal.

## Reproduce

```
npm run triage:validity
```

Reads the committed corpora; the numbers are deterministic. The JSON sidecar `distant-supervision-validity.json` carries the raw 2x2 tables.
