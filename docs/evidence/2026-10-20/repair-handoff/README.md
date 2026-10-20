# Two tool-feedback corrections, and one matched pair on the repair handoff, 2026-10-20

Follow-up to [../repair-trace/](../repair-trace/README.md), on the local branch
`fix/requirement-coverage-and-verification-reserve` (draft pull request #90), starting from its head
`3cdfc34b9`. Declared files: [scope.md](scope.md). Three kinds of evidence stay apart: **recorded**
(run `20261020T045117-41e2cc`'s chains, restored with
`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-19/endpoint-readiness-trial/launch-1/packed-derived/launch-1-streams`
and read as they are; **R** is the run chain and record numbers are its sequence numbers),
**deterministic** (fixture loops through the real code, the production account builder run on the
reconstructed recorded conversation, and two whole-product rehearsals with no model) and
**live-model** ([protocol.md](protocol.md), [launches.md](launches.md): one control launch and one
treatment launch).

## 1. What the records establish

Read from the restored chain, record by record, before anything was changed.

- **What the second attempt received** (R 513, the brief, whole): the task and sealed objective,
  the requirements, the uncovered outcomes, the contract, "attempt 2 of 3", the base and the
  candidate's diff, the remaining allowance (4,901,354 tokens, 44,464 ms), the `run_check`
  description, the harness's account of attempt 1, and the failing gate's output. The account
  (reproduced byte for byte below) said: stopped `max-steps` after 40 steps; edited nothing; read
  three files; and listed the shell commands that printed nothing or exited non-zero.
- **What the account omitted.** Attempt 1's shell results that printed something and exited 0 were
  not in it, by the builder's design. Among them: R 477 (`Testing [fF][pP]: null`, `Testing
  [fF][pP][tT]: null`), R 483 (`Testing [fF][pP]: null`) and the step-40 result (R 488, `Does "ftp"
  match ^[fF][pP]: false`, `Match ftp: null`), the attempt's last three. The step-40 result has no
  transcript component (no model call followed it inside the attempt; R 489 is the stop) but is in
  the conversation the builder read; [../repair-trace/README.md](../repair-trace/README.md) section
  10 appends that correction.
- **What attempt 2 did with the brief it had** (R 518 to R 609, read in the trace): named the class
  in its first sentence, reverted both rules to the base spelling without the `i` flag, saw the
  project's tests fail, and rewrote the identical `[fF][pP][tT]` class (R 591); its rerun of the
  build and check after that edit was answered with the "already answered" notice saying nothing in
  the workspace had changed (R 598); the wall ended the loop at R 609.

**Causal wording.** These records demonstrate repeated model mistakes under the brief the model had.
They do not establish that a different brief could not have helped, nor that more time would have
been useless; those are hypotheses about runs that did not happen. Section 5 asks one of them, once.

## 2. Two tool-feedback corrections, reproduced before the change

Both findings were reproduced on the starting source `3cdfc34b9` through the real loop and
chokepoint on a git workspace ([regressions-before.txt](regressions-before.txt),
[regressions-before.sh](regressions-before.sh)), then corrected in `c538331f0`.

| finding | reproduction on `3cdfc34b9` | kind |
| --- | --- | --- |
| The worker names as writers only the tools of kind `write`; the shell tool is kind `shell`. A shell command that edits a file does not advance the tracker's generation, and a listing repeated after it is told it was already answered. | `src/agent-run.test.ts` "a call repeated after a shell command that edited a file": `list src`, then `shell node -e "...appendFileSync('src/greet.js', ...)"` (the file carries the appended line, exit code 0), then `list src` again, whose listing the edit does not change: the second listing came back as the notice, "No writing tool call has landed since". | **behavioural**: a real file mutation, and the answer withheld |
| A writing call is keyed without the generation, so a successful write repeated byte for byte is told "No writing tool call has landed since", although writing calls landed. | the same file, "tells a repeated successful write...": two identical `write` calls, both landing ("wrote 70 bytes"); the second's notice carried the sentence. Also at the tracker (`src/core/tool-stall.test.ts`) and the loop (`src/core/loop.test.ts`). | **wording**: the repeat is real; the sentence is false |
| Guard: the same listing twice with nothing between is still a repeat, and its notice may say no writing call landed. | passes on both | unchanged |

**The correction** (`c538331f0`): the worker names as writers every tool whose successful call may
change workspace files, the shell included, because the harness cannot see what a command did once
it ran (no shell parser or workspace snapshot is added; "may write" is all that is known). The
tracker's stall carries whether the repeated call may write, and both notices say of a repeated
inspection that no call which may write has landed since (its generation shows it), and of a
repeated call that may write only that it was made before with the same answer. Detection is
kept: a shell command repeated with the same answer, an inspection repeated with nothing between
and a write repeated are still repeats. The cost is one repeat's sensitivity: an inspection
alternated with a shell command is read as new each time, on the side of answering.

**These corrections are not evidence of improved repair.** Neither occurred in the recorded run:
attempt 2 edited through the `edit` tool and its repeated call was an inspection.

## 3. The handoff: what the account now carries, shown deterministically

Defined before any trial was read (`src/core/loop-account.ts`, `maxRecentShellResults`): the last
**three** shell results of the previous loop that were not refused, printed something (a stdout or
stderr section) and whose recorded status is exit code 0, in call order; each with its command
(bounded as every account line is), its exit status, a bounded excerpt of what it printed (eight
lines or 480 characters), the evidence record the chokepoint's trailer names, and the files a later
writing call of the same loop landed on, so a result reads as predating them. The text names them as
historical observations of that loop's files, not verification of the workspace now, and says a
zero exit status means the command ran, not that what it examined was correct. Nothing selects by
meaning; no model text travels; the failure information already carried stays. A result from a loop
later rolled back is still that loop's; the brief's separate rollback feedback says what was rolled
back, and the account builder does not know.

[account-from-records.mjs](account-from-records.mjs) rebuilds attempt 1's conversation from the
recorded chain (every blob checked against its record; the step-40 turn and outcome from R 485 and
R 488) and runs the production builder on it:

- with the control revision's builder, the text equals **byte for byte** the account the brief at
  R 513 carried ([account-attempt-1-control.txt](account-attempt-1-control.txt); the script exits 2
  otherwise), which also shows the reconstruction is the conversation the product had;
- with `afa2deedc`'s builder, the same text plus the three results, R 477, R 483 and the step-40
  call, each with its record digest ([account-attempt-1-treatment.txt](account-attempt-1-treatment.txt)).

This proves information delivery only. Whether a repair uses it is section 5's question.

## 4. The pair's mechanics, rehearsed without a model

[repair-boundary.mjs](repair-boundary.mjs) runs the unmodified product from its ordinary command
line, starting at the documented repair boundary: the run's recorded sealed goal contract (so the
gates are the trial's: `task-acceptance` and `task-diagnostics` of sealed goal `sha256:904f8aae...`,
the digest the product recomputed in every run below), a three-step scripted worker that declares
`src/rules.ts` and writes the candidate's exact bytes, attempt 1's forty recorded responses
replayed in order through the real chokepoint, and every later chat completion handed to the live
server through a proxy. The planning and implementation of the original run are not replayed.
Both rehearsals ([rehearsal-control/record.json](rehearsal-control/record.json),
[rehearsal-treatment/record.json](rehearsal-treatment/record.json); a stub that proposes nothing
in the server's place):

| | control rehearsal (`c538331f0`) | treatment rehearsal (`afa2deedc`) |
| --- | --- | --- |
| scripted turns played, then handed over | 43, the 44th request's last user message the second attempt's brief | the same |
| first loop | completed, 3 steps, `wrote 17175 bytes to src/rules.ts` | the same |
| attempt 1 (replayed) | `max-steps` after 40 steps, 906,557 tokens as recorded, no edit | the same |
| account handed to attempt 2 | equals R 513's, byte for byte ([attempt-2-brief.txt](rehearsal-control/attempt-2-brief.txt)) | the same plus the three results ([attempt-2-brief.txt](rehearsal-treatment/attempt-2-brief.txt)) |
| time to the repair boundary | about 105 s after the session start (gate cycle about 33 s) | the same |
| delivered tree | the candidate unchanged (`sha256:8efc2f36...`): oracle pass, visible check and project tests pass, probe `ftp-bare` and `ftp-in-text` not matching upstream, product `not accepted` | the same |

So the two arms differ in one thing, the account's three results, and everything the protocol says
is identical was identical in rehearsal.

## 5. The matched pair (live model)

[protocol.md](protocol.md), registered at `ffafaa56f` before any inference; [launches.md](launches.md).
Control first, then treatment, sequentially, nothing else running; Ollama 0.32.14 serving
`qwen3.6:35b-a3b` as it was, no restart, no setting changed. Both launches were dispatched after one
readiness sequence (5.7 s with the model loading inside the first request; 0.9 s with it resident),
both completed inside their 10 minutes, and the proxy's handoff happened as rehearsed in both: 43
scripted turns, the 44th request the second attempt's brief, the control's account R 513's byte for
byte and the treatment's carrying the three results ([live-control/attempt-2-brief.txt](live-control/attempt-2-brief.txt),
[live-treatment/attempt-2-brief.txt](live-treatment/attempt-2-brief.txt)). No request stalled;
nothing was halted. Records: [live-control/record.json](live-control/record.json),
[live-treatment/record.json](live-treatment/record.json); each arm's `final.patch`, `probe.json`,
stdout, stderr and the product's run chain (ledger and payloads; the exported bundle directory is
not kept), the streams packed and restorable with
`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-20/repair-handoff/live-<arm>/packed-derived/live-<arm>-streams`.

| | control (`c538331f0`) | treatment (`afa2deedc`) |
| --- | --- | --- |
| second attempt's allowance in its brief | 7,093,073 tokens, **153,233 ms** | 7,093,073 tokens, **145,709 ms** |
| second attempt | 40 steps, `max-steps`, 149 s (session 137 s to 286 s), 785,078 tokens | 28 steps, `max-wall-time`, 146 s (135 s to 281 s), 532,509 tokens |
| what it did | read `rules.ts`, built, tried to load the library (two failures), ran the visible check, `run_check` on the failing check (27 s), then nine probes of its own against the class, the last character by character (`t false` at position 1); **edit at step 21** (`[fF][tT][pP]` in the `url` rule, 68 s in), probe, build and check, `npm test` three ways, `git diff`, **edit at step 32** (the `text` rule), build, `npm test`, `git diff`, `run_check` of the whole contract (26 s), then three claims, the last verified by the harness, as its 40th step | read `rules.ts`, searched the tests, read the autolink test and the rules, one unverified claim and an amendment naming the file it already had, `grep` of the rules; **edits at steps 17 to 19** (`url` rule, a second pass on it, the `text` rule; 57 to 65 s in), `grep`, build, `run_check` on the failing check (27 s) and on the visible check (27 s), `npm test`, two probes of its own (`Ftp: linked`), `git diff`; its 29th call was closed by the product at its wall |
| the three results in the brief | absent | present. No step quotes or reruns them. The attempt's first sentence names the class, as the original attempt 2's did, and its narrative before the edit says "in my previous attempt it failed to match 'Ftp' because `[fF]` matches 'F' (pos 0), then `[pP]` needs to match char at pos 1 which is 't', not 'p'", the position-by-position diagnosis, with no probe of its own first; the control reached the same diagnosis after nine probes. Whether that sentence owes anything to the three results or to the gate output and the diff, which both briefs carry, cannot be told apart in one pair |
| delivered patch | `sha256:32788e7d...`, `[fF][tT][pP]` in both rules | **the same bytes** |
| hidden oracle | pass | pass |
| behaviour probe (10 rows, `ftp-bare` and `ftp-in-text` among them) | all match upstream | all match upstream |
| supplied check; project tests | pass; pass | pass; pass |
| product's final gate cycle and verification on the delivered tree | every gate passed; ratchet accepted; final verification completed | every gate passed; ratchet accepted; final verification completed |
| product's report | **`accepted`**, exit 0: "every acceptance condition held" | **`not accepted`**, exit 1: "the run stopped as max-wall-time" |
| whole launch (readiness apart) | 351.5 s; 1,692,005 tokens, 906,557 of them the replayed attempt's recorded usage | 346.5 s; 1,439,436 tokens, 906,557 of them the same |
| readiness | 5.7 s, 753 tokens | 0.9 s, 753 tokens |

Allowance used in all: 2 of 2 launches, 11.6 of 20 minutes of task wall, 2 of 4 readiness
sequences (6.6 s, 1,506 tokens), no replacement, no retry.

**Repair time against the original.** Each second attempt was handed about 150 s, against the
original's 44.5 s, because the original's first attempt spent 147 s of a shared wall on live model
time and here that attempt's answers are scripted. Both arms were handed the same figure to within
7.5 s (the difference is the two gate cycles' timing). The protocol's estimate of about 280 s was
wrong: the product ends model work at its deadline minus the verification reserve it measures after
the preflight (`verification-reserve-v1`, at most a quarter of the wall; the final verification of
the delivered tree runs in that reserve), and the repair holds back one gate cycle's measured
duration on top, so of the 7-minute wall the second attempt was handed what its brief says. The
estimate counted neither reserve correctly; the arms stay matched, and the figure that counts is the
brief's.

## 6. Decision

**Neither arm's result is attributable to the handoff.** Both turned the incorrect candidate into
the same correct patch, so by the rule fixed in [protocol.md](protocol.md) before either launch this
is **no demonstrated benefit**: the treatment did nothing the control did not. The handoff is
therefore not made a default. It stays in the account builder behind an explicit option
(`recentShellResults`, bounded above at three), which the worker does not pass, with its tests and
with [account-from-records.mjs](account-from-records.mjs) `--recent-shell-results 3` reproducing the
treatment build's account; no prompt rule is added, no budget is raised, and this task is not run
again. The treatment build `afa2deedc` carried the results by default and is recorded as what it
was; the branch head after the pair does not.

What the pair observed, as observations and not as findings:

- With the same brief the original second attempt had, and about 150 s instead of 44.5 s, the
  control's fresh attempt found the transposition by its own probes (nine of them, the decisive one
  character by character) and fixed both rules. That is one observation that this model, on this
  task, can repair the candidate given that much time; it says nothing about how often.
- The treatment's attempt edited sooner (steps 17 to 19, 57 s in, against step 21, 68 s in) with
  fewer probes of its own before the edit (none), used fewer tokens (532,509 against 785,078), and
  then spent 54 s on two `run_check` calls and reached the wall while composing after its checks.
  Its narrative stated the position-by-position diagnosis before any probe of its own, where the
  control probed nine times first. Whether that owes anything to the three results cannot be read
  from one pair: the attempt never quoted or reran them, both briefs carry the failing case and the
  diff, and an 11 s difference between two samples of one model is inside what the same brief gives
  on reruns.
- The two product reports differ for identical trees: a run whose last loop stops at the wall is
  reported `not accepted` even when the final gate cycle and verification on the delivered tree
  passed every gate. That is the product's rule, applied correctly to what happened; whether it is
  the right rule for a tree the final checks accept is a question this work records and does not
  decide.

**What remains unproven.** That the handoff ever helps (one pair, both correct); that the control's
success repeats (one launch); anything about other tasks, other models or another coding agent; and
whether the original attempt 2 would have succeeded with the control's allowance (its records show
only what it did with 44.5 s). The corrections of section 2 are retained on their own reproductions
and are not evidence of improved repair.

## 7. Verification

[verification.md](verification.md): the gates, build, packaged and fuzz checks on the tested
commits, with their logs.

## 8. Limitations

- One matched pair on one exposed task whose records and upstream fix are known to the people
  developing Swarm; the hidden oracle passed the incorrect candidate, so the probe and the product's
  generated check, not the oracle, separate correct from incorrect here.
- The first repair attempt is a replay of recorded responses, not a live attempt: its tool results
  are the product's own, but a live first attempt on these builds could differ, and the shell-edit
  correction of section 2 was never exercised by it (it edited nothing).
- The allowance each second attempt had is read from its brief, about 150 s; the protocol's
  estimate was higher, and a live attempt with 44.5 s was not run.
- The proxy sits between the product and the server; it records every request and forwards bytes
  unchanged, and the product's own chains record every call, but it is one more process than the
  trial had.
- The exported bundle directories of the two runs are not kept (weight); the chains are, packed.
