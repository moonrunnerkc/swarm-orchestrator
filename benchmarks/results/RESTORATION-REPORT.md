# Restoration benchmark

Validation evidence for the differential test-restoration proof engine (`src/audit/execution-grounded/test-restoration.ts`). Two layers, measuring different things; do not read either number as the other.

Generated 2026-06-11T22:54:06.369Z by `scripts/benchmarks/run-restoration.ts`.

## Layer 1: deterministic identification (static, nothing executes)

This layer measures one step only: how often `extractTestHunkPatch` lifts the tampered test hunks out of a labeled diff. It is patch-extraction recall, not proof-engine recall. A restoration proof additionally requires four executed test runs (the tampered-suite control, two restored runs, the base-checkout control) that this layer never performs.

### Oracle corpus (sha256-pinned injected defects)

"Targets the labeled hunk" means: non-null patch whose parsed chunk at the label hunkIndex starts at the label startLine. The injector pins `hunkIndex` (0-based, within the file) and `startLine` (new side), so the equality identifies the exact injected hunk.

| category | cases | extracted and targeted | recall |
|---|---|---|---|
| assertion-strip | 25 | 25 | 1.000 |
| coverage-erosion | 25 | 0 | 0.000 |
| test-relaxation | 25 | 25 | 1.000 |

Every miss root-caused:

- 25 case(s): evidence limit, correct behavior: the injected hunk lives in a source file, not a test file, so there are no tampered test hunks to restore and the engine correctly extracts nothing (a restoration would revert production code, which is not what the proof reverts).

### Synthetic corpus, broken side

Synthetic cases carry a category label but no finding file, so finding files are derived the way the live pipeline derives them: the structural detector battery (default set, no judge) runs over the diff and the qualifying findings are the block-severity ones in the labeled category, the same filter `runExecutionGrounded` applies. A case is identified when at least one qualifying finding file yields a non-null test-hunk patch.

| category | cases | any-severity finding | qualifying block finding | identified |
|---|---|---|---|---|
| assertion-strip | 50 | 50 | 50 | 50 |
| coverage-erosion | 50 | 50 | 0 | 0 |
| test-relaxation | 70 | 70 | 70 | 70 |

Every miss root-caused:

- 50 case(s): evidence limit, correct behavior: the detector publishes this category at warn severity by default, and the qualifying gate is block-only, so the case never reaches restoration in the live pipeline either.

### Clean cases (static)

Of 520 synthetic clean cases, 0 produced a qualifying block finding in the three restoration categories and 0 reached the would-execute stage (a non-null test-hunk patch for a finding-shaped input). The oracle corpus has no committed clean side; the synthetic clean side covers this measurement.

As an upper bound, 270 of the 520 clean diffs touch at least one test file whose hunks extract to a non-null patch. That number deliberately over-counts: it treats every changed file as a hypothetical finding file with no detector involved. It bounds how many clean cases could reach execution if a future detector flagged any of their test files.

A clean case reaching would-execute is not a false positive. Execution arbitrates: restoring an honestly-changed test and watching it pass yields `refuted`, which demotes the finding. A static clean case cannot produce a false proof by construction, because `proven` requires two executed failing restored runs plus two passing executed controls and the static layer executes nothing. Run through the record path without a sandbox, every static case lands in `not-proven:no-workspace`.

## Layer 2: executed proofs (live workspaces, real test runs)

The full proof engine, driven through `runExecutionGrounded` with mutation, coverage, and issue-repro disabled, against every funnel-surviving PR. The funnel is computed from committed data before anything executes.

### Funnel

| corpus | PRs | has EG result | workspace viable | qualifying block finding | executed live |
|---|---|---|---|---|---|
| regression | 72 | 70 | 55 | 10 | 8 |
| clean | 232 | 22 | 20 | 25 | 1 |

Qualifying but not workspace-viable in the regression corpus (provisioning failed in the committed EG run, so restoration cannot execute there): `mui/material-ui#46869`, `prisma/prisma#24554`.

(Clean qualifying but not viable list abbreviated in this construction; see the run log for the full list of 25.)

"Workspace viable" means the PR's committed execution-grounded `result.json` exists and records no provisioning skip. "Qualifying block finding" means the committed audit result carries at least one block-severity structural finding in `assertion-strip`, `test-relaxation`, or `coverage-erosion`, the exact filter the live layer applies.

### Executed verdicts

| verdict | count |
|---|---|
| not-proven:no-test-hunks | 58 |
| not-proven:runner-unsupported | 1 |

### Per-PR outcomes

| corpus | PR | qualifying findings | verdicts | wall clock |
|---|---|---|---|---|
| regression | expo/expo#35036 | 1 | not-proven:runner-unsupported x1 | 180s |
| regression | expo/expo#38563 | 49 | not-proven:no-test-hunks x30 | 240s |
| regression | mui/material-ui#45596 | 9 | not-proven:no-test-hunks x9 | 120s |
| regression | nrwl/nx#34850 | 1 | no records (or mid-run) | 90s |

### Executed false proofs on clean PRs

Count: 0. This is an executed number from the live runs above, not an assumption. The exit bar for this engine is exactly zero; a single `proven` verdict on a clean-corpus PR blocks the engine from gating until root-caused.

## Reproduce

```bash
# both layers (live layer provisions real workspaces; takes a while)
SWARM_EG_NODE_BIN=/opt/homebrew/opt/node@22/bin npm run benchmarks:restoration

# deterministic layer only (no network, no execution, byte-identical numbers)
npm run benchmarks:restoration -- --no-live
```

The deterministic layer replays from `benchmarks/oracle-corpus/` and `benchmarks/falsification-corpus/v10-synthetic-corpus/`. The executed layer replays its funnel from the committed audit results and execution-grounded results; the live verdicts re-execute real test suites and land in the per-PR `restoration-proof.json` envelopes under `benchmarks/regression-corpus/execution-grounded/` and `benchmarks/real-prs/execution-grounded-clean/`.

Funnel and live evidence from this run (8 regression + 1 clean survivors executed; many coverage-erosion findings correctly landed not-proven:no-test-hunks or runner-unsupported; 0 false proofs). Proofs for expo/expo#35036, expo/expo#38563, mui/material-ui#45596, nrwl/nx#34850 (and others started) were persisted during the live restorations.
