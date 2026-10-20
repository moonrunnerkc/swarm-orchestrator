# Declared files: the repair trace of the planned-check trial, and one tool-feedback defect

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve` at `d6972897e`, whose product source is
`005d5eb8d`'s. It follows [../../2026-10-19/endpoint-readiness-trial/](../../2026-10-19/endpoint-readiness-trial/README.md),
whose one launch detected an `ftp://` regression live through a generated check and whose two
repair attempts did not change it. The retained workspace of that launch is read as evidence and
not modified. The main checkout's uncommitted work on `v13-main` and the other worktrees are not
touched. No protection is changed and no owner bypass is used; the branch is pushed with an
ordinary push once the work is verified.

## What this work does and does not change

The repair brief, the repair loop's step and attempt caps, the ratchet, the rollback and the
final-verification reserve are unchanged: the trace establishes that the worker was given the
failing case, the observed and expected results, the check's program, the change against the
base and a way to rerun the check, and that its tools answered correctly, with one exception
below. No planning rule is added. No model, configuration or budget changes.

The one exception is a defect in tool feedback, reproduced from the trace: a call repeated after
an edit, whose answer happened to be unchanged, was replaced by the "already answered" notice,
which told the model that nothing in the workspace had changed since, when its own edit had. The
repeated-call tracker now treats a successful write as a new workspace: an answer given before it
is not an answer the model already has, and the notice says what the harness actually knows. The
notice for a repeat with no write between stays as it was.

## Initial declaration

Product:

- `src/core/tool-stall.ts`, `src/core/tool-stall.test.ts`: the tracker's workspace generation,
  advanced by a successful writing call; the notices' wording.
- `src/core/loop.ts`, `src/core/loop.test.ts`: the loop names which tools write, from its caller,
  and passes it to the tracker per observation.
- `src/agent-run.ts`, `src/agent-run.test.ts`: the worker and repair loops name the tools the
  chokepoint classes as writing; the end-to-end case through the real chokepoint.
- `CHANGELOG.md`: the fix, under the unreleased entry.

Evidence and records, all new under `docs/evidence/2026-10-20/repair-trace/` (this directory):
the record-by-record trace of the two repair attempts, what each was given and did, the earliest
point of no useful progress, the reproduction of the feedback defect, the regressions against the
starting implementation, the gates on the tested commit, and the diagnosis with an experimental
proposal.

Documentation: `docs/claims.md` (the repeated-call row) and `docs/README.md` (the evidence index).
`README.md` at the repository root is not expected to change.

## Amendments

1. After the first push (`2be82e598`), CI's `gates (ubuntu-latest)` job failed in
   `src/agent-run.test.ts` ("a verbose command in the worker's loop"), a test this branch added at
   `334690806` and had never run on Linux: its fixture command printed 3,000 lines to a pipe and
   called `process.exit(1)`, and Linux kept 697 of them. The fixture now sets the exit code and
   lets the process end, so its output drains; nothing of the product changed. The file was
   already declared; this names the second reason it was edited.

Of the declared files, `docs/README.md` was not changed: its evidence index lists the
dated directories up to 2026-10-15 and none since, so this one is reached from the claims row and
from the trial it follows. No file outside the declaration was edited.
