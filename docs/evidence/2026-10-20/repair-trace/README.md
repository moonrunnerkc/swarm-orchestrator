# Why the repair did not fix the `ftp://` regression: the trace, one feedback defect, and what is not a product defect, 2026-10-20

Follow-up to [../../2026-10-19/endpoint-readiness-trial/](../../2026-10-19/endpoint-readiness-trial/README.md),
on the local branch `fix/requirement-coverage-and-verification-reserve`. Declared files:
[scope.md](scope.md). Its one launch (Swarm with `--plan-checks`, build `826e60e83`, product source
`005d5eb8d`, model `local:qwen3.6:35b-a3b`, run `20261020T045117-41e2cc`) delivered a patch that
passes the hidden oracle and regresses `ftp://`, which the product's own generated check caught
live; two repair attempts then left the code as it was. This document reads those attempts record
by record, says what each was given and did, names the earliest point of no useful progress,
reproduces the one implementation defect the trace supports, and keeps the model's mistake a
model's mistake.

Three kinds of evidence stay apart: **recorded** (the launch's chains, restored with
`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-19/endpoint-readiness-trial/launch-1/packed-derived/launch-1-streams`
and read as they are; **R** is the run chain, record numbers are its sequence numbers, times are
seconds from its first record), **deterministic** (the check program run on a disposable clone of
the retained workspace, and fixture loops through the real code), and **the earlier verdicts**,
preserved: the hidden oracle passed the patch and the frozen behaviour probe rejected it
([../../2026-10-19/endpoint-readiness-trial/probe-launch-1.json](../../2026-10-19/endpoint-readiness-trial/probe-launch-1.json)).
The retained workspace `~/swarm-comparison-work/marked-bugfix-www-case.swarm-oKlU9D/workspace` was
read and cloned, not modified; its `rules.ts` still carries the delivered bytes.

## 1. Lead

- **What prevented the repair:** the model could not read its own character class. It wrote
  `[fF][pP][tT]` for the scheme `ftp` in the first loop (R 131), saw `FTP://example.com/file`
  come back unlinked from its own check (R 168) and claimed completion anyway (R 173), and in
  two repair attempts never saw that the class spells `fpt`. Attempt 1 spent 40 steps, 33 of them shell inspections,
  testing that class against `ftp` and reading `null` each time, and made no edit. Attempt 2
  named the class as the problem in its first sentence, reverted it, saw the project tests fail
  on the reversion, and wrote the identical class back; the wall ended before it checked.
- **Established, not a hypothesis:** the brief was complete and accurate (section 3), every tool
  answered correctly except one notice (section 5), no edit was refused, no candidate was rolled
  back, and no limit cut off useful work: at the step cap the state was the unchanged candidate
  with no edit proposed, and at the wall the state was the same candidate re-created by the
  model's own edit. The transposition is the model's: the same class appears in three independent
  generations across two launches (section 2).
- **What changed:** one tool-feedback defect reproduced from the trace, fixed and regressed. A
  call repeated after an edit, whose answer happened to be unchanged, was replaced by the
  "already answered" notice saying nothing in the workspace had changed since (R 598), when the
  model's edit had landed at R 592. The tracker now reads a successful writing call as a new
  workspace. It cost the repair one step; it is not what kept the repair from the fix, and this
  document says so wherever it names it.
- **Matched trials:** not run. The fix does not touch what the trace shows failed, so two live
  trials of it could show nothing about the repair; section 7 says what an experimental brief
  change would be and why it is not implemented here.
- **The delivered patch** of that launch remains incorrect by the task's words and the probe,
  and correct by the hidden oracle. Nothing here rewrites either verdict.

## 2. The candidate and the failing check

The first loop (R 30 to R 197, 27 steps) edited the task's `rules.ts` twice (R 131 `url`, R 137 `text`),
replacing the `i` flag on the GFM `url` rule with explicit classes, and spelled the scheme
`[fF][pP][tT]`. Its own checks (R 142 to R 172) ran the build, the visible check, the task's example, the
`www.` cases, the project's suite, and one `ftp` case: `FTP://example.com/file`, which came back
as plain text at R 168, two lines above `HtTp://example.com` linked. The next turn (R 173) read
the output as "All four requirements are met". The regression was on the model's screen before
any gate ran. The gate cycle (R 199 to R 220) passed everything but `task-diagnostics`:

