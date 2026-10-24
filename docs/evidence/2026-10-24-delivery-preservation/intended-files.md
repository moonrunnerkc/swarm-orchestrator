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
