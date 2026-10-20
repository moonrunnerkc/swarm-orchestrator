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
| the FTP regression | `final.patch`, the `url` rule of marked's rules file | the rule's `i` flag removed and the schemes spelled `(?:[fF][pP][tT]\|[hH][tT][tT][pP][sS]?)`: `[fF][pP][tT]` matches "fpt", so bare `ftp://` no longer links. No declared check had an ftp case; the worker's ftp tests used angle brackets, which another rule handles. |
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
steps are not replayed (it declares marked's rules file and writes the launch's delivered version whole,
so the final checks run on the exact delivered patch, digest compared), and a revision, review or
follow-up the build asks for that the launch never had is answered by a scripted turn that changes
nothing. It reproduces planning, admission, the scheduling decision, the brief, the controller's
action at completion, the final checks and the report, not the worker's search. It runs on the
real clock and is **timing-sensitive**: it is not a deterministic replay, and it was run with
nothing else running.

Results ([replay/](replay/); each file is the script's summary with the build's own records):

| | the launch (recorded) | replay, the launch's build `b148573e3` | replay, the trial's build `b470b55e2` |
| --- | --- | --- | --- |
| planner turns played | 40 | 40 of 40 | 36 of 40: the first round stopped after its second base run |
| first round | ended at 235.3 s by `max-steps` | the same path | **stopped at 203 s**: the trials took up to 37.9 s, so 136 s (60 s + 2 × 37.9 s) were held for admission and a revision |
| admission after the round | 36.5 s | as recorded | 0 s: the round's last base run of the exact same checks was reused |
| revision | withheld, 64.2 s left, 96.5 s needed | withheld, 61.2 s left, 97.6 s needed | **dispatched**, 133.0 s left, 60 s needed, nothing borrowed; the scripted revision declared nothing |
| unresolved outcomes | 7 | the same 7 | 4: the scheme example kept (`scheme-insensitivity#1`, task input `hTtPS://example.com/fhqwhgads.`, first expected `hasLink: true`, the base gave no link), the same check declared as a change expecting `hasLink: false` (`#2`), and the www sentence carrying "without changing how http://, https:// or ftp:// are detected" (`www-case-sensitivity#1`, `#2`) |
| interpretation trail | | none recorded | `scheme-case-insensitive` version 1.2 moved the task's input from `{"hasLink":true,...}` to `{"hasLink":false}` (`toRecordedBase: false`: the program changed, so the text differs from the recorded base answer) |
| the worker's brief | outcome words only; the requirement described as "...in angle brackets..." | the same | names the task's own input with the first expectation and the base's answer |
| at completion | nothing | nothing | **one follow-up**, attempt 1 of 3, recorded `outcome-follow-up-v1` (the scripted answer changed nothing; the ratchet accepted the unchanged tree) |
| status | `accepted`, scoped, exit 0 | the same | the same, with "follow-up on them: given once, as attempt 1" |

So, on the launch's own recorded planner responses, this build holds the revision's time, keeps the
task's example attached to the outcome with what was asked and what the base gave, records the
expectation moving to the base's answer, and acts on the unresolved outcomes before reporting. It
cannot show what a live revision or a live follow-up would have done with that: the recorded
planner never saw the new feedback, and the replayed worker writes the delivered file whatever it is
told. The `16ec1a7e6` replay ([launch-build-16ec1a7e6.json](replay/launch-build-16ec1a7e6.json)) is
the same but for the empty trail, which `b470b55e2` fixed.

## 3. What changed

- **The requested example survives a check's revisions.** Each outcome keeps every version of the
  check that stated it, case by case, with each case's role; its *task inputs* are the inputs of
  its role the task names verbatim (`namedByTask`), with the result first expected and the base's
  answer where a base run disputed it. It is covered only while retained checks that state it hold,
  between them, every task input, and none expects the base's disputed answer there. A check that
  for a task-named input expects exactly the base's answer after the base disputed an earlier
  expectation of the same requirement is refused at admission (`adopts-base-answer`): nothing
  separates a mistaken expectation from a base that lacks the requested behaviour, and admitted it
  would ask a repair to keep the base's answer for the task's own input. Corrections that keep the
  input stay admissible (a reclassification moves it from a kept to a changed case and still holds
  it). The same check id declared again under the same requirement and role, still quoting every
  word of the earlier statement and holding its task inputs, is one outcome; dropping a word or an
  input leaves the earlier one to be accounted for. Every change of what a check expects for a
  task-named input, version by version, is recorded (`planned-coverage-reconciled-v3`
  `interpretation`), and the brief and `plannedChecks.unresolvedOutcomes[].taskInputs` name the
  inputs. Identity is still the planner's own statements; nothing reads the task's meaning.
