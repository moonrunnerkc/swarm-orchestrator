# Declared files: two tool-feedback corrections, one bounded repair-handoff experiment

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve` at `3cdfc34b9` (draft pull request #90, whose
head that is), in the worktree `.claude/worktrees/repair-trust`. It follows
[../repair-trace/](../repair-trace/README.md), whose fix `e7c60c7a6` keyed the repeated-call
tracker by a workspace generation that a successful writing call advances, and whose section 7
wrote down one experimental brief change without building it. The retained workspace of the
trial launch and the recorded chains are read as evidence and not modified. The main checkout's
uncommitted work on `v13-main` and the other worktrees are not touched. No protection is changed
and no owner bypass is used; the branch is pushed with an ordinary push once the work is verified.

## What this work changes

1. **Tool feedback, two corrections** (independently justified; kept whether or not the
   experiment helps). The worker names as writers only the tools the chokepoint classes as kind
   `write`; the shell tool is kind `shell`, so a shell command that edits a file does not advance
   the tracker's generation and a check repeated after that edit can still be told it was already
   answered. And a writing call is keyed without the generation, so a successful writing call
   repeated is told "No writing tool call has landed since" although writing calls did land. Both
   are reproduced through the real loop and chokepoint before any change.
2. **The repair handoff, one experiment.** The account of the previous loop keeps the shell
   commands that printed nothing or exited non-zero and drops the ones that printed something and
   exited zero; in the recorded run that dropped the attempt's decisive measurements. A small,
   deterministic selection of recent nonempty successful shell results is added to the account,
   with the selection and its bounds defined before any trial outcome is seen. One matched pair of
   development launches (control without it, treatment with it) asks whether a fresh repair attempt
   given those results turns the retained incorrect candidate into a correct patch.

The repair brief's other content, the step and attempt caps, the ratchet, rollback and the
final-verification reserve are unchanged. No planning rule, model, server configuration or
budget changes. No judge, ranking or semantic selection is added.

## Initial declaration

Product:

- `src/core/tool-stall.ts`, `src/core/tool-stall.test.ts`: the notices say "no writing tool call
  has landed since" only of a repeated inspection; a repeated call that may write is described as
  repeated with an unchanged result and nothing more. The stall carries whether the repeated call
  may write.
- `src/core/loop.ts`, `src/core/loop.test.ts`: the loop hands the tracker's knowledge of the
  repeated call to both notices.
- `src/agent-run.ts`, `src/agent-run.test.ts`: the worker names every tool whose successful call
  may change workspace files, the shell tool included, as a writer; the end-to-end cases through
  the real chokepoint on a git workspace (a shell command that edits a file, repeated successful
  writes, an unchanged repeated inspection).
- `src/core/loop-account.ts`, `src/core/loop-account.test.ts`: the recent nonempty successful
  shell results, bounded, with command, exit status, bounded output, evidence reference and the
  loop's later edits named; described as historical observations.
- `CHANGELOG.md`: both entries, under the unreleased version, kept apart.

Evidence and records, all new under `docs/evidence/2026-10-20/repair-handoff/` (this directory):
the reproductions against the starting implementation, the deterministic account built by the
production builder from the recorded attempt, the protocol and launch ledger of the matched pair,
the experiment driver, each arm's record, patch, scores and packed streams, the verification on the
tested commits, and the reading of the result.

Documentation: `docs/claims.md` (the repeated-call row and, if the experiment is retained, a row
for the handoff); `docs/evidence/2026-10-20/repair-trace/README.md` gains an appended corrections
section naming what this work found about its reading (its text above that section is not
rewritten). `README.md` at the repository root is not expected to change.

## Amendments

1. `scripts/check-doc-paths.mjs`: one known-path entry, `src/rules.ts`, a file of the marked task's
   repository that [protocol.md](protocol.md) names in describing the scripted worker. The protocol
   is not edited after its first launch, so the mention is declared known with its reason, as the
   mime task's `src/Mime.ts` is for the 2026-10-18 protocol. Found by the first `npm run gates` on
   `6504522be`, which stopped at the documentation-path check ([verification.md](verification.md)).
