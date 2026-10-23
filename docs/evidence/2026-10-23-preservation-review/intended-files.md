# Intended files, preservation and candidate-review stage

Declared on October 23, 2026, before any source edit of this stage, on branch
`feat/config-instrument-and-review-2026-10-23`, based on `origin/v13-main` at `66b421274` (which
contains both PR 97 and PR 99: `146c9b21d` is an ancestor). Additional files are recorded below as
dated amendments before they are edited.

## Delivery correction: a configuration change that only follows the patch's own renames

- `src/gates/rename-transport.ts`, `src/gates/rename-transport.test.ts` (new): pairing a patch's
  deleted and added files that are equal up to the same renames, and reading a changed file as the
  base's content with its references moved along those renames.
- `src/gates/instrument-identity.ts`, `src/gates/instrument-identity.test.ts`: the observation
  records which instrument differences are only transported references, and the decision rule
  excludes them.
- `src/gates/independent-verification.ts`, `src/gates/independent-verification.test.ts`: the
  base-tests reading leaves out a test file whose change is only transported references.
- `src/evidence/verifier/status.mjs` and its parity tests: the same decision, re-derived from the
  recorded digests.
- `src/gates/instrument-identity.integration.test.ts`: controls (omitted tests, disabled lint,
  swallowed failure, fabricated success, missing build output) and the two published candidates.

## Preservation obligations and the candidate-review experiment

- `src/gates/preservation-obligations.ts`, `src/gates/preservation-obligations.test.ts` (new):
  obligations tied to their source (task text, supplied contract, base observation, model
  proposal), with statuses that never read an empty set as preserved.
- `src/agent-review.ts`, `src/agent-review.test.ts` (new): the experimental review of an actual
  candidate, its executable probes run on base and candidate, and the classification of what they
  established.
- `src/gates/auto-resolve.ts`, `src/gates/auto-resolve.test.ts`: one more owed kind, the review's
  bounded repair attempt, from the same cap and under the same ratchet.
- `src/agent-run.ts`, `src/agent-run.test.ts`, `src/cli.ts`, `src/cli-options.ts`,
  `src/cli-options.test.ts`, `src/cli-run-outcome.ts`, `src/cli-run-outcome.test.ts`,
  `src/machine-output.ts`: wiring, the off-by-default flag and the report.
- `src/evidence/verifier/verify.mjs` (and its tests): the lifecycle mirror for the new owed kind.

## Experiment harness

- `scripts/comparison/study.mjs`, `scripts/comparison/study.test.mjs`: the progress line and run
  records stop revealing hidden verdicts during a frozen block.
- `scripts/comparison/arms.mjs`, `scripts/comparison/arms.test.mjs`: the review flag as a
  freezable workflow flag.
- Other `scripts/comparison/*` files only where a study needs them, recorded here first.

## Documentation and evidence

- `docs/candidate-review.md` (new): mechanism, reproduction and limitations.
- `docs/cli.md`, `docs/verifying.md`, `README.md`: short, accurate links.
- `docs/evidence/2026-10-23-preservation-review/`: design note, reproductions, controls,
  protocols, records, scores and report.

## Amendment 1, October 23, 2026

- `src/gates/independent-checks.ts`: the base and checkout trees an instrument is compared across,
  factored out so the base-tests reading pairs renames over the same trees. **Edited before this
  amendment was recorded**; the declaration above named `independent-verification.ts` and not this
  file. Recorded here as an out-of-set edit rather than left implied.
- `scripts/comparison/run.mjs`: its progress line prints hidden verdicts too, like the study
  runner's; declared before editing.

## Amendment 2, October 23, 2026, before editing these files

- `src/core/loop-events.ts`: `combineUsage` moves here from `src/agent-run.ts`, beside the
  `LoopUsage` it sums, so the review's conversation and the run share one implementation.
- `src/cli-review.ts`, `src/cli-review.test.ts` (new): the probe runner over fresh checkouts of the
  base and the candidate, through the planned-check runner and the goal verification path.
- `src/evidence/run-assessment.ts`: the run lifecycle reads the review's owed attempt as it reads
  the other owed kinds.
- `src/gates/engine.ts`, `src/gates/default-gates.ts`: the review hook passed from the run to the
  repair loop.

## Amendment 3, October 23, 2026

Edited before this amendment was recorded, each found necessary while wiring the review:

- `src/gates/ratchet.ts`: parts under a key that is no gate (the review's probe readings) are
  compared whatever the gate statuses hold, as the bundled verifier already compares every part.
  Without it the live ratchet abstained where the verifier found a violation.
- `src/evidence/goal-contract.ts`: a `review-probe` contract lineage, so a probe contract is
  declared on the chain beside the root it derives from before it is judged.
- `src/run-outcome-shape.ts`: the `preservation` and `review` fields of the result.

Declared before editing:

- `src/cli-review.integration.test.ts` (new): the deterministic development controls through the
  ordinary command line and the bundle's own verifier.

## Amendment 4, October 23, 2026, before editing these files

- `scripts/comparison/launch-config.mjs`, `scripts/comparison/launch-config.test.mjs`: a
  `swarm-prose` arm (the review's prose control on the same pinned build), and `--review` as a
  flag a manifest may freeze, so the development study's three arms differ only in frozen flags.

## Amendment 5, October 23, 2026, before editing these files

- `scripts/comparison/launch-config.mjs`, `scripts/comparison/arms.mjs`,
  `scripts/comparison/study.mjs`, `scripts/comparison/workspace.mjs` and their tests: an `aider`
  arm (aider 0.82.3 in its own pinned virtual environment, the same model and endpoint, edits
  and its test command run in the workspace), as the fresh block's credible simple agent. Its
  token use is read from aider's own analytics log in the launch's home; `.aider*` files are kept
  out of every arm's patch.
