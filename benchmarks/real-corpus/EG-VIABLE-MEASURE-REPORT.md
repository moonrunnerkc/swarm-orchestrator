# EG-viable measurement (the corroborated promotion tier)

The bounded execution-grounded run over the 12 EG-viable PRs of the
outcome-labeled real corpus (`benchmarks/real-corpus/eg-viability.json`). It runs
the full execution-grounded layer (mutation, coverage, the proof tier) in a
sandbox per PR and records the runtime-corroborated findings, so the
corroborated promotion tier in `promotions.json` can move from
`viability-screened` to a measured precision once the run has covered the slice.

## Status: single-target proven locally; 12-repo dispatch pending review

The runner has a single-target mode (`--repo <slug>` / `--only <id>`) so a
workflow-dispatch CI matrix can fan the 12 repos one per container, each with its
own time cap. The matrix is committed at
[`.github/workflows/eg-viable-measure.yml`](../../.github/workflows/eg-viable-measure.yml)
and is **user-triggered after review**, not scheduled: it clones and installs 12
third-party repositories and runs their suites under mutation.

A single-target run was proven locally against the most viable repo:

| PR | repo | status | mutation | coverage | corroborated findings |
| --- | --- | --- | --- | --- | --- |
| `devin-aalikes-rest-api-pr1` | aalikes/rest-api | measured | ran | ran | 0 |

The repo provisioned, installed, and ran both mutation and coverage to
completion (`benchmarks/real-corpus/eg-viable-results/devin-aalikes-rest-api-pr1/result.json`).
There was no provisioning failure to classify. The PR is outcome-clean and the
run surfaced no runtime-corroborated finding, so it contributes nothing to the
corroborated tier, which is the honest result for a clean PR.

## Why promotions.json stays pending-dispatch

The corroborated promotion tier scores a detector on the subset of its findings
that a surviving mutant, a coverage gap, or a still-failing repro backs. A
corroborated finding is a true positive only on an outcome-bad PR. The 12-PR
EG-viable slice is currently **all outcome-clean (survived)**, so even a full
sweep can only produce corroborated false positives, never the true positives a
detector needs to clear the corroborated gate. The tier therefore stays
`viability-screened` in `promotions.json` (the honest pending-dispatch status);
nothing is promoted off this slice. The positive class grows through the
backward-mining cron (`.github/workflows/backward-mine.yml`), at which point a
re-run of this matrix over a slice that includes outcome-bad PRs can measure a
real corroborated precision.

## Reproduce

```sh
npm run build
# one repo, sandboxed, bounded (the local proof):
SWARM_EG_NODE_BIN=$(dirname $(which node)) \
  node dist/scripts/real-prs/eg-viable-measure.js --only devin-aalikes-rest-api-pr1
# fold every per-PR result into the corroborated summary:
npm run eg-viable:aggregate
```

The full 12-repo measurement is the `EG-viable measurement (12-repo matrix)`
workflow, dispatched manually after this merges.
