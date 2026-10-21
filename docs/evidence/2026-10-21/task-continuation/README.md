# Continuing an interrupted task loop: the two delivery failures established, the correction, and its trial, 2026-10-21

The development trial of this morning ([../delivery-trial/](../delivery-trial/)) ended with no
delivery in two launches. Independent review of launch 1's records reconstructed its first repair
and found a useful candidate thrown away by a wrong measure; launch 2 ran out of steps before
its regression test, repaired one lint error, and was reported as completed. This directory
establishes both from the published records with no model (sections 1 and 2), names the
correction (section 3), and records its trial (section 4). Every script here runs from a clone
on another machine: the sinon mirror is taken from GitHub where the machine has none, and the
sessions come from `node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/delivery-trial/packed-derived/payloads`.

| file | what it is |
| --- | --- |
| [replay-edits.mjs](replay-edits.mjs) | the recorded write and edit tool calls replayed over a git tree by the edit tool's own rule, and the tree's change read as the product's workspace-diff record spells it |
| [reconstruct-launches.mjs](reconstruct-launches.mjs), [reconstruction/](reconstruction/) | every candidate tree of both launches rebuilt from their ledgers and held to the digests their records carry; the patches |
| [check-trees.mjs](check-trees.mjs), [checks.json](packed-derived/checks/) (checks.json and checks-trial.json are packed there; `scripts/evidence-pack.mjs` restore gives them back) | the real sinon checks over those trees: the tree's own tests, lint, the node suite, the visible check, the hidden API check, the sealed upstream tests overlaid, and the tree's tests over the base's source |
| [replay-launch-1-controller.mjs](replay-launch-1-controller.mjs), [controller-replay/](controller-replay/) | launch 1 through the product's real gates engine and run assessment over the real tree, the model replaced by the recorded repair; and a weakened-test control |
| [regressions-on-fb02cae05/](regressions-on-fb02cae05/) | the new regression tests run on the starting implementation, where they fail |
| [protocol.md](protocol.md), [manifest.json](manifest.json), [preflight.json](preflight.json), [launches.md](launches.md) | the trial, registered before any inference, and every launch |

## 1. Launch 1: the repaired candidate was useful and the corrected measure keeps it

**Reconstruction.** Each candidate tree is the sinon base `8c663edec` with the launch's allowed
write and edit calls replayed in ledger order, one attempt's calls over the restored first
candidate as the resolve loop restores before every attempt
([reconstruct-launches.mjs](reconstruct-launches.mjs)). The product's own edit tool rule is used
(one occurrence, or every one under `replaceAll`), and the tree's zero-context diff is digested
as the product's `workspace-diff` record digests it. Every tree matches the digest its launch
recorded ([reconstruction/reconstruction.json](reconstruction/reconstruction.json)):

| tree | calls replayed | zero-context diff digest | the record that carries it |
| --- | --- | --- | --- |
| launch 1, first candidate (the delivered tree) | 7 | `sha256:c5a77e64b861...` | independent-verification 289, workspace-diff 676 |
| launch 1, repair attempt 1 | 7 + 7 | `sha256:737535fda55e...` | independent-verification 443 |
| launch 1, repair attempt 2 | 7 + 7 | `sha256:f19efa1c2899...` | independent-verification 662 |
| launch 2, first candidate | 4 | `sha256:ae0822f84637...` | independent-verification 289 |
| launch 2, repair attempt 1 (the delivered tree) | 4 + 1 | `sha256:7de576a18acc...` | independent-verification 347, workspace-diff 359 |

The rejected-candidate records (446, 665) keep the repaired test file truncated at 64,000
characters, so they are not what the trees are rebuilt from; the digests above are what hold
the replay to the launch.

**The reviewer's five findings, reproduced on the real tree** ([checks.json](packed-derived/checks/),
Node v24.15.0, the base installed from its lockfile):

