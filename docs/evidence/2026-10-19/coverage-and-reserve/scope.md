# Declared files: requirement coverage, bounded tool output and the verification reserve

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve`, cut from PR #89's head `9db7ec3d4`
(`fix/repair-trust-and-first-run`, identical to its remote). Additions are appended below as
amendments, each naming every file it adds, before that file is edited. The main checkout's
uncommitted work on `v13-main` (an agent-instructions module and planner and controller edits) is
not part of this work and is not touched; nor are the other worktrees.

## Initial declaration

Evidence and records, all new:

- `docs/evidence/2026-10-19/coverage-and-reserve/` (this directory): the C1 timeline and the
  script that computes it from the restored, verified archive; the deterministic reproductions'
  results against the previous build; the context-size measurement; the new protocol, its launch
  ledger and every launch's records.
- `docs/evidence/2026-10-19/repair-value/README.md`, `docs/evidence/2026-10-19/repair-value/launches.md`:
  appended corrections only, where this work's reading of C1 adds to or corrects the earlier
  account. The protocol, the frozen verdicts and the earlier text stay as written.

Product, one concern each:

1. A rejected check never removes the requested behaviour.
   - `src/cli-planned-checks.ts`, `src/cli-planned-checks.test.ts`: a preserve check that fails on
     the base is recorded as a disagreement with the base, case by case, with whether the task
     names that case's input, rather than as a finding that the requested behaviour is wrong; a
     check the planner reclassifies from preserve to change is recorded with its justification
     and held to the ordinary change control.
   - `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the revision is given the task's
     quotation, each case with its expectation and the base's answer, and the explicit choice
     between correcting an expectation and reclassifying with a justification; coverage is
     reconciled against the retained contract after admission and revision, so a review naming a
     rejected check covers nothing, and a sealed requirement with no retained check is reported
     as uncovered with the reason and the next useful action.
   - `src/cli-task-contract.ts`, `src/cli-task-contract.test.ts`: the worker's brief names each
     uncovered requirement, the reason and what to do, labelled as the planner's reading.
   - `src/cli-run-outcome.ts`, `src/cli-run-outcome.test.ts`: the run's report gives the same
     reason and next action for a planned requirement with no check.
   - `src/machine-output.ts`: the JSON result carries the reconciled coverage.
   - `src/cli-planned-checks.integration.test.ts`: the regressions through the ordinary command
     line with a scripted model, on a small project that is not marked.
2. One verbose command no longer dominates later model requests.
   - `src/tools/output-view.ts`, `src/tools/output-view.test.ts` (new): the bounded, labelled view
     of a long tool output, carrying the recorded status facts and the evidence reference.
   - `src/tools/recorded-output-tool.ts`, `src/tools/recorded-output-tool.test.ts` (new): reading
     omitted lines of a recorded tool output back through the chokepoint.
   - `src/tools/chokepoint.ts`, `src/tools/chokepoint.test.ts`: the model gets the view, the
     ledger keeps the captured output as before.
   - `src/agent-run.ts`, `src/agent-run.test.ts`: the reading tool is registered with the worker's.
3. Final verification keeps a deliberate share of the one total allowance.
   - `src/agent-run.ts`, `src/gates/engine.ts`: a gate command stops for the run's cancellation and
     for the end of the total allowance, never for the end of an attempt's wall.
   - `src/cli.ts`, `src/cli-run-settings.ts`: the verification reserve, from a measured duration
     where one exists and a documented bounded policy otherwise, held back from planning,
     implementation and repair.
   - `src/cli-goal-budgets.integration.test.ts`: a worker that consumes its allocation and the
     required checks still running on the exact delivered tree; cancellation; a budget too small.

Documentation: `CHANGELOG.md` (14.5.0, unreleased), and `docs/using.md` or `docs/verifying.md`
where the behaviour a reader relies on changes. `README.md` only if the ordinary workflow changes.

## Amendments
