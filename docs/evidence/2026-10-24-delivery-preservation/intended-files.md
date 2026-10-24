# Intended files, delivery and preservation stage

Declared on October 24, 2026, before any source edit of this stage. Branch
`feat/config-instrument-and-review-2026-10-23` (draft PR #101, unmerged), at `40e3f17a5`. Any
other file is recorded below as a dated amendment before it is edited.

## Check requirements (`check-requirement-v1`, `failure-identity-v4`, `run-acceptance-v6`)

- `src/gates/failure-attribution.ts` and its test: diagnostic identities, incomplete chains and
  stops.
- `src/gates/gate-definition.ts`, `src/gates/default-gates.ts` and its test,
  `src/gates/gate-set-seal.ts`, `src/gates/engine.ts`: the requirement on each gate, its
  defaults, and the seal.
- `src/gates/gate-runner.ts` and its test, `src/gates/auto-resolve.ts` and its test: inheritance
  read in the cycle, one base measurement per gate, repair and escalation on new failures only.
- `src/evidence/run-assessment.ts` and its test, `src/evidence/verdict.ts` and its test: the v6
  policy and the two kinds of acceptance.
- `src/evidence/verifier/status.mjs`, `src/evidence/verifier/verify.mjs`, their declarations and
  tests, the verifier parity tests: the independent mirror.
- `src/config/` (the `swarm.toml` gate override schema) and its tests: `requirement`.
- `src/cli-run-outcome.ts`, `src/cli-run-report.ts`, `src/machine-output.ts` and their tests: the
  result line and machine output.
- Integration tests beside `src/cli-*.integration.test.ts` for the end-to-end cases.

## Review and preservation

- `src/agent-review.ts` and its test: qualification of findings, eligibility, the probe trial
  tool, the brief.
- `src/cli-review.ts` and its test: the load error's message, the trial tool's runner.
- `src/gates/base-snapshot.ts`: a copy of the candidate for trial runs.
- `src/gates/preservation-obligations.ts` and its test: v2 accounting.
- `src/evidence/goal-contract.ts` and its test: an optional `intent` on a supplied requirement.
- `src/agent-run.ts` and its test: wiring.
- `docs/candidate-review.md`, `docs/verifying.md`, `docs/check-requirements.md`, `README.md`.

## Evaluation

- `docs/evidence/2026-10-24-delivery-preservation/` (new): the note, audit scripts and outputs,
  protocols, launches and the report.
- `scripts/comparison/` where the mechanism study needs a new arm setting; existing scores and
  scorers stay as they are.

## Amendments

All dated October 24, 2026. They were recorded at the end of the stage, not before each edit as
the declaration above promised. Each file's commit names what it changed and why.

1. **The merge queue.** `src/workers/merge-queue.ts`: the integration queue reads failures against
   its base cycle under the same rule, so a parallel run does not refuse what a single run
   accepts.
2. **Tree reports.** `src/cli-gates.ts`: `swarm check` and `swarm gates` report on a tree and keep
   every gate absolute.
3. **Outcome shape.** `src/run-outcome-shape.ts`: the `checks` result and the v2 preservation
   fields in the JSON outcome.
4. **Trial runner.** `src/cli-task-goal.ts`: `programRun` exported for the reviewer's trial tool.
5. **Policy-name tests.** Tests that name the policy or rule they read, updated to its new name or
   requirement:
   - `src/gates/acceptance.test.ts`;
   - `src/gates/duplicate-titles.integration.test.ts`;
   - `src/evidence/run-assessment-deadline.test.ts`;
   - `src/workers/contract-enforcement.test.ts`;
   - `src/cli-goal-budgets.integration.test.ts`;
   - `src/cli-justification.integration.test.ts`;
   - `src/gates/base-failure.test.ts`.
6. **Check side effects.** After the mechanism study:
   - `src/gates/gate-side-effects.ts` and its test (new);
   - `src/gates/engine.ts`;
   - `src/gates/gate-runner.ts`;
   - `src/agent-run.test.ts` and `src/gates/attack-families.integration.test.ts`, whose checks
     write into the workspace and so now have that write put back.
7. **Evaluation scripts.** Under this stage's directory:
   - `docs/evidence/2026-10-24-delivery-preservation/assess-review.mjs`;
   - `audit/`;
   - the protocols.