- **An unresolved outcome is followed up before the run reports.** Once the gates are green, an
  attempt from the sealed cap carries a brief built from the structured outcomes (words, task
  inputs, what was expected, what the base gave, why no check states it) and the choice to leave
  correct code as it is. It runs under the ratchet, rollback and budget floor of any repair, is
  given once per run however many outcomes or rewordings there are, is recorded
  (`outcome-follow-up-v1`) and reported (`outcome.outcomeFollowUp`, and a line under the status). It
  settles nothing: the outcomes stay unresolved, status and exit code keep their meaning, and it is
  not counted as a repair. A follow-up whose change is not kept leaves the work's own lifecycle, so
  a follow-up that runs out of wall cannot make a finished run read as stopped at its wall.
- **Revision scheduling inside the total.** The first round stops after a base run once less
  remains than `max(25 % of planning, 60 s + 2 × the longest base run)`; the coverage review gets
  `min(half, what is left above that)`; a revision that still does not fit may borrow the shortfall
  from implementation once, up to a tenth of the total (planning then ends by half the total, and
  the verification reserve is at most a quarter). `planned-check-revision-v2` records the measured
  admission beside the arithmetic. No minimum was lowered and the total did not change.
- **A thrown case's refusal says where, not why.** Unchanged decision; the reason and the next
  action no longer say the program was defective or that the base was unobserved.
- **The bundle verifier and a rolled-back last attempt** (found by launch 1, scope amendments 1-2):
  the run-assessment re-derivation now reads the gate runs of the cycle the ratchet decisions leave
  the workspace in, not the latest on the chain, and a follow-up not kept is not the lifecycle.

## 4. Verification before the trial

[verification.md](verification.md): on `b470b55e2`, the trial's build, `npm run gates`, `build`,
`check:packaged` and `fuzz:build` exit 0 in a clean full-history clone; 4,569 tests pass and 29 are
skipped (the same skips as before). The branch head `d491a54cd`, whose product is `005d5eb8d` (the verifier fix found
by launch 1), passes the same set: 4,570 tests pass and 29 are skipped. Earlier runs are recorded with their failures: a lint error on
`100306e86`, a run stopped by hand when a review found two defects.

[regressions-before.txt](regressions-before.txt) runs the new and changed regressions against the
starting implementation `544f643a3`. **Behavioural failures there:** it admits a check that takes
the base's answer for the task's input; it reads an outcome covered after its check moved off the
task's input onto an easier one, and when one sibling check holds only one of the two task inputs a
quote states; it turns one reworded check into three unresolved outcomes; it withholds the
launch-shaped revision instead of borrowing 32 s, also at the exact limit; it lets the first round
run into the reserve; it never follows up (six resolve-loop tests, and 8 rather than 9 model turns
in the repair run). **Failing only on new fields or wording:** the corrected-expectation test (its
coverage already held; the trail field is new), the statement records, the brief's task-input
line, the report's follow-up line, the missing follow-up module, and the thrown-assertion wording
(same refusal). Two pass there by design: the 64 s against 96 s withholding with nothing to borrow,
and keeping a statement whose words were dropped.

## 5. The boundary of a thrown case

| case | where the runner saw it | decision | test |
| --- | --- | --- | --- |
| D1's invalid operation (`'x' in string`) | check program | refused `raised-in-program` | existing |
| an assertion in the program rejecting the project's answer | check program | refused `raised-in-program`; the reason now says the throw may be a defect or an assertion and which is not established | new |
| the project throws | outside the program | the project's answer (a diagnostic of the base) | existing |
| a declared throw the project raises | outside the program | met | existing; a throw in the program never meets one |
| a thrown string, no file frame | unattributed | read as the base's answer, uncertainty noted | existing |

Only the wording overclaimed; refusing a case that returned no answer is right whatever its cause,
since a check reports by returning a value. No stack-trace classifier was added.

## 6. The two-configuration trial (live model)

