# Declared files: the repeat key's generation, the Marked patch audit, one ordinary comparison

Declared before the first edit of this work, on the local branch
`fix/stall-generation-and-marked-audit`, cut from `origin/v13-main` at `7fdf1edfb` (the merge of
pull request #89, which carries pull request #90's head `33fbf1693`), in the worktree
`.claude/worktrees/repair-trust`. The assignment names #90 as a draft to update; it was merged at
2026-10-20 23:08 UTC, before this work began, so the work is published as a new branch and a new
draft pull request against `v13-main`, with that difference stated. The main checkout's
uncommitted work on `v13-main` and the other worktrees are not touched. No protection is changed,
no owner bypass is used, nothing is force-pushed or merged.

## What this work changes

1. **The repeated-call tracker's comparison rule.** `c538331f0` named the shell tool as one whose
   call may write, and the tracker keys a call that may write without the workspace generation.
   So a shell check repeated after an edit is compared with its answer from before the edit, and
   the fresh result is replaced by the "already answered" notice. The command still runs and is
   recorded; what is withheld is its fresh answer. The rule is corrected so that every observation
   is keyed by the state it concerns, and a successful call that may write advances that state
   after it is keyed: whether a call may mutate files and which state its answer is about are kept
   as two facts. Repeat detection is kept for a call repeated with nothing else landing between.
2. **An audit of the delivered Marked patches** of the repair-handoff pair, appended and dated,
   with the original scores preserved: the URL rule's scheme alternative is optional before `://`.
3. **One fresh ordinary comparison**, Swarm against OpenCode, on the first eligible unused task
   under a rule written before the task is read, registered before any inference.

## Initial declaration

Product:

- `src/core/tool-stall.ts`, `src/core/tool-stall.test.ts`: the key carries the generation for
  every observation; the notices say what a repeat establishes.
- `src/core/loop.ts`, `src/core/loop.test.ts`: the loop hands the notice whether the repeated
  call landed as one that may write.
- `src/agent-run.test.ts`: the end-to-end cases through the real chokepoint on a git workspace
  (a shell check repeated after an edit, an inspection repeated after a shell command, repeated
  successful writes, an unchanged repeated inspection, a denied call repeated).
- `CHANGELOG.md`: the correction, and the corrected summary of the repair-handoff pair.

Evidence and records:

- `docs/evidence/2026-10-20/repeat-key/` (this directory): the reproduction against the starting
  head `33fbf1693` and the reading.
- `docs/evidence/2026-10-20/repair-handoff/`: an appended audit file, with its reproduction
  script and output, and corrections appended to `README.md` and `launches.md`; nothing above
  the appended sections is rewritten, and the patches, probes and records are not modified.
- `docs/evidence/2026-10-20/ordinary-comparison/`: the selection rule, protocol, frozen
  manifest, launch ledger, each arm's record, patch and evaluation, and the verification.
- `docs/claims.md`: the repeated-call row and the repair-handoff row, if one is affected.

## Amendments

(none yet)
