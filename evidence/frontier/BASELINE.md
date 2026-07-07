# Frontier run: Phase 0 baseline freeze

The starting state, recorded before any code changed. Every number here reads
from a committed artifact or the output of a committed check script, captured on
the branch point. Nothing below is estimated.

## Branch point

| item | value |
|---|---|
| base commit | `56cf3994250ee09144bfdc9632345b896e34c77e` |
| commit subject | `fix(ci): deploy the leaderboard instead of committing it to a protected main` |
| working branch | `frontier/polyglot-claim-diff-twins` (off `main`) |
| package version | `12.1.0` |
| Node used | `v22.15.0` (engines require >= 20; CI runs 20 and 22; the machine default `node` is v18 and is not used) |

## Suite and gates: green on the branch point

| command | result |
|---|---|
| `npm ci` | clean install, exit 0 |
| `npm test` (build + mocha) | pass, exit 0 |
| `npm run typecheck` | clean (`tsc --noEmit`) |
| `npm run promotions:check` | matches recompute: **gate-eligible=0, advisory=10** |
| `npm run block-policy:check` | matches recompute: **block-eligible=8** |
| `npm run corroborated-gate:check` | matches recompute: **status=undefined-n, n_bad=0, tp=0/0** |

## Execution-grounded viability

`benchmarks/real-corpus/eg-viability.json` (`npm run execution-grounded:viability-screen`):

| quantity | value |
|---|---|
| usable PRs screened | 197 |
| EG-viable | **78 / 197 (39.6%)** |
| viable by ecosystem | Node 12, Python 52, Go 14 |
| provisionableCount (corroboration-scoreable = Node) | 12 |

## Corroborated structural gate

`benchmarks/real-corpus/corroborated-gate-precision.json` (`npm run corroborated-gate:measure`):

| quantity | value |
|---|---|
| provisionable slice (Node) | 12 PRs |
| outcome-bad in that slice | 0 (all 12 survived) |
| corroborated findings scored | 0 |
| status | `undefined-n` |
| Wilson-95 lower bound | not computed (no positive class) |

## Proof-tier gate precision

`benchmarks/real-corpus/gate-precision.json` (`npm run gate-precision`), proof tier
= test-tamper / mock-mutation / no-op-fix / type-suppression / fake-refactor /
dead-branch:

| quantity | value |
|---|---|
| slice size | 12 (EG-viable) |
| proven block triggers fired | 0 |
| proven-finding precision | n=0 (TP 0, FP 0, precision null) |

An honest n=0: no proven block fired on the viable slice, and the slice carries no
genuine cheat to prove, so precision has an empty denominator.

## Hunt 2 detector overlap with maintainer-caught cheats

`benchmarks/real-prs/overlap-matrix.json` (`scripts/real-prs/overlap.ts`), over the
27 agent PRs carrying a verified maintainer complaint:

| measure | value |
|---|---|
| matching-category recall | **5 / 27 (18.5%)** |
| any-finding (some category) | **13 / 27 (48%)** |
| same-spirit (sibling category counts) | 8 / 27 (29.6%) |
| category-precision on the flagged-and-labeled subset | 5 / 13 (38.5%) |

The judge path in that study ran against a free local model (`qwen3.6:35b-a3b`);
the structural result is model-independent.

## Advisory detector union against outcome labels

`benchmarks/real-corpus/scores-outcome/latest.json` (`npm run corpus:score-outcome`),
ground truth = repository history only:

| measure | value |
|---|---|
| PR-level union precision | **0.217** (Wilson-95 lower 0.097) |
| PR-level union recall | 0.227 |
| PR-level union F1 | 0.222 |
| confusion (TP / FP / TN / FN) | 5 / 18 / 157 / 17 |

## Outcome distribution

`benchmarks/real-corpus/outcome-labels.json` (`npm run labeling:outcome`):

- 205 corpus entries, **197 usable** (8 indeterminate: the commit 404'd).
- **0 reverted, 22 hotfixed, 175 survived** — a true bad base rate of 11.2%.

## CI regression baselines

`benchmarks/baselines/` stay frozen; this run adds capability and is guarded by
`npm run baseline:check` against `benchmarks/baselines/ground-truth-v12.json`
(`eg-viable-count: 78`). No baseline was re-frozen.
