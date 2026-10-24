# Intended files, detection and repair stage

Declared on October 24, 2026, before any source edit of this stage. Branch
`feat/config-instrument-and-review-2026-10-23` (draft PR #101, open and unmerged), at
`ef5e87efc`, which is the remote head. Any other file is recorded below as a dated amendment
before it is edited.

## Failure attribution (`failure-identity-v5`)

- `docs/check-requirements.md`: the v5 amendment, written before the code.
- `src/gates/failure-attribution.ts` and its test: a chain is complete only where the failing
  tool runs once in it; located diagnostics are matched occurrence by occurrence.
- `src/gates/source-changes.ts` (new) and its test: zero-context hunks of the change, read from a
  unified diff, and the line map they give.
- `src/gates/gate-runner.ts` and its test: the hunks recorded beside a failed gate's inheritance.
- `src/gates/independent-verification.ts` and its test: the same for the final verification.
- `src/gates/default-gates.ts` and its test: a static check the task asks to fix is sealed
  `absolute-pass`.
- `src/agent-run.ts`, `src/gates/engine.ts`: passing the task text and the hunks through.
- `src/evidence/verifier/status.mjs`, `src/evidence/verifier/verify.mjs`, their declarations and
  tests: the independent mirror, by rule, with v4 records kept as written.
- `src/cli-check-requirements.integration.test.ts`: the end-to-end cases.

## Probes and requested behaviour

- `src/agent-review.ts` and its test, `src/cli-review.ts` and its test: harness validation of the
  final probes, one bounded correction, trial reuse by identity, unmeasured where broken, and
  task-stated examples and relations.
- `src/gates/project-loader.ts` (new) and its test: how a probe loads the project, grounded in
  what loads on the base.
- `src/workers/planned-check-program.ts` and its test: only where the runner must report a
  reference answer or a call record.
- `src/gates/preservation-obligations.ts` and its test: requested behaviour measured apart from
  preservation.
- `src/cli-review.integration.test.ts`: scripted qualification of the chain.
- `docs/candidate-review.md`, `docs/check-requirements.md`, `README.md`.

## Evaluation

- `docs/evidence/2026-10-24-detection-repair/` (new): the reproductions, the trace, the
  development set, protocols, launches and the report.
- `scripts/comparison/` only where a registered arm needs a setting it does not have.

## Amendments

None yet.
