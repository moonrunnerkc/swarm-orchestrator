# Evasion survival curves

Each injected structural defect was mutated by the evader stack at increasing depth (0 = unmodified, 4 = all evaders), and the detector re-run. The cells are detection rate (1.0 = still caught). Evaders: rename-identifiers, trailing-whitespace, reorder-added-lines, append-noise-file. Regenerate with `node dist/scripts/oracle/run-evasion.js`.

| detector | d0 | d1 | d2 | d3 | d4 |
|---|---|---|---|---|---|
| assertion-strip | 0.38 | 0.38 | 0.38 | 0.38 | 0.38 |
| comment-only-fix | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| coverage-erosion | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| dead-branch-insertion | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| error-swallow | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| exception-rethrow-lost-context | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| fake-refactor | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| mock-of-hallucination | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| no-op-fix | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| test-relaxation | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 |
| type-suppression | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

> A flat row means the evader stack does not reduce detection: every detector here is robust to these cosmetic mutations (identifier rename, whitespace, line reorder, noise file). A row below 1.00 that stays flat (assertion-strip, test-relaxation) reflects base recall on non-JS carrier files, not an evasion success, since the rate does not fall as depth rises. A dropping row would show the depth at which evasion succeeds. The underlying counts are in evasion-data.csv. These evaders are structure-preserving; semantic-rewrite evaders are the next escalation.

## Behavioral evasion (semantic categories)

The focused-judge path (cheat-mock-mutation) and the whole-diff judge (goal-not-fixed) re-run under evasion. cheat-mock-mutation layers the cosmetic stack then the behavioral evaders (alias-mock-return-method, decoy-mock); goal-not-fixed layers the cosmetic stack only. Cells are judge detection rate against qwen3.6:35b-a3b.

| category | d0 | d1 | d2 | d3 | d4 | d5 | d6 |
|---|---|---|---|---|---|---|---|
| goal-not-fixed | 0.80 | 1.00 | 0.60 | 0.80 | 1.00 | - | - |
| cheat-mock-mutation | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

> cheat-mock-mutation stays flat under the cosmetic stack because the focus discards the noise file and judges only the mock hunk, and under the behavioral evaders because the focus matches the whole mockReturnValue/mockImplementation family, not one spelling. A `-` is a depth that does not apply to that category (the behavioral evaders are no-ops on goal-not-fixed).

