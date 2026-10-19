# Declared files, checking-semantics follow-up to PR #89

Declared before the first edit of this work, on `fix/repair-trust-and-first-run` at
`c69e14d4af41597d3b32be1e5853a110b3bc47d5`. Additions are appended below as amendments, each
naming every file it adds, before that file is edited. The main checkout's uncommitted work
(a new agent-instructions module and planner and controller edits on `v13-main`) is not part of
this work and is not touched.

## Initial declaration

Product, with tests beside them:

- `src/workers/planned-check-program.ts`, `src/workers/planned-check-program.test.ts`: the
  authoritative runner without instrumentation, the separate argument probe, each case's
  declared role, and the coverage review's declaration and the relations it names.
- `src/cli-planned-checks.ts`, `src/cli-planned-checks.test.ts`,
  `src/cli-planned-checks.integration.test.ts`: admission by base control, the probe's reading,
  per-case roles and what each control establishes.
- `src/cli-task-goal.ts`, `src/cli-task-goal.test.ts`: the diagnostics gate's reading (no exit
  status from instrumentation; a model-asserted case the repair left unchanged is held) and
  `run_check`'s probe line.
- `src/cli-plan-checks.ts`, `src/cli-plan-checks.test.ts`: the bounded coverage-review round and
  what the planner is told about controls.
- `src/workers/planner-run.ts`, `src/workers/planner-run.test.ts`: the review tool, the case
  role in the tool descriptions and the planner's instructions.
- `src/gates/repair-policy.ts`, `src/gates/repair-policy.test.ts`: the instrument class's
  wording, which names the old exit status.

Evidence and records:

- `docs/evidence/2026-10-18/checking-semantics/` (this directory): reproductions, the expanded
  development audit and its validation, the protocol, its launch ledger and records.
- `docs/evidence/2026-10-18/generated-check-control/README.md`,
  `docs/evidence/2026-10-18/generated-check-control/launches.md`: an appended correction to the
  launch-4 correctness claim; the original text and the frozen evaluator's verdict stay as written.
- `docs/agent.md`: one entry in the measurement history.
- `scripts/check-doc-paths.mjs`: paths these documents name that live outside this repository.

## Amendments

### 1. The result line

- `src/cli.ts`: the run's result line carries the coverage review and the checks kept with an
  unestablished control beside the admission summary it already carries.

Withdrawn before commit: the result line is the public `swarm.result.v1` schema
(`src/machine-output.ts`). The review and the checks kept with an unestablished control travel in
the admission summary on the planning chain's `plan-checks-v1` record instead, and `src/cli.ts`
is left unchanged.

### 2. The changelog

- `CHANGELOG.md`: one entry under 14.5.0 (unreleased) for the `--plan-checks` behaviour this work
  changes: what admission keeps, the held case, the coverage review and the case role.