> generated check scheme-autolink-case-insensitive rejected: exit status 0 as expected; stdout
> differs from the expected 4 line(s): line 3 should be `{"input":"Ftp://ftp.example.net/file","result":"linked"}`
> but was `{"input":"Ftp://ftp.example.net/file","result":"not-linked"}`; case(s) 3 are behaviour
> the task keeps, which the unchanged base gave as expected (R 220)

**The check's expectation is supported.** The task says "without changing how http://, https://
or ftp:// are detected"; the case is a kept one, admitted because the unchanged base gave the
expected answer (the admission in the planning chain; R 216 is the check's run on the candidate).
On a disposable clone of the retained workspace at the base `f12c61d`, the check's own program
(R 249 quotes it) gives, deterministically:

| input | base | base + [the delivered patch](../../2026-10-19/endpoint-readiness-trial/launch-1/final.patch) | base + `[fF][tT][pP]` (the investigator's control, given to no model) |
| --- | --- | --- | --- |
| `Ftp://ftp.example.net/file` | linked | **not-linked** | linked |
| `ftp://example.com/file` | linked | **not-linked** | linked |
| `(See hTtPS://example.com/fhqwhgads.)` (the task's example) | not-linked | linked | linked |
| `https://example.com`, `HTTP://example.com`, `hTtP://Mixed.Example.com/path` | linked | linked | linked |
| `www.example.com` / `Www.example.com` / `WWW.example.com` | linked / linked / linked | linked / not-linked / not-linked | linked / not-linked / not-linked |

The control also passes the visible check. So the regression is real, detected by the real
runner through a kept case, and two characters from correct. The same transposition was written
by the same model in the earlier trial's ordinary launch ([../../2026-10-19/outcome-coverage/launch/final.patch](../../2026-10-19/outcome-coverage/launch/final.patch))
and again by attempt 2 below (R 591): three generations, one spelling.

## 3. What each repair attempt received

Both briefs are R 221 and R 513, whole in the chain; what follows is read from them, not from the
code that builds them. Each carried, in this order: the task text and the sealed objective; the
four requirements; the three outcomes no generated check exercises (the `www` cases and the
task's example, with the base's answers and the instruction to run the project on them); the
effective contract (tools `read`, `write`, `edit`, `list`, `search`, `shell`; 40 steps; 840 s;
`acceptance/visible` and `test` immutable); "A quality gate is failing. This is attempt N of 3"
with the ratchet's terms; the base commit; the change against it as a unified diff, both hunks
whole; the cycle checked and the remaining allowance; the `run_check` tool's description; the
harness's account of the previous loop; and the gate's whole stdout and stderr, the failing line
quoted with its expected and observed results. Nothing in either brief was truncated (the gate
output is 1.7 KB against a 16 KB bound), neither carries a redaction marker, and the system
prompt and tool list were those of the first loop (R 222 and R 514 cite the same digests as R 30).
No compaction happened in either attempt (every transcript component in R 221 to R 609 is a
message).

| | attempt 1 (R 221 to R 489) | attempt 2 (R 513 to R 609) |
| --- | --- | --- |
| remaining allowance in the brief | 5,807,911 tokens and 226,852 ms | 4,901,354 tokens and 44,464 ms |
| account of the previous loop | the first loop: completed after 27 steps, edited the task's `rules.ts`, the one shell command that exited non-zero, the one refused claim | attempt 1: `max-steps` after 40 steps, "files it edited: none", the commands that printed nothing or exited non-zero |
| rollback feedback | none: nothing had been rolled back | none: attempt 1 was accepted by the ratchet (R 512), its candidate unchanged |
| `run_check` on the failing check | used once, R 236 to R 249: the whole program, each input, expected and observed, the differing case marked | not used |

The information a repair should have was there: the concrete failing case and observed output,
the check program and its basis (a kept case the base passed), the change against the base, the
preceding attempt's account, and a way to rerun the check. The second attempt's allowance was
44.5 s, above the 42 s floor below which an attempt is withheld (840 s / 20); the ratchet, the
gates and the reserve for the final cycle (34.3 s, R 489 `reservedForGatesMs`) behaved as
designed.

## 4. What each attempt did

**Attempt 1: 40 steps, 147 s, 906,557 tokens, stop `max-steps`, no edit.** Reads 4, search 1,
`run_check` 1, list 1, shell 33; no call was refused.

| records | what happened |
| --- | --- |
| R 224 to R 249 (+481 s to +513 s) | read the task's `rules.ts` and the visible check; `run_check scheme-autolink-case-insensitive`: the program, the four cases, `Ftp://ftp.example.net/file` marked as differing |
| R 254 (+519 s) | **the misreading**: "I changed to `[fF][pP][tT]` ... That is actually fine for case insensitivity" and the analysis turns to the `[hH][tT][tT][pP][sS]?` class and the outer `?`. Every later step rests on this |
| R 260 to R 268 | reads the lines again, hex-dumps line 411 (`5b66 465d 5b70 505d 5b74 545d` = `[fF][pP][tT]`, read back as correct) |
| R 274 to R 349 | ten shell steps looking for how to load the built library (`lib/marked.cjs` does not exist; the UMD exports nothing under `require`; the ESM import works at R 349) |
| R 355 to R 356 | the first useful measurement: the eight-case table from the built library, `Ftp://` and `ftp://` not linked, everything else as the task asks |
| R 362 to R 377 | the regex alone: `Ftp://` null, `ftp://` null, `FtP://` null, `Https://` matches. Two scripts mangled by shell quoting on the way (R 363 a backtick substitution, R 404 an escaping loop) |
| R 383 to R 384 | `/^([fF][pP][tT])/` on `Ftp:`, `ftp:`, `FTP:`: false, false, false |
| R 390 to R 391 | `[fF]`, `[pP]`, `[tT]` tested one at a time: each true; "combined ftp: null" |
| R 397 to R 411 | the file's line read back again; `/^([fF])([pP])([tT])/.exec('ftp')` null |
| R 416 to R 438 | the three classes tested singly again; `/^[f][p][t]$/.test('ftp')` false; `/^ft/` matches, `/^[fp]/` matches |
| R 443 to R 464 | "Hmm, `/^[fF][pP][tT]/` test('ftp') returns false?! That can't be right"; the source's char codes dumped (all plain ASCII); a wrong theory about `edit()` replacing `email` twice |
| R 469 to R 483 (+615 s to +622 s) | **the decisive measurement, twice**: `/^([fF][pP])/.exec('ftp')` is null (R 477, R 483). The prefix `[fF][pP]` does not match `ft`. The step cap ends the loop at R 489 before any conclusion is drawn from it |

Candidate evaluation: the gate cycle R 490 to R 511 on the unchanged tree; the ratchet accepted
(R 512, no measure moved); diagnostics failed identically. No rollback: there was nothing to roll
back.

**Attempt 2: 16 steps, 50 s, 291,211 tokens, stop `max-wall-time`, two edits that net to the
original bytes.** Reads 3, search 4, shell 7, edit 2; no call was refused.

| records | what happened |
| --- | --- |
| R 518 (+665 s) | first words: "The issue is that I made the FTP regex case-insensitive (`[fF][pP][tT]`) but this makes it too specific and doesn't match `ftp://` in all cases" (the class is named; the reason given is wrong) |
| R 524 to R 525 (+674 s) | **edit 1**, 12.4 s after the brief: both rules back to the base's spelling `ftp|https?` with the `i` flag left off. An ineffective edit: it makes every scheme case-sensitive |
| R 530 to R 537 | build and visible check pass; `npm test` fails (`HTTP://FOO.COM` no longer links), the excerpt bounded with the record named for the rest |
| R 543 to R 574 | searches for the failing spec, reads `test/specs/new/autolinks.md` |
| R 579 to R 586 | `git diff` against the base, reads the lines: "My changes reverted the scheme detection back to case-sensitive... For schemes use character classes `[fF][tT][pP]` etc." (the prose spells it right, once) |
| R 591 to R 592 (+702 s) | **edit 2**: both rules rewritten with `[fF][pP][tT]` and `[hH][tT][tT][pP][sS]?`, byte for byte the original candidate |
| R 597 to R 598 | build and visible check again, the same command as R 530: **answered with the "already answered" notice**, "Nothing in the workspace changed since" (section 5) |
| R 603 to R 604 (+705 s) | the same command with `2>&1` moved: runs, passes |
| R 609 (+712 s) | the wall ends the loop before `run_check` or `npm test` ran on edit 2 |

Candidate evaluation: R 610 to R 631 on the re-created candidate; the ratchet accepted (R 632);
diagnostics failed identically; escalated at 2 of 3 attempts because the wall was spent (R 635).
Final verification completed on that tree (R 656 to R 658) and the run reported `not accepted`.

**Of the five possibilities the question separates:** attempt 1 is *no proposed correction*
(and *repeated inspection without a useful next action*: 33 shell steps, none refused, none
repeated verbatim, so the repeated-call tracker had nothing to catch). Attempt 2 is *an
ineffective edit* followed by *the original defect re-created*. There was *no refused edit*, *no
correct edit rolled back* (no edit was ever correct), and *no useful work cut off by a limit*: at
R 489 nothing had been proposed, and at R 609 the workspace held the original bytes by the
model's own hand. An earlier stop would have been the same wrong code sooner. The 44.5 s
allowance of attempt 2 is a consequence of attempt 1 spending 147 s of the shared wall on
inspection, and raising either cap is not supported by this trace.

**The earliest concrete point where repair stopped making useful progress is R 254** (+518.8 s,
the first analysis after `run_check`): the class is read as correct, and no later step revisits
that reading, though R 377, R 384, R 391, R 411, R 438, R 477 and R 483 each contradict it.

## 5. The one implementation defect the trace supports, reproduced

At R 530 the model ran `npm run build:esbuild && node acceptance/visible/check.mjs 2>&1` (exit 0,
"visible check passed"); at R 592 its edit landed ("replaced 1 occurrence(s) in src/rules.ts"); at
R 597 it ran the same command and the chokepoint recorded the same output; the loop handed the
model, in that answer's place:

> [harness notice: already answered] This shell call is identical to one answered earlier in this
> conversation (once now), and its result is unchanged; it began: "exit code: 0". The full result
> is above. Nothing in the workspace changed since. Act on the answer you have ... (R 598)

The sentence "Nothing in the workspace changed since" was false: the model's own edit had changed
the task's `rules.ts` between the two calls. The tracker (`src/core/tool-stall.ts`) compared the call and
its answer with its recent window and nothing else, and its own header promised what it did not
do ("a reread after an edit is novel, because the edit was"): that held only when the answer
differed. Here the model did not take the notice at its word: it re-ran the command with `2>&1`
moved (R 603) and got the real answer, one step and one second later. The defect did not decide
this repair. It is a false statement of workspace state in tool feedback, on the path a repair
that edits and reruns a check will take every time its rerun happens to pass, and that is the
path a correct repair takes.

**Reproduced deterministically, through the real code, on the starting implementation
`d6972897e`** ([regressions-before.txt](regressions-before.txt), [regressions-before.sh](regressions-before.sh)):
the tracker alone (`src/core/tool-stall.test.ts`, "an answer given before an edit"), the loop with
a fixture model and recording invoker (`src/core/loop.test.ts`, "answers a call repeated after an
edit"), and the whole worker through the real chokepoint on a git workspace (`src/agent-run.test.ts`,
"a call repeated after an edit": `list src`, `edit src/greet.js`, `list src` again, whose listing
the edit does not change). Three of the four failures there are behavioural: the repeat count is
1 where it should be 0, and the notice stands in the answer's place in both loops. The fourth
fails on wording only (the notice's new sentence). The two guard cases pass on both: the same
inspection repeated with no edit between is still a repeat, and the same edit repeated is too.

**The change** (`e7c60c7a6`): the loop is told, by its caller, which tools write (`stall.writers`,
the names of the tools the chokepoint classes as kind `write`; the loop names no tool itself and
core still imports nothing of tools); the tracker keeps a workspace generation that a successful
writing call advances, keys every inspection with it and every write without it, so an inspection
repeated after an edit is new and a write repeated is not; and both notices say what the harness
knows, "no writing tool call has landed since", rather than that nothing changed. The window,
threshold, one-notice allowance, stop, compaction `forget`, and the chokepoint's recording of
every call whole are unchanged; the planner's loop, which passes no writers, behaves as before.
`run_check` is classed `write` by the chokepoint because it runs code, so a repeat after it is
also read as new: a loss of one repeat's sensitivity in that direction, on the side of answering.

## 6. What is not a product defect

- **The brief.** It carried the failing input, both results, the basis of the expectation, the
  diff, the previous attempt's account and the rerun tool, untruncated. Attempt 1 used the rerun
  tool and quoted the differing case back correctly before misreading its own class.
- **The tools.** Every read returned the file; every shell command ran and returned what it
  printed; the bounded `npm test` excerpt named its record for the rest; the hex dump at R 268 was
  exact. Two of the model's diagnostic scripts were mangled by its own shell quoting (R 363, R 404)
  on the way to `node -e`; `run_check` with a program exists for that and was offered in the
  brief, and the model did not use it for its diagnostics.
- **The caps.** Neither cap interrupted useful work (section 4). Attempt 2's 44.5 s is the
  arithmetic of a shared wall after 147 s of inspection, and it was above the floor at which an
  attempt is withheld on the record instead.
- **The ratchet and rollback.** Both candidates were accepted (no measure moved) and neither was
  rolled back; the diagnostics failed on both because both were the same bytes.
- **The account of attempt 1 given to attempt 2** lists the commands that printed nothing or
  exited non-zero, as designed. The decisive measurement of attempt 1 (R 477, R 483: `[fF][pP]`
  does not match `ftp`) printed something and exited 0, so it was not in the account. Attempt 2
  did not need it: its first sentence named the class. This is the one place a brief change is
  conceivable, and section 7 keeps it a proposal.

## 7. Diagnosis and an experimental proposal, not implemented

The worker received sufficient accurate information and functioning tools and still failed. The
mistake is the model's reading of a twelve-character class it had written, held against seven
of its own contradicting measurements, and its re-generation of the same class once it had
reverted it. A simpler or longer brief does not change how a model spells `ftp`; the instruction
"run the failing input through the exact expression you changed" was followed, at R 356 and
R 377, and the reading did not change.

One experimental intervention is supported by the trace and is not a planning rule, a judge, a
cap change or a hint at the answer: **carry the previous attempt's last few shell results that
printed something into the next attempt's account, not only the ones that printed nothing or
failed.** For this run, that is R 477 and R 483 (`[fF][pP]` on `ftp` is null). Whether a model
given that line writes `[fF][tT][pP]` is a question two matched trials could ask, and it is not
asked here: the account is designed to be short, the trace shows attempt 2 naming the class
without it, and the intervention's effect on this model's spelling is a guess. It is recorded so
that the next launch on this task, if there is one, can be designed around it instead of around
another budget.

## 8. Verification

[verification.md](verification.md): the gates on `e7c60c7a6` (the product change) and on the
branch head after this evidence, and the regressions above against `d6972897e`.

## 9. Limitations

- No live model ran under this work. The fix is shown deterministically through the real loop
  and chokepoint; that it makes any repair succeed is not claimed, and the trace says it would not
  have changed this one.
- The reproduction of the regression and the control in section 2 ran the check's program and
  the visible check; the project's own suite and the hidden oracle were not rerun on the control,
  which is the investigator's and was given to no model.
- The three-generation claim (section 2) rests on two launches of one model on one task. It
  says the transposition is the model's, not how often that model makes it.
- The second attempt's 50 s and 16 steps are too few to say what it would have done with the
  first attempt's allowance; nothing here says that more wall would have produced the fix, and
  attempt 1 had 227 s and produced no edit.
