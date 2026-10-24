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

## Amendment 6, October 23, 2026, before editing these files

- `CHANGELOG.md`, `packages/swarm-verify/CHANGELOG.md`: the stage's entries (the verifier's for
  `rename-transport-v1`, the lifecycle alias and the review's owed-attempt rule).

## Amendment 7, October 23, 2026, before editing these files

Found by the fresh block's zero-inference preflight, which refused every Swarm launch of two of
its three tasks:

- `scripts/comparison/checks.mjs`, `scripts/comparison/study.mjs`, `scripts/comparison/workspace.mjs`:
  the gate plan's tree did not commit the harness lockfile that the launch's workspace commits, so
  every locked dependency read as one the change introduced, and the npm aliases in ufo's lockfile
  (`string-width-cjs` and two more) read as dependencies from outside the registry. One helper now
  commits the lockfile for both. The scoring trees are unchanged. A first attempt that read an
  alias by its lockfile `name` was reverted: it would have weakened the check that refuses a
  package renamed on the way in.
- `src/gates/check-plan.ts` and its test: a tracked `yarn.lock` beside a `package-lock.json` (or
  `pnpm-lock.yaml`) is not a project only yarn can drive, and `swarm check` no longer refuses it.
  Installing is unchanged: `--install` with several lockfiles still needs `--lockfile` or a
  `packageManager` declaration.

## Amendment 8, October 23, 2026, before editing these files

Found by the fresh block's first launch, which stopped before its first model call (`execution
failed`, `rm returned EISDIR … /src`):

- `src/gates/independent-checks.ts`, `src/gates/git-workspace.ts`, `src/gates/git-workspace.test.ts`
  and a new `src/gates/independent-checks.test.ts`: the base side of an instrument comparison
  read a path with `git show`, which prints a directory's listing. ufo's lint names `src` to
  prettier, so an unchanged checkout's lint read as run under a changed instrument, and putting
  `src` back failed. Both base readers now read a blob only, so a directory is no file on either
  side.
- `src/gates/dependency-install.ts`, `src/gates/setup-effect.ts` and
  `src/gates/dependency-install.test.ts`: found by a model-free check of each task's run
  preflight (the goal check over an empty patch with `--install`, on a launch-shaped tree), which
  the harness's own preflight does not reach. npm rewrites a tracked `yarn.lock` beside the
  `package-lock.json` it installs from, `--no-save` included, and setup refused nanoid's fresh
  checkout as an install that changed source. The npm install now puts that one file's bytes back
  and records it as `restored`; any other change still fails setup.
- `scripts/comparison/checks.mjs`, `scripts/comparison/study.mjs`: the harness's gate plan now
  also runs the run's own preflight with no model (`ci` over an empty patch with the launch's
  install and sealed contract, `swarm.toml` committed in the throwaway tree because `ci` reads the
  base's configuration). The preflight that passed all 24 configurations never reached the step
  where the first launch stopped.

## Amendment 9, October 23, 2026, before editing these files

Found by fresh-block launch 8 (ufo bug fix, `aider`), whose outcome stands after inference: the
scorer could not judge it, because the arm's patch changes `package-lock.json` and does not apply
to the base.

- `scripts/comparison/checks.mjs`, `scripts/comparison/study.mjs`, `scripts/comparison/rescore.mjs`:
  the launch commits the frozen harness lockfile, and the arm's patch is taken against that commit.
  The visible, hidden and static scoring trees did not commit it, so a patch touching the lockfile
  applied to nothing. Every scoring tree now commits it, and `rescore.mjs` does the same, with a
  static reading beside the other two. Launches 0 to 7 were scored before this correction. Their
  original scores stand, and each is scored again with the corrected scorer as a supplemental
  reading, reported beside the original.

## Amendment 10, October 23, 2026, before editing these files

Found by the fresh block's results, after the reveal. Every Swarm candidate the hidden evaluator
passes (8 of 8, both Swarm arms) was refused by the product and never repaired: 0 of 3 attempts
were used, stop reason `repair-unavailable`, classification `setup`. Each had added lint findings
that ufo's base does not have (prettier on the test file it wrote, or eslint errors), inside a lint
that already fails on the base. The verification's regression reading was therefore unmeasured,
and the acceptance gate labelled that `setup unavailable:`. The repair policy reads that label as a
missing tool and stops, so the lint findings the change introduced were never put to a repair.

- `src/cli-task-goal.ts` and `src/cli-task-goal.test.ts`: a reading the change itself left
  unmeasured is labelled `unmeasured by the change:` rather than `setup unavailable:`. That covers
  a check that fails on the base too with output the change altered (`attribution:
  "unattributed"`, the ufo launches), and a check read again without the tests or runner
  configuration the change edited (`baseTestsFiles`, `configurationFiles`). Three of the four
  nanoid Swarm launches stopped the same way, over the tests they had edited, with attempts left
  and a real failing test in the tests gate. Repair then proceeds on the failing gates. A missing
  tool, a failed install or an unjudged deciding check is still setup.
- `src/gates/repair-policy.test.ts`: the classification of both labels.
- Same files, after the first confirmation round: the rule required no check to carry an
  `unavailable` text, and a check that stands down because the project declares no such script
  (`optionalAbsence`) carries its absence there. The correction therefore never fired in a live
  run. Stood-down checks are now skipped, with a test shaped like the recorded checks, and the rule
  was applied to every recorded verification of both blocks before rebuilding.
