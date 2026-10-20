# The requested example through revisions, a follow-up on unresolved outcomes, and revision scheduling, 2026-10-19

Follow-up to [outcome-coverage](../outcome-coverage/README.md), on the local branch
`fix/requirement-coverage-and-verification-reserve`. Declared files: [scope.md](scope.md). Three
kinds of evidence stay apart: **deterministic** (no model, injected clock or scripted model in
tests), **replayed** (the launch's recorded planner responses through a build, real clock, no live
model) and **live-model** ([protocol.md](protocol.md), [launches.md](launches.md)).

## 1. The launch's failure, record by record

Read from the launch's restored chains (`node scripts/evidence-pack.mjs restore
../outcome-coverage/launch/packed-derived/launch-streams`; both hash chains and every blob verify).
**P** is the planning chain `20261019T234011-b6b0a1-plan`, **R** the run chain; numbers are record
sequences.

| step | record | what it holds |
| --- | --- | --- |
| the request | P 0 `session-started` | "...so "(See hTtPS://example.com/fhqwhgads.)" must still produce a link with the trailing period excluded. Make "www." detection case-sensitive without changing how http://, https:// or ftp:// are detected..." The base gives `<p>(See hTtPS://example.com/fhqwhgads.)</p>`, no link. |
| first check of it | P 148/149, base run P 177/178, admission P 192 (`planned-check-admission-v4`) | `scheme-case-insensitive`, **preserve**, no quote; program wraps each input in `(See ...)` and tests `html.includes('<a href="https://')` (lower case, which a correct fix that keeps `hTtPS` also fails); case 1 is the task's URL. Refused `disagrees-with-base`; case 1 `namedByTask: true`, base `{"hasLink":false,...}`: "The task names the input of case 1 itself, so the outcome it states there may be the one it asks for." |
| expectation changed to the base's answer | P 222/223, base run P 246, admission P 260 | the same id, now **change**, quoting the whole sentence, every case `changed: true` but expecting `hasLink: false`, the base's answer (its own `why` says the behaviour "changes from no-link to link"). Refused `does-not-detect`: the base passes it. |
| moved to angle brackets | P 266, then P 272/273; planner stops at P 286 (`max-steps`, +235.3 s); admission P 308 | the same id, **preserve**, quoting only "Scheme autolinks must remain case-insensitive for the scheme", inputs `<hTtPS://example.com/>` and `<HTTPS://Example.COM/path>`. Refused `disagrees-with-base` again (the lower-case matcher; the base does link these). No version of any check holds the task's example any more. |
| revision withheld | P 309 `planned-check-revision-v1` | `{"remainingMs":64227,"neededMs":96489}`: planning had 336 s (40 % of 14 min); the first round's share was 252 s; it ended at 235.3 s; admission took 36.5 s; the revision needs admission again plus 60 s. The coverage review had been withheld too (P 287, 101 s left, 120 s needed). The whole run still had 568 s to its deadline. |
| unresolved information given to the worker | P 310 `planned-coverage-reconciled-v2`; R 2 `plan-checks-v1`; R 18/19 brief | 7 unresolved outcomes, three of them the scheme behaviour (`#1` quoting nothing, `#2` the example sentence, `#3` the fragment) and two that are restatements; every one's next action "check it yourself on the task's own example". The brief's sealed "Required behavior" for the requirement read "mixed case schemes **in angle brackets** still produce links" (the last version's description). |
| the worker runs the example | R 193 (shell), R 195 (result) | its own script prints `mixed case httpS link output: <p>(See hTtPS://example.com/fhqwhgads.)</p>`, no link. |
| explanation and completion | R 199, R 205, R 249, R 250 | "test 6 shows that `(See hTtPS://...)` did NOT produce a link. That's because angle-bracket autolinks go through the `autolink()` method..."; then it tests only angle-bracket inputs, which link, and finishes: `session-stopped`, `completed`, a turn with no tool call. |
| the FTP regression | `final.patch`, `src/rules.ts` `url` rule | the rule's `i` flag removed and the schemes spelled `(?:[fF][pP][tT]\|[hH][tT][tT][pP][sS]?)`: `[fF][pP][tT]` matches "fpt", so bare `ftp://` no longer links. No declared check had an ftp case; the worker's ftp tests used angle brackets, which another rule handles. |
| final verification and status | R 252-256 build/lint/tests passed; R 274 `task-acceptance` passed; R 275 `task-diagnostics` passed; R 273/300 `independent-verification` passed; R 301 `run-assessment` | `outcome: accepted`, exit 0, scoped "the supplied contract's reading only: 7 requested outcome(s)...". The runner's hidden oracle: **fail**. |

**Four conditions, kept apart.** An *unavailable* check (structured: `goal-check.observation.unavailable`,
`gate-run.unavailable`, `independent-verification.unmeasured`; none occurred). A *failing
executable* check (structured: `goal-check.status`, the gates' status; it drives repair, but every
gate passed here). An *unresolved interpretation* (structured: P 310 `unresolvedOutcomes`, R 2
`plan-checks-v1.admission.unresolvedOutcomes`; it reached the worker only as prose in its brief, and
no controller code read it: the outcome status, the gates engine and the agent run never saw it).
A *confirmed task failure*: only raw tool output and model prose (R 195, R 199) during the run, and
the runner's hidden verdict outside it; nothing linked R 195 to the outcome. Completion came from
the model's turn with no tool call; repair was never asked because nothing a gate measured failed.

Whether a revision, had it run, would have produced a correct check or a correct patch is not
established by any of this.

## 2. The launch replayed through its own build (no live model)

[launch-replay.mjs](launch-replay.mjs), adapted from the D1 replay, serves the launch's 40 recorded
planner responses in order, each held for its recorded response time, through the repository's
scripted endpoint; the build runs its ordinary command line with the launch's flags on a workspace
the comparison runner's helpers prepare from the launch's frozen manifest; admission runs the
recorded programs on a real checkout of the marked base. **Disclosed adapters:** the worker's
steps are not replayed (it declares `src/rules.ts` and writes the launch's delivered version whole,
so the final checks run on the exact delivered patch, digest compared), and a revision, review or
follow-up the build asks for that the launch never had is answered by a scripted turn that changes
nothing. It reproduces planning, admission, the scheduling decision, the brief, the controller's
action at completion, the final checks and the report, not the worker's search. It runs on the
real clock and is **timing-sensitive**: it is not a deterministic replay, and it was run with
nothing else running.

