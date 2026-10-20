# Declared files, repair-value follow-up to PR #89

Declared before the first edit of this work, on `fix/repair-trust-and-first-run` at
`f556b6313` (PR #89's head on GitHub is `c69e14d4a`; the ten commits between are local). Additions
are appended below as amendments, each naming every file it adds, before that file is edited. The
main checkout's uncommitted work on `v13-main` (an agent-instructions module and planner and
controller edits) is not part of this work and is not touched.

## Initial declaration

Evidence and records:

- `docs/evidence/2026-10-19/repair-value/` (this directory): the reconstruction of every O1
  candidate and its external scoring, the deterministic replay of O1's transitions through the
  prior and current controllers, the policy audit's records, the new protocol, its launch ledger,
  every launch's records and the per-candidate scoring, and the PR description.
- `docs/evidence/2026-10-18/checking-semantics/README.md`,
  `docs/evidence/2026-10-18/checking-semantics/launches.md`: appended corrections where the
  earlier account of O1 is incomplete; the original text, the protocol and the frozen verdicts
  stay as written.

Product files are not declared here. A product change is made only for a failure reproduced
first, and each file it needs is added by amendment before it is edited.

## Amendments

### 1. The hold rule, after its failure was reproduced

The current rule holds a changed case once a repair leaves its answer unchanged, and then stops
repair under the `instrument` class, the class made for a demonstrated checking-program defect.
A repair that changed code and has not yet moved the answer is held too (2026-10-18 launch 4's
repairs 1 and 2 each edited `src/Mime.ts`). The tests below reproduce that before any product
edit. Files added:

- `src/cli-task-goal.ts`, `src/cli-task-goal.test.ts`: a changed case is held only on the tree
  it was already told to a repair on, so a repair that changed the code is never held for an
  unchanged answer.
- `src/gates/repair-policy.ts`, `src/gates/repair-policy.test.ts`: the stop where every failure
  is held gets its own class, apart from `instrument`.
- `src/gates/auto-resolve.ts`: repair stops on that class as it stopped on `instrument`.
- `src/cli-planned-checks.integration.test.ts`: a legitimate repair that takes two changes, and a
  wrong expectation that repeated code changes cannot satisfy, through the ordinary command line.
- `CHANGELOG.md`: one line under 14.5.0 (unreleased) for the changed stop.

### 2. A relation that passed first outranks base-backed behaviour, after its failure was reproduced

[policy-audit/relation-limit.mjs](policy-audit/relation-limit.mjs), on `f556b6313` with no model:
the planner's newline-to-space relation over the custom-extension fixture (false there for a
correct implementation) passes launch 4's space normalization, and the correct repair, which
restores a kept case the base gives, is rolled back because it broke that relation. A part that
rests on the planner's claim of the change (a relation whose base control failed) now yields to
an attempt that turns a failing part the base or a supplied check backs into a pass; nothing else
about parts changes. The verifier re-derives the yield from the recorded decision. Files added:

- `src/gates/gate-definition.ts`: a reading names which of its parts are claims.
- `src/gates/parsers.ts`, `src/gates/parsers.test.ts`: the inspection parser reads that list.
- `src/gates/gate-runner.ts`: a run and a cycle carry it.
- `src/gates/ratchet.ts`, `src/gates/ratchet.test.ts`: the yield, recorded on the decision.
- `src/evidence/verifier/rederive.mjs`, `src/evidence/rederive.test.ts`: the same rule, re-derived
  from the decision's own payload; a decision recorded before claims re-derives as it did.
- `src/gates/auto-resolve.ts` (already declared): passes the claims to the ratchet.
- `src/cli-task-goal.ts` (already declared): the diagnostics gate names its claim parts.

### 3. The argument probe refuses a valid program, after its failure was reproduced

[policy-audit/probe-before.txt](policy-audit/probe-before.txt): a preservation whose program reads
`word.input` and falls back to `word` (`word.input ?? word`), with every answer legitimately null,
is dropped as `argument-shape`. Files added:

- `src/workers/planned-check-program.ts`, `src/workers/planned-check-program.test.ts`: a second
  probe pass with `input` answering the value itself.
- `src/cli-planned-checks.ts`, `src/cli-planned-checks.test.ts`: admission refusing only where
  that pass's answers differ from the check's.

Withdrawn before commit: on the base, launch 5's broken program (`kindOf(case_.input)`) answers
the second pass as the valid one does (`kindOf('Apple')` is null there too), so the change admitted
the very defect the refusal exists for, and the drop test failed. Where the project answers the
input and `undefined` alike on every case, no answer tells the two programs apart; only tracing the
project's calls could, which this work does not add. `src/workers/planned-check-program.ts` and
its test are left unchanged. In `src/cli-planned-checks.ts` only the refusal's reason changes: it
says that a program falling back to the value is not told apart and is refused rather than
trusted. The test (in `src/cli-planned-checks.integration.test.ts`, already declared) holds that
the refusal and its revision are admitted.

### 4. The changelog's extent

No new file. `CHANGELOG.md` (declared in amendment 1 as one line) instead edits the two unreleased
14.5.0 bullets whose behaviour this work changes: the argument probe's refusal and the held case,
which now carries the stop's class and the relation's yield.

### 5. The measurement history and the review description

Added while launch R1 ran; no product file.

- `docs/agent.md`: one entry in the measurement history, as each earlier piece of this work has.
- `docs/evidence/2026-10-19/repair-value/pr-description.md` (in the declared directory): the
  updated description of PR #89.
