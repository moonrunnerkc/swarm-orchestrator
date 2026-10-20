# The repeat key's generation: a shell check repeated after an edit is answered again, 2026-10-20

Follow-up to [../repair-handoff/](../repair-handoff/README.md), whose correction `c538331f0`
named the shell tool as one whose call may write. Declared files: [scope.md](scope.md). Starting
head `33fbf1693` (pull request #90's head, merged to `v13-main` at `7fdf1edfb` before this work);
the fix is `8ce795eb8` on `fix/stall-generation-and-marked-audit`.

## 1. The defect

The repeated-call tracker (`src/core/tool-stall.ts`) keys each observation, a call and its
answer, and hands the model the "already answered" notice in place of an answer it already has.
An inspection's key carried the workspace generation, which every successful writing call
advances, so an inspection repeated after an edit was a new question. A call that may write was
keyed without the generation (so that the same write repeated would still be a repeat). When
`c538331f0` named the shell among the tools that may write, every shell command lost the
generation from its key: a check run before an edit and again after it was compared with its
own earlier answer, and when the answer was unchanged, the fresh result was replaced by the
notice.

**The command still ran.** The chokepoint executed it both times and recorded both results on
the ledger. What the model received for the second call was the notice, without the fresh
result or its evidence reference. This is feedback suppression, not skipped execution.

## 2. Reproduction through the real worker and chokepoint

`src/agent-run.test.ts`, "a shell check repeated after an edit", on a git workspace: declare
`src/greet.js`; `shell node --check src/greet.js`; `edit` the file (`'hello'` to `'hi'`, which
keeps it valid); the identical shell command; read what the model receives.

[regressions-before.txt](regressions-before.txt), produced by
[regressions-before.sh](regressions-before.sh) (a detached worktree of `33fbf1693` given the
tested commit `8ce795eb8`'s three test files and nothing else):

| case | on `33fbf1693` | on `8ce795eb8` |
| --- | --- | --- |
| shell check, successful edit, identical shell check | **the notice replaces the fresh result**: "This shell call is identical to one answered earlier ... its result is unchanged; it began: "exit code: 0"", with no evidence reference | the fresh `exit code: 0` with its own `[evidence record sha256:... kind tool-call:shell]`, a different record from the first |
| inspection, shell mutation, identical inspection (`list src`, `shell node -e appendFileSync`, `list src`) | answered (this is what `c538331f0` fixed) | answered |
| identical inspections with nothing intervening | repeat, "No writing tool call has landed since" | the same |
| repeated successful writing calls (two identical `write` calls, both landing) | repeat; the notice said nothing about writing calls | repeat; the notice says "No other writing tool call has landed between the two" |
| a denied call repeated (`shell cat .env`, denied by the guard both times) | repeat; the notice said nothing about writing calls | repeat; the notice says "No writing tool call has landed since", which the unchanged generation shows |

The same cases at the tracker (`src/core/tool-stall.test.ts`, "the state an answer concerns")
and at the loop (`src/core/loop.test.ts`, "answers a shell check repeated after an edit"): four
tracker cases and the loop case fail on `33fbf1693` and pass on `8ce795eb8`.

## 3. The rule

Whether a call may mutate files and which state its answer concerns are two facts. The tracker
now looks an observation up under the generation its call ran against and remembers it under
the generation it left behind, which a successful call that may write advances. A later
identical call is a repeat exactly when nothing else that may write landed between the two.

- A shell check repeated after an edit that landed: new question, answered.
- An inspection repeated after a shell command that landed: new question, answered.
- The same inspection, or the same denied call, repeated with nothing between: repeat.
- The same successful write or shell command repeated with nothing else between: repeat. The
  September stall (one shell command thirty-five times) is still caught.

The notices say what a repeat establishes. Of a call that did not land (an inspection, a denied
call): "No writing tool call has landed since." Of a call that landed, which is itself a writing
call: "No other writing tool call has landed between the two." The stall event carries the fact
as `landed` in place of `writes`.

Nothing undoes the shell-mutation handling (the shell stays named as a tool that may write),
nothing disables repeat detection, and no command is special-cased. No shell parser or
workspace snapshot is added.

## 4. What this does not show

The correction is reproduced on fixture conversations through the real loop and chokepoint. It is
not evidence that any repair succeeds more often; no live launch was made for it.