| finding | measured |
| --- | --- |
| 324 focused tests pass on repair 1 | `npx mocha -R dot test/src/stub-test.js` on the repair-1 tree: exit 0, 324 passing |
| its nine added tests fail against the original source | the repair-1 test file over the base's source: exit 9, 315 passing, 9 failing; the same nine for the first and repair-2 trees |
| the API check passes all 43 spy methods | `node acceptance/hidden/api-check.mjs` on the repair-1 tree: exit 0 (it exits at the first missing method; 43 are required) |
| the old assertion measure rejected 558 to 557 | `measureTestFile` without `refute` (the measure before `643b9ef4c`) on the first and repair-1 test files: 558 and 557 |
| the corrected measure accepts 586 to 587 | `measureTestFile` at `643b9ef4c` and after: 586 and 587 (the base's file measures 569) |

Also measured, beyond the review: the first candidate fails its own tests (exit 7, 7 failing)
and lint (4 problems), as the launch recorded; the repair-1 and repair-2 trees pass lint, the
node suite (1,566 passing), the visible check, the API check and the sealed upstream tests (318
passing). The repaired candidate was a complete delivery by every check the protocol scores.

**The controller, exercised** ([replay-launch-1-controller.mjs](replay-launch-1-controller.mjs),
[controller-replay/replay.json](controller-replay/replay.json)). The real gates engine ran over
the real tree (a clone of the base with the visible check committed, installed from the lockfile),
with the gate set the launch sealed (build, typecheck, lint, format, tests as `npm run test-node`,
file-set, placeholder, secret-scan, behaviour-probe, diff-budget, and the contract's
task-acceptance gate judging the visible check in a fresh checkout), the three files the launch
declared, the first candidate applied, and a resolver that replays repair attempt 1's recorded
edits in place of the model. Cycle 0 fails lint, tests and task-acceptance as the launch's did;
attempt 1's cycle passes every gate that applies; the ratchet accepts ("no measure moved the wrong
way"); the base comparison accepts; the final cycle is attempt 1's; the workspace holds the
repaired tree (`sha256:737535fda55e...`); the run assessment is acceptable. 76 seconds.

**The weakened-test control** ([controller-replay/weakened.json](controller-replay/weakened.json)):
the same replay with one of the nine added test cases deleted after the repair is applied. The
ratchet rejects ("the touched test files declared 313 test(s) and now declare 312"), the workspace
is put back to the first candidate (`sha256:c5a77e64b861...`), the remaining attempts have nothing
recorded to replay and are refused, the run escalates at lint and is not acceptable.

**Replay shortcuts, named.** The model is the recorded edits, so attempt 2 is never asked for
and the loop's own stop is given to the assessment as the record says it was (`max-steps`). The
clone is from a full mirror, not the runner's shallow clone. The preset task contract the launch
carried (`requiredChecks: task-acceptance`) is not rebuilt, so the assessment does not list it;
the harness home and process isolation of the runner are not recreated. The replay establishes
what the controller does with the repaired candidate under the corrected measure; it is not a
rerun of the delivery, which is what section 4 is for.

## 2. Launch 2: what let the run finish with the deliverable unwritten

From launch 2's ledger ([../delivery-trial/launch-2/](../delivery-trial/launch-2/), the payloads
in the pack), in order: the first loop stopped `max-steps` after 40 steps (record 272); cycle 0
failed lint, the independent verification read `regression fail` on lint, and task-acceptance
failed with it (276, 289, 290); repair attempt 1 stopped `completed` after 7 steps (331); its
cycle passed every gate that applies (332 to 348); the ratchet accepted it against cycle 0 and
against the base (349, 350; 0 assertions added against the base's 0 required); the run assessment
read lifecycle `completed`, settled green, acceptable (361); the goal assessment agreed (368); the
process exited 0 with `completion.claim: claimed`.

Three things, in the code at `fb02cae05`, allowed that:

- `src/agent-run.ts` set the run's stop reason to each repair loop's as it returned
  (`finalStopReason = repair.stopReason`), so a lint repair's `completed` replaced the first
  loop's `max-steps`, and the assessment, the result line and the harness's completion account
  all read a finished task.
- `src/gates/auto-resolve.ts` repairs failing checks and, once the gates are green, owes nothing
  but the follow-up on planned outcomes, which an ordinary run has none of; nothing resumed the
  task's own unfinished work.
- the verdict policy does not refuse a `max-steps` lifecycle over green work (by design: a loop
  that stopped at its limit and left green work is not refused for it), so even an honest
  lifecycle would have been accepted; what was wrong was the lifecycle itself and the absence of
  any continuation.

The three are distinct: the task was unfinished (no test file in the tree, 0 assertions added);
the repair was complete (one lint error fixed in 7 steps, every gate green); the checks' coverage
was what it was (nothing sealed asks for a regression test, and the tests gate passes a tree that
adds no test). The product's report said the loop stopped as `completed` and nothing else.

**Reproduced with no model.** The regression tests of `src/agent-run.test.ts` ("a task loop that
stopped at its step limit (the launch 2 shape)") replay the sequence with a scripted model: a loop
that reaches a step cap of 3 with a lint error and no test, a narrow repair that fixes lint and
finishes, every gate green, no test written. On `fb02cae05` they fail
([regressions-on-fb02cae05/agent-run.txt](regressions-on-fb02cae05/agent-run.txt)): no
continuation exists, and the run's lifecycle reads `completed`.

**The resetBehavior failure, reproduced apart from any worker** ([checks.json](packed-derived/checks/),
`launch-2 final`): the delivered tree passes its own tests, lint, the node suite, the visible
check and the API check; with the sealed upstream `test/src/stub-test.js` overlaid, one case
fails (`.resetBehavior cleans stubbed getter and setter spies`), the hidden oracle's reading. The
sealed file is written into the checking tree only; nothing here reaches a worker.

## 3. The correction (commit `87b6f294e`)

- **A bounded continuation.** A loop that stops at its step limit before it reports the task done
  owes the run one continuation (`src/task-continuation.ts`, `src/gates/auto-resolve.ts`): an
  attempt from the same cap, given once the gates are green and before the follow-up on
  unresolved outcomes, inside the run's wall and token allowances, under the same ratchet,
  rollback and floor as a repair, carrying the task, the interrupted loop's account and the change
  as it stands. Its brief names no project, file or deliverable. The step cap is not raised; a
  stop at a budget, a stall or a runtime error is not continued and is reported as before.
- **The lifecycle.** The run's lifecycle is read off the chain by one rule the bundled verifier
  mirrors (`src/evidence/run-assessment.ts`, `src/evidence/verifier/verify.mjs`): the last stop of
  a loop that worked the task. A narrow repair that finished says so on its record
  (`runLifecycle: false`) and is not the lifecycle; a repair stopped at a limit still is; an owed
  attempt's stop is the lifecycle only where its candidate was kept, matched by attempt. Records
  without the new fields read as they always did, so earlier bundles still verify.
- **The test deliverable, measured.** On the final state the run records which test files differ
  from the base, the tests they add and remove by name, assertions added, whether the tests gate
  passed, and, where the harness can hand the runner one file and read its result points,
  whether a file's added tests fail over the base's source (`regression-tests-v1`). It decides
  nothing and names what it did not measure: for sinon, whose fallback is its whole `npm test`
  script, the base-source run is not made and the line says so.
- **The report.** The terminal outcome and the JSON result carry the continuation and the test
  account; the comparison harness reads the product's lifecycle before it counts a completion
  claim (`scripts/comparison/arms.mjs`).

Regressions that fail on `fb02cae05` and pass on `87b6f294e`
([regressions-on-fb02cae05/](regressions-on-fb02cae05/)): the continuation is given after a
narrow repair and can add and keep the missing test; a run whose cap left no continuation keeps
the interrupted loop's lifecycle and the repair's finish is marked as the repair's; a continuation
that breaks a passing check is rolled back and the lifecycle stays the interrupted loop's; a task
that finished on its own gets no continuation; cancellation withholds it; the bundle's own
verifier re-derives every one of those assessments. Separately, tests that pin only fields and
wording: the brief's text and identity (`src/task-continuation.test.ts`), the lifecycle rule over
synthetic records including the legacy reading (`src/evidence/run-assessment.test.ts`), the
outcome lines (`src/cli-run-outcome.test.ts`), the harness's reading (`scripts/comparison/arms.test.mjs`).

## 4. The trial

Registered in [protocol.md](protocol.md) before any inference; every launch in
[launches.md](launches.md); the records in [records/](records/); every payload of each launch in
[packed-derived/payloads](packed-derived/payloads/) ([payloads-inventory.json](payloads-inventory.json)).

**Launch 1** (`87b6f294e`, 282.5 s, 1,011,623 tokens): the first loop stopped at its 40-step cap
with the source written and no test; cycle 0 failed lint (three errors in `src/sinon/stub.js`).
Repair attempts 1 and 2 each answered with one step of text and no tool call, were counted and
measured over the unchanged tree, and were accepted by the ratchet as moving nothing; attempt 3
fixed lint in 14 steps. The continuation was withheld: no attempt was left under the cap of 3.
The delivered source is correct under the frozen evaluator (the sealed upstream tests, the
`resetBehavior` case included; the hidden API check; the project's suite), and no test was
written. The product reported it as it was: lifecycle `max-steps`, "its continuation was
withheld (no attempt was left under the cap of 3), so the task may be unfinished", "regression
tests: no test file differs from the base, so none was added"; the harness read no completion
claim. Not delivered (item 5): the test deliverable is absent and the lifecycle is not
`completed`. Earliest actionable failure: a repair attempt that calls no tool changes nothing and
still consumed an attempt; corrected in `cbf9544b4` (amendment 1), with its regression failing
on `87b6f294e` ([regressions-on-87b6f294e/](regressions-on-87b6f294e/)).

**Launch 2** (`cbf9544b4`, 488.0 s, 2,826,981 tokens): the first loop stopped at its cap with
the source written and the test file begun; repair attempt 1 spent its 40 steps fixing lint;
repair attempt 2 fixed the tests and was cut by the wall after 26 steps, its candidate measured
green and kept. The delivered tree is complete and correct under the frozen evaluator: the sealed
tests, the API check and the suite pass; 8 cases and 26 assertions were added, pass on the
delivered tree, and 6 of them fail over the base's source ([checks-trial.json](packed-derived/checks/)).
The product refused it: its last loop stopped at the wall, which the verdict policy refuses on
its own, so it exited 1 with no claim and offered `swarm resume`. Not delivered by item 5. Repair
improved the artifact here: cycle 0 failed lint and tests, and the kept tree passes everything.
No continuation ran in either launch (withheld both times: the cap in launch 1, the wall in
launch 2), so the continuation's own value is shown only by the regression tests.

## Plain answers

- **Did Swarm deliver a complete correct change?** Launch 2's tree is complete and correct by
  every frozen check, and the product refused it as unfinished because its allowance ran out
  mid-repair. Launch 1's source was correct with no test. Neither is a delivery under the rule.
- **Did the controller retain useful work and finish interrupted work?** Retained: yes, in both
  launches every accepted repair stood and the corrected measure kept a repaired candidate in the
  replay. Finished: not shown live; the continuation was withheld both times.
- **Did repair improve the delivered artifact?** In launch 2, yes (lint, then the tests). In
  launch 1 the no-tool attempts changed nothing until the third.
- **Did Swarm outperform OpenCode?** Not measured: the fresh pairs were conditioned on a delivery.
- **Unproven:** that the continuation writes a missing test live; that 40 steps and 9 minutes
  suffice for this task's source and tests together on this model.

## 5. After the trial

The no-tool notice of `cbf9544b4` was given to every attempt, owed ones included. The full
suite on that commit showed the conflict: the continuation's brief and the follow-up's both ask
for a one-line answer where nothing needs changing, so an answer with no call is the shape they
asked for. Commit `3fa28403a` gives the notice to repairs of failing checks only and makes the
scripted repairs that decline on purpose decline twice, as a model told the notice would. Launch
2 ran before that scoping on `cbf9544b4`; no owed attempt was given there (the continuation was
withheld), so the scoping changes nothing in its trace. The build the trial pinned differs from
the branch's final code in that one respect, and in nothing the launches exercised.

## 6. Correction, 2026-10-21 evening: the cut was the model-work cutoff, not the run's deadline

Sections 4 and the plain answers say launch 2's repair "was cut by the wall" and that the product
refused the tree "because its allowance ran out mid-repair". The launch's own records say
otherwise (its chain is in [packed-derived/payloads-2](packed-derived/payloads-2/)):

| record | time (UTC) | what it says |
| --- | --- | --- |
| 10 `session-budget` (`verification-reserve-v1`) | 16:54:08.818 | deadline **17:02:50.410**; model work ends 17:01:37.370, 73.04 s held for the final cycle, acceptance and the independent verification |
| 268 `session-budget` | 16:56:20.326 | the loop and every repair draw from one wall that ends a second before model work does (17:01:36.370) |
| 714 `model-call` | 17:00:59.524 | step 107, sent 227 ms earlier, cancelled; `usageStatus: "unknown"` |
| 715 `session-stopped` | **17:00:59.529** | repair attempt 2 stopped `max-wall-time` after 26 steps, with 37.01 s held back for its own gate cycle (its wall ended 17:00:59.360) |
| 716 to 748 | 17:01:02.502 to 17:01:33.510 | the final gate cycle over the delivered tree: every gate passed |
| 749 `run-assessment` | 17:01:33.516 | not acceptable; the only refusal: "the run stopped as max-wall-time" |
| 755 `independent-verification` | **17:01:57.313** | the delivered patch applied to a fresh checkout and the sealed check passed (`verified: true`, task accepted) |
| 756 `run-assessment` | 17:01:57.324 | not acceptable, carried from 749 |

The repair was stopped by an internal cutoff that exists to keep verification time, and that time
was used: the final cycle and the independent verification of the exact delivered tree finished
53.1 s before the run's deadline. Nothing was cancelled (749 records `cancelled: false`), no
check went unrun, and no write was in flight. The tree was refused for the lifecycle word alone,
under `run-acceptance-v4`, which refused every `max-wall-time` without asking which wall it was.
That is a product defect, and launches.md's "no product defect is named from this trace" is
withdrawn. Nor does this trial show that nine minutes was too short for the implementation and
its verification: both finished inside the allowance. What it shows is that the model-work share
ended while the second repair was still working, and that the verdict then discarded the
verification the reserve had paid for.

**Reproduced with no model** ([assessment-replay/](assessment-replay/)). `replay-launch-2-assessment.mjs`
copies the chain to record 748, records the worker assessment again with the product's own
`recordRunAssessment` from what the chain holds, appends records 750 to 755 with their payloads
unchanged, records the goal assessment with `recordGoalAssessment`, exports both chains as bundles
and runs the standalone verifier over them. On the code of `173bce007` the replayed worker
assessment is canonically identical to record 749 and the goal verdict to 756, and the verifier
re-derives all four assessments (`before-173bce007.json`, packed in
[packed-derived/assessment-replay](packed-derived/assessment-replay/)).

**The correction** (policy `run-acceptance-v5`, mirrored by the standalone verifier). A loop's wall
stop is read against the run's recorded reserve: whether the stop came before the deadline the
reserve names, and whether every write and shell call requested settled before the model-work
cutoff. Where both hold, the stop is the cut of model work and does not refuse on its own, as a
step-limit stop does not; the run is then decided by the checks of the delivered tree and every
other condition of the policy. The lifecycle stays `max-wall-time`, no completion claim is read
into it, and the verdict and report say the acceptance is the checks' reading and says nothing
about whether the model had finished. A stop at the deadline, cancellation, an allowance that ended
before the checks finished, a failed or unrun required check, a final verification of another
patch, and a write unsettled at the cutoff still refuse; a run with no reserve recorded refuses a
wall stop as before; v1, v2 and v4 records keep their meaning, and the verifier refuses a v4 record
that carries the new field. Over launch 2's records the v5 assessment is acceptable, the goal
assessment is acceptable with the task accepted, and the verifier re-derives both (`after-v5.json`).
The tests that pin each case, on an injected clock and through the command line with a scripted
endpoint, are listed in [assessment-replay/README.md](assessment-replay/README.md), with the ones
that fail on `173bce007`.

**The score stands.** Launch 2 was scored under the protocol frozen before it, whose item 5
required lifecycle `completed` and an acceptable verdict; it is "not delivered" there and stays so.
The corrected product would have accepted this tree with lifecycle `max-wall-time` and no
completion claim, which that item still would not count as a delivery.

**Tokens.** launches.md reports launch 2 as "2,826,981 tokens, every call reporting". 106 of its 107
model calls reported usage, totalling 2,826,981; the 107th (record 714) was sent and cancelled 227 ms
later by the cutoff, and its usage is unknown. The product's settled count said 0 unknown because
only answered calls were counted ([usage-launch-2.json](packed-derived/assessment-replay/), from
`usage-account.mjs`). The reported total is a lower bound; charged at the request bound its record
carries (78,695 tokens), the launch used at most 2,905,676. The last prompt the server measured
before it was 34,837 input tokens; whether the server processed any of the cancelled request is not
recorded. Launch 1's 56 calls all reported usage (`usage-launch-1.json`). The product now counts a
call that was sent and ended without an answer as unknown usage.

**The continuation still has no demonstrated live benefit.** It was withheld in both launches
(launch 1 for want of an attempt under the cap, launch 2 for want of model-work time), so its value
rests on the regression tests alone.
