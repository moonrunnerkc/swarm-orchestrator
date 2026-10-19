# Declared files: requested outcomes, thrown cases and the scope of `accepted`

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve` at `3e99b6305` (31 commits above PR #89's head
`9db7ec3d4`; the earlier work's tested source commit `4e6c4e510` is an ancestor). It follows
[../coverage-and-reserve/](../coverage-and-reserve/README.md), whose D1 launch is the failure
read here. Additions are appended below as amendments, each naming every file it adds, before
that file is edited. The main checkout's uncommitted work on `v13-main` and the other worktrees
are not touched. Nothing is pushed, merged or published under this work.

## Initial declaration

Evidence and records, all new unless marked:

- `docs/evidence/2026-10-19/outcome-coverage/` (this directory): the account of D1's route, the
  replay of D1's recorded planner turns through a build (no live model), its results on D1's build
  and on this work's, the regressions run against the starting implementation, the gates on the
  tested commit, the protocol of the one development launch, its ledger and its records.
- `docs/evidence/2026-10-19/coverage-and-reserve/README.md`,
  `docs/evidence/2026-10-19/coverage-and-reserve/comparison/README.md`: appended corrections only
  (the wording of the comparison's reading). The scores and earlier text stay as written.

Product, one concern each:

1. A thrown case says where it was thrown.
   - `src/workers/planned-check-program.ts`, `src/workers/planned-check-program.test.ts`: the
     runner records, for a case that threw, whether the innermost frame that names a file is the
     check program's own module, another file (the project or its dependencies), or nothing it
     can attribute; an expected throw is the project's.
   - `src/cli-planned-checks.ts`, `src/cli-planned-checks.test.ts`: a case thrown in the program's
     own code recorded no answer of the project's, so its check is not admitted on that case and
     the revision is shown the throw; a throw in the project stays an observation of the project;
     an unattributed one is recorded as such.
2. A requested outcome cannot disappear because another outcome shares its requirement.
   - `src/workers/planned-check-program.ts`: each declared check names an outcome, the task's
     words it quotes and the role of its cases (changed or kept) under its requirement; the
     declaration keeps every outcome it was ever given, with the checks declared for it.
   - `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the outcomes are recorded before
     admission; coverage is reconciled per outcome after admission and the revision; an outcome
     with no retained check is unresolved, with why and the next action, in the revision's brief
     and the summary.
   - `src/cli-task-contract.ts`, `src/cli-task-contract.test.ts`: the worker's brief names each
     unresolved outcome.
   - `src/cli-run-outcome.ts`, `src/cli-run-outcome.test.ts`, `src/run-outcome-shape.ts`: the
     report names each unresolved outcome under its requirement, and says that `accepted` is
     the supplied contract's where any is unresolved.
   - `src/machine-output.ts`, `src/cli.ts`: the JSON result and the brief carry the unresolved
     outcomes.
   - `src/cli-planned-checks.integration.test.ts`: the regressions through the ordinary command
     line with a scripted model, on a small project that is not marked.

Documentation: `CHANGELOG.md` (14.5.0, unreleased) and `docs/using.md`, where the behaviour a
reader relies on changes. `README.md` is not expected to change.

## Amendments