[protocol.md](protocol.md), registered at `ea4623c3b` before either launch; [launches.md](launches.md).
Both on `b470b55e2`, the same base, task text, visible check, model and limits; neither was given
the reference, the hidden evaluator or an earlier candidate. Scored by the runner's hidden oracle
and by [behaviour-probe.mjs](behaviour-probe.mjs), whose reference ([probe/upstream.json](probe/upstream.json))
was frozen first and which reproduces the earlier diagnosis on the previous launch's patch
([probe/instrument-check-previous-launch.json](probe/instrument-check-previous-launch.json)).

| | launch 1, ordinary Swarm | launch 2, `--plan-checks` |
| --- | --- | --- |
| requested mixed-case example | **not linked** | not measured: nothing changed |
| FTP, bare and inline | preserved | (base: preserved) |
| `www.` rule (lower links, mixed and upper plain) | as upstream | (base: wrong) |
| email, http, `HTTP://FOO.COM`, angle brackets | as upstream | (base) |
| project test suite | **26 of 1,713 fail** (autolink spec examples, the quadratic email and emphasis guards) | (base: passes) |
| hidden oracle | **fail** | **fail** (the tree is the base) |
| final verification completed | yes: regression fail, `tests` | yes, on an unchanged tree |
| product report | `not accepted`, exit 1; scoped "nothing checked the rest of the task's wording" | `not accepted`, exit 1, "nothing changed and the run stopped as max-wall-time" |
| unresolved outcomes, follow-up | none tracked (no planning) | none: no check was declared |
| wall, tokens | 797.5 s; 3,755,780 tokens (26,238 output) | 817.7 s; 0 tokens counted (the calls never answered) |
| corrections | 3 repairs: 1 kept (still failing), 2 rolled back (it broke the visible check), 3 withheld (0 ms left); no candidate was correct on the recorded evidence | none |

**Launch 1** is a valid product failure. Its worker ran the task's example twelve times and saw it
unlinked; its first loop and both repairs that ran stopped at `max-steps` (40); its patch replaced
the url rule with a hand-built expression that keeps `ftp` and the www rule but leaves inline
mixed-case schemes unlinked and breaks 26 existing tests. The product reported that correctly. Its
bundle failed its own verifier, which was a verifier defect (section 3), fixed in `005d5eb8d`; with
the fix the same bundle verifies.

**Launch 2 is an infrastructure failure, not a measurement of `--plan-checks`.** The model server
answered the planner's first call in 1.9 s with HTTP 200 but logged "qwen tool call parsing failed"
for it, so the reply carried no tool call; the next chat requests were never processed (no slot
lines in the server log) and returned HTTP 500 after 4 min 9 s and 8 min 6 s, while `/v1/models`
kept answering, so the runner's endpoint watch did not halt. A trivial chat request afterwards also
hung for 90 s ([launch-2/ollama-server-excerpt.txt](launch-2/ollama-server-excerpt.txt)). Under the
protocol it is not replaced; the allowance (2 launches, 26.9 of 30 agent-minutes) is used.

So neither configuration delivered a correct patch, and planned checks showed no observed benefit:
the one valid launch was the ordinary one, and the planned-check launch never reached a model
answer. The earliest concrete failure of the valid launch is in implementation, not planning: a
40-step worker loop that rewrote the url rule, saw the task's example still unlinked and did not
reach a change that links it without breaking the suite.

## Remaining limitations

- The follow-up and the revision scheduling are shown on recorded responses and scripted models
  only; no live launch exercised them (launch 2 never got a model answer).
- Task inputs are inputs the task names verbatim; an example the planner paraphrases, or wraps
  inside its program (the launch's program wrapped the URL in `(See ...)`), is matched by the
  input it passes, not by meaning.
- `adopts-base-answer` refuses a correction to the base's answer on a task-named input even where
  the first expectation was the wrong one; the outcome then stays unresolved and is followed up,
  which costs an attempt and never forces a code change.
- `toRecordedBase` is exact text equality; a changed program that prints another shape is recorded
  as a change without that flag.
- The follow-up's brief is information; a worker can still answer it with prose and no change, and
  the outcome then stays unresolved, accurately reported.
- The runner's endpoint watch reads `/v1/models`, which kept answering while chat completions hung.

## Next action

Make the comparison runner halt a launch when chat completions stop being answered (a bounded
completion probe beside the `/v1/models` watch), so a wedged model server is recorded as an
infrastructure halt rather than consumed as a launch; then, under a new protocol, run the
`--plan-checks` configuration once on this build.
