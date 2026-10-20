# Declared files: the requested example through revisions, a follow-up on unresolved outcomes, revision scheduling

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve` at `544f643a3`. It follows
[../outcome-coverage/](../outcome-coverage/README.md), whose one development launch is the failure
read here. Additions are appended below as amendments, each naming every file it adds, before that
file is edited. The main checkout's uncommitted work on `v13-main` and the other worktrees are not
touched. Nothing is pushed, merged or published under this work.

## The branch as found

`544f643a3` is 42 commits above PR #89's head `9db7ec3d4`. Product changes (source and tests):
`f66dc2444`, `6f9ca338f`, `334690806`, `39f7e7d40`, `a3ef9d4d2` (coverage, bounded output,
verification reserve), `b148573e3` (per-outcome coverage, thrown-case attribution, scoped
`accepted`), `eb47531a2` (the report names an unresolved outcome under a requirement with no
check). Documentation: `64b68d0cf`, `62573d336`. Everything else touches only `docs/evidence/`:
declarations, measurements, protocols, launch records, packs and appended corrections. The launch's build was `b148573e3`; `544f643a3`'s product differs from it only
by `eb47531a2`.

## Initial declaration

Evidence and records, all new: `docs/evidence/2026-10-19/requested-example/` (this directory): the
launch's failure sequence read from its restored chains, a replay of the launch's recorded planner
responses through a build (no live model), the regressions run against the starting
implementation, the gates on the tested commit, the protocol of the two-configuration development
trial, its ledger and its records. `docs/evidence/2026-10-19/outcome-coverage/README.md`: appended
corrections only.

Product, one concern each:

1. The requested example survives a check's revisions.
   - `src/workers/planned-check-program.ts`, `src/workers/planned-check-program.test.ts`: each
     statement of an outcome keeps the cases it was stated with, so a later version of the check
     can be compared with the first.
   - `src/cli-planned-checks.ts`, `src/cli-planned-checks.test.ts`: a check that, for an input the
     task names, now expects the base's answer after the base disagreed with an earlier
     expectation there, is refused with that reason rather than admitted as behaviour to keep.
   - `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the disagreements every base run
     recorded are kept across the round; each outcome carries the task's own inputs it was stated
     with; it is covered only by a retained check whose cases still hold those inputs; a later
     version of the same check that keeps its words and its inputs is the same outcome, not a new
     one; every change of expectation for a task-named input is recorded.
   - `src/cli-task-contract.ts`, `src/cli-task-contract.test.ts`: the worker's brief names the
     task's own inputs of each unresolved outcome, with the expectation first stated and what the
     base gave.
2. An unresolved outcome is followed up once before completion is reported.
   - `src/gates/auto-resolve.ts`, `src/gates/auto-resolve.test.ts`, `src/gates/engine.ts`: an
     obligation outside the gates is owed one attempt once the gates are green, under the same cap,
     ratchet, rollback and budget floor as a repair, and its outcome is recorded.
   - `src/agent-run.ts`, `src/agent-run.test.ts`: the follow-up reaches the gates engine and its
     brief says what it is.
   - `src/cli-outcome-follow-up.ts`, `src/cli-outcome-follow-up.test.ts` (new): the follow-up's
     brief from the structured unresolved outcomes.
   - `src/cli.ts`: wiring.
   - `src/cli-run-outcome.ts`, `src/cli-run-outcome.test.ts`, `src/run-outcome-shape.ts`,
     `src/machine-output.ts`: the report and the JSON say whether the follow-up ran and what
     became of it; status and exit code keep their meaning.
3. Revision scheduling inside the planning allowance.
   - `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the first round and the coverage
     review cannot run into the time held for admission, a revision and its re-admission; where
     the revision still does not fit, a bounded amount is borrowed from implementation time,
     never from the verification reserve; the decision is recorded with the measured admission.
   - `src/cli.ts`: the borrowing limit.
4. The boundary of a thrown case.
   - `src/workers/planned-check-program.test.ts`, `src/cli-planned-checks.test.ts`: the five
     cases (an invalid operation, an intentional assertion, a project exception, an expected
     exception, an uncertain origin); the wording or record of a throw in the program changes
     only if they show it claims more than its evidence.
5. Through the ordinary command line, on a small project that is not marked:
   `src/cli-planned-checks.integration.test.ts`.

Documentation: `CHANGELOG.md` (14.5.0, unreleased) and `docs/using.md`, where the behaviour a
reader relies on changes. `README.md` is not expected to change.

## Amendments

### 1. After launch 1: the bundle verifier and a rolled-back last attempt

Launch 1's bundle failed its own verifier (`FAIL run assessment ... re-derived: recorded false,
evidence implies false`): the assessment names the gate runs of the cycle the workspace was left
in, and the verifier required the latest gate runs on the chain, which belong to a later attempt the
ratchet rolled back. Every run whose last judged attempt is rolled back is refused that way, and a
rolled-back follow-up would be too. One file not declared before:

- `src/evidence/verifier/verify.mjs`: the gate runs an assessment must name are those of the cycle
  the ratchet decisions leave the workspace in.
- `src/agent-run.test.ts` (declared): a run whose last attempt is rolled back, and a rolled-back
  follow-up, verify through the bundle's own verifier.

This changes the verifier after the trial's build was frozen; the trial's records are read as they
are, with this correction appended.

### 2. The lifecycle a rolled-back follow-up leaves

The product names the work's own stop as the lifecycle when a follow-up is not kept, but the
assessment's lifecycle record, and the verifier, took the last loop stop on the chain, the
follow-up's. One file not declared before:

- `src/evidence/run-assessment.ts`: a follow-up's stop (marked `followUp: true` on its
  `session-stopped` record by `src/agent-run.ts`, declared) is not the lifecycle record unless the
  `outcome-follow-up-v1` record says its candidate was kept; `src/evidence/verifier/verify.mjs`
  (amendment 1) applies the same rule.

### 3. The verifier's changelog

- `packages/swarm-verify/CHANGELOG.md`: an unreleased entry for amendments 1 and 2, since they
  change what the standalone verifier accepts.
