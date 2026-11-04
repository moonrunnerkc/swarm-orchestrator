# Product acceptance, 2026-10-31 to 2026-11-02

Eight real tasks across Brad's own repositories, Node/TypeScript and Python, and two held back for
the release check, run in two rounds: the acceptance run (2026-10-31 to 2026-11-01) and a closing
run (2026-11-01 to 2026-11-02) after the defects the first exposed were fixed. Every run used a
local model with nobody in the loop:

    swarm run "<task>" --approve auto --max-steps 60 --max-minutes 60 [--host] [--endpoint ... --model ... --context ...]

on a fresh clone of the source repository with its dependencies installed as a user's checkout has
them, followed by `swarm-verify replay` of the final verification with the pinned verifier package.
No run needed Brad's intervention. The figures below are copied from each run's `report.json`;
nothing here is measured anew.

Each task directory holds `final/` (the last run of the first round), `attempt-N/` (its earlier
runs) and `closing-attempt-N/` (the closing run's): `task.txt` (the request), `start.txt` (the
starting commit), `delivered.patch` (the change), `report.md` and `report.json` (the requirement
report, model, resources), `result.json` where kept, `run.out` (the printed summary), `replay.out`
(the independent replay), `trace.txt` (every command the model ran), `session.txt` (the evidence
session under `~/.swarm/sessions/`, which holds the hash-chained ledger and the signed attestation)
and, for closing runs, `source-check.txt` (the source repository's refs, stash, status and
worktrees compared before and after). What each failed attempt taught, and the fix it led to, is
in `docs/DECISIONS.md` under 2026-11-01.

## Categories

A category counts only with a complete run of its own task whose replay agrees; no run counts twice.

| Category | Task | Session | State | Model | Input / output tokens | Replay | Open reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Feature with a boundary case | t1 pubprep | 20261101T140245-7b55bf | complete | qwen3.8:27b, Rapid-MLX | 290,094 / 6,135 | agrees | |
| Multi-file feature, backward compatible | t2 crossfire | 20261101T142858-cff296 | complete | qwen3.8:27b, Rapid-MLX, 65,536 | 646,974 / 4,653 | agrees | |
| Fix a real defect | t3 ruleprobe (`--host`) | 20261101T042617-8a01e0 | complete | swarm-redesign-qwen36-32k, Ollama auto | 560,835 / 4,765 | agrees on the host (`final/replay-host.out`); the first replay ran in a container and diverged | |
| Fix beside an unrelated inherited failure | c1 ruleprobe (`--host`) | 20261101T205458-33e203 | complete | gemma4:31b, Ollama auto | 499,019 / 9,095 | agrees, on the host | |
| Refactor: move without behavior change | t5b ironroot | 20261101T054940-b71a2a | complete | swarm-redesign-qwen36-32k, Ollama auto | 735,845 / 7,243 | agrees | |
| Refactor across modules, tests and config | t6 tracemantle | 20261103T231418-6662f6 | incomplete | gemma4:31b, escalated to swarm-redesign-qwen36-32k, Ollama auto | 89,562 / 1,551 | agrees | open: the first run whose edit tools work on macOS and that no harness defect misled (16.0.2 candidate). The moved `history/history_store.py` imports `_entry_from_dict` from the old path, whose shim is `from tracemantle.history.history_io import *`, which does not re-export an underscore name, so test collection fails (ImportError, regression found); the model never ran the tests, repeated `ls -F` three times, and the escalated model repeated one `grep` three times. Every earlier t6 run met a defect of the product: swarm-verify 2.0.0 refused the correct move (fixed in 2.0.1), BSD `sed -i` failed every in-place edit (fixed in 16.0.2), and the first 16.0.2 attempt was misled by the diff view (fixed in 16.0.2); see Reruns for 16.0.2 |
| Upgrade a dependency | t7a claimcheck | 20261101T235811-1133bb | complete | gemma4:31b, Ollama auto | 133,999 / 1,099 | agrees | |
| Upgrade the runtime | t8 quantproof | 20261101T073344-9bf3e4 | complete | qwen3.6:35b-a3b, Ollama auto | 222,006 / 1,990 | agrees | |

Seven of the eight categories have a complete run of their own task whose replay agrees. The
cross-module refactor (t6 tracemantle) does not. No earlier t6 run says anything about what a local
model can do with it: swarm-verify 2.0.0 refused the correct move whoever made it (Comparison), BSD
`sed -i` failed every in-place edit on this Mac until 16.0.2 gave the model a probed platform block and
edit blocks, and the first 16.0.2 attempt was misled by a diff view that hid file headers. The second
16.0.2 attempt is the first that met none of those, and its patch is wrong in a way the verifier caught
(Reruns for 16.0.2). `t6-comparison/` holds the task, its base, a fixed requirement record and both attempts,
so another agent's patch can be judged by the same verifier on the same base. t7b dependency detector (20261101T102609-e587a2,
complete, replay agrees), the upgrade substitute of the first round, completed as well. Of the two
held-back tasks, h1 completed on its first run with a replay that agrees, and h2 did not complete
in either round. No known false completion remains: claimcheck's "latest 9.x" is now held by the
verifier, and its complete run resolves Stryker 9.6.1, the registry's latest 9.x.

The fix category is host-verified only. Its complete runs (t3 and c1, ruleprobe) ran on the host,
and no isolated attempt from a real bug-fix commit has completed. Both picks fail at their base in the
container for reasons of their own (depose's typecheck and build, claimcheck's missing
`claimcheck/src/coverage/collect.js`), so those checks stay unresolved and no isolated run of either can be
complete; the sealed held-out test is what judges the fix. depose 09b01c1: correct in 16.0.1's
attempt and again in 16.0.2's (the sealed test fails at the base and passes with the patch).
claimcheck d2f136c: wrong in 16.0.1's attempt and in 16.0.2's first, which also circled on one import
line until the step budget; the second 16.0.2 attempt, after that loop defect was fixed, passes the
sealed test. All are in `f-fix-isolated/`.

## Final runs

| Task | Model | State | Stop | Turns | Input / output tokens | Wall | Attempts before |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t1 pubprep | qwen3.8:27b (Rapid-MLX) | complete | complete | 32 | 290,094 / 6,135 | 425 s | 5 |
| t2 crossfire | qwen3.8:27b (Rapid-MLX, 65,536 context) | complete | complete | 38 | 646,974 / 4,653 | 687 s | 9 |
| t3 ruleprobe | swarm-redesign-qwen36-32k (Ollama, auto) | complete | complete | 30 | 560,835 / 4,765 | 322 s | 2 |
| c1 ruleprobe | gemma4:31b (Ollama, auto, `--host`) | complete | complete | 56 | 499,019 / 9,095 | 2,220 s | 0 |
| t4 resident | swarm-redesign-qwen36-32k (Ollama, auto) | incomplete | time-budget | 22 | 209,209 / 2,642 | 2,910 s | 2 |
| t5a depose | qwen3.8:27b (Rapid-MLX, 65,536 context) | incomplete | no-progress | 6 | 32,669 / 450 | 102 s | 4 |
| t5b ironroot | swarm-redesign-qwen36-32k (Ollama, auto) | complete | complete | 39 | 735,845 / 7,243 | 224 s | 0 |
| t6 tracemantle | gemma4-31b-greedy-128k (Ollama, named, 65,536 context) | incomplete | no-progress | 42 | 388,458 / 12,946 | 3,127 s | 7 |
| t6 tracemantle, against 2.0.1 | gemma4-31b-greedy-128k (Ollama, named, 65,536 context) | incomplete | time-budget | 59 | 702,202 / 24,439 | 4,880 s | 8 |
| t6n tracemantle (narrower) | qwen3.6:35b-a3b (Ollama, auto) | incomplete | no-progress | 25 | 103,121 / 1,287 | 683 s | 0 |
| t7a claimcheck | gemma4:31b (Ollama, auto) | complete | complete | 16 | 133,999 / 1,099 | 558 s | 7 |
| t7b dependency detector | gemma4-31b-greedy-128k (Ollama, auto) | complete | complete | 11 | 56,251 / 302 | 224 s | 2 |
| t8 quantproof | qwen3.6:35b-a3b (Ollama, auto) | complete | complete | 34 | 222,006 / 1,990 | 226 s | 1 |
| h1 crossfire | gemma4-31b-greedy-128k (Ollama, auto) | complete | complete | 23 | 299,897 / 3,421 | 944 s | 0 |
| h2 ironroot | qwen3.8:27b (Rapid-MLX) | incomplete | no-progress | 18 | 128,114 / 1,992 | 428 s | 2 |

## Reruns for 16.0.2 (2026-11-03)

The runs the macOS `sed -i` defect invalidated, rerun on the 16.0.2 candidate: the prompt opens
with the machine as probed (here: macOS 26.6.2, BSD `sed`, `grep`, `find`, `awk` and `xargs`), and
files change through edit and write blocks. Each ran `swarm run "<task>" --model auto --approve auto
--max-steps 60 --max-minutes 60`, isolated, with swarm-verify 2.0.1, then `swarm-verify replay`;
the fix picks were then judged against their sealed held-out test with `witness.sh`, as before. The
first four ran on a build of e368b3ce7. Two defects of the loop showed in them and were fixed with a
failing test first (838ed8fa9, the diff view; 6767b2789, a tree changed back and forth), and the two
runs they met ran once more on a build of 6767b2789. No run edited with `sed -i`, and every source
repository was unchanged.

| Task | Directory | Session | State | Stop | Model | Turns | Input / output tokens | Wall | Replay | Held-out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t6 tracemantle | `t6-tracemantle/rerun-16.0.2-attempt-1` | 20261103T213819-76ab1e | incomplete | no-progress | gemma4:31b, escalated | 25 | 120,919 / 2,974 | 933 s | agrees | |
| t6 tracemantle | `t6-tracemantle/rerun-16.0.2-attempt-2` | 20261103T231418-6662f6 | incomplete | no-progress | gemma4:31b, escalated | 19 | 89,562 / 1,551 | 1,212 s | agrees | |
| dossier (clean-install task) | `e-dossier-16.0.2/attempt-1` | 20261103T220620-05a97e | complete | complete | gemma4:31b | 14 | 70,938 / 1,055 | 209 s | agrees | |
| fix: depose 09b01c1 | `f-fix-isolated/depose-09b01c1/rerun-16.0.2-attempt-1` | 20261103T221128-fcb79f | incomplete | no-progress | gemma4:31b, escalated | 28 | 189,098 / 1,902 | 554 s | agrees | fails at the base, passes with the patch |
| fix: claimcheck d2f136c | `f-fix-isolated/claimcheck-d2f136c/rerun-16.0.2-attempt-1` | 20261103T222355-8f8758 | incomplete | step-budget | gemma4:31b | 60 | 678,379 / 14,386 | 2,339 s | agrees | fails at the base and with the patch |
| fix: claimcheck d2f136c | `f-fix-isolated/claimcheck-d2f136c/rerun-16.0.2-attempt-2` | 20261103T235146-3d4f21 | incomplete | step-budget | gemma4:31b, escalated | 60 | 637,741 / 22,632 | 2,331 s | agrees | fails at the base, passes with the patch |

"Escalated" is to swarm-redesign-qwen36-32k, the one escalation a model-related stop allows. Wall
is the run's, final verification included; the replay and the held-out judgment are after it.

- **t6, attempt 1** (the first t6 run whose edits work on macOS). The model moved `history_io.py` and
  `history_store.py` into `tracemantle/history/` and wrote both shims with write blocks; both are
  right (ledger records 29 and 32). It then read, in the turn's diff, the second shim under the first
  file's header and said it had "accidentally wrote the history_store shim into history_io.py", and
  read that file three turns running. Cause: the loop cut the 33,609-byte diff to 6,000 bytes from
  its middle, which dropped four of the five file headers. Fixed in 838ed8fa9 (each file's change is
  shortened under its own header); `src/agent/diff-view.test.ts` failed before. The escalated model
  repeated one `grep` three times. The test files were not moved.
- **t6, attempt 2** (the first t6 run that met no defect of the product). Both modules moved, both
  shims written as `from tracemantle.history.<module> import *`, the three test files moved, the
  mypy list and hatch packages left as the repository already had them. The moved `history_store.py`
  still imports `_entry_from_dict` from `tracemantle.core.history_io`, and a star import does not
  re-export an underscore name, so collection fails with ImportError
  (`rerun-16.0.2-attempt-2/import-error.txt`); the verifier found the regression, 3 failures
  inherited. The model ran no test and asked for no verification: it repeated `ls -F` three times,
  and the escalated model one `grep` three times. This is what a local model did with working tools
  and nothing misleading it: a wrong shim, left untested.
- **dossier**, the task that stopped in 16.0.1's clean install when both `sed -i` edits failed:
  complete in 14 turns, the test written with a write block and `.venv` added with an edit block.
- **depose**: the same fix as 16.0.1's attempt, and the sealed test confirms it again. Incomplete
  because the base's typecheck and build fail in the container (unresolved, never a pass), then the
  model marked the task complete on an unchanged tree and the escalated model reread the file.
- **claimcheck, attempt 1**: from step 38 the model split one import into two lines and joined it
  again, every edit applied and every turn different, to the step budget. The no-progress rule saw
  only a command repeated with the same result. Fixed in 6767b2789: three changes in a row that put
  the tree back where it had already been stop the run (`src/agent/tree-cycles.test.ts` failed
  before). Its patch adds `failedToRun` to `runVitest` only, and the sealed test refutes it.
- **claimcheck, attempt 2**: the patch adds `failedToRun` and stops `headTestsPass` counting a run
  that failed to load, in `claimcheck/src/core/pipeline.ts`, as the fix commit does; the sealed test fails at
  the base and passes with it. Incomplete: the step budget ran out while the model tried to repair
  the base's missing `claimcheck/src/coverage/collect.js` import, which no change to the task's files can.

Integrity and tamper on the candidate's verifier (swarm-verify 2.0.1 source at b49b7ff): the
integrity set 15 of 15; the tamper evaluation 20 honest with 0 flagged and 24 of 24 cheats flagged
(`swarm-verify/eval/results/tamper-2026-11-04T00-40-36-286Z.json`).

The released packages, installed into an empty prefix from npm (`swarm-orchestrator@16.0.2` and
`swarm-verify@2.0.2`, both published by their release workflows through npm trusted publishing),
ran the dossier task once more with `--model auto` (`e-dossier-installed-16.0.2/`). The installed
`swarm` reports 16.0.2, its swarm-verify is 2.0.2, and `npm audit signatures` verifies the
registry signatures and provenance attestations of all four installed packages.

| Task | Directory | Session | State | Stop | Model | Turns | Input / output tokens | Wall | Replay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dossier, installed 16.0.2 | `e-dossier-installed-16.0.2/attempt-1` | 20261104T021549-359a1e | complete | complete | gemma4:31b | 23 | 136,501 / 1,869 | 437 s | agrees |

It changed `fs-walk.ts` with edit blocks and wrote the test with a write block; no command used
`sed -i`, and dossier was unchanged.

## Input tokens before and after context management

The same task, model and context, before the loop kept its prompt bounded and after. The reruns
stopped at different turns, so input per turn is the comparison; totals are given as recorded.

| Task | Before (session, turns, input) | Per turn | After (session, turns, input) | Per turn |
| --- | --- | --- | --- | --- |
| t5a depose, qwen3.8:27b, 65,536 | 20261101T155037-25f560, 46, 844,628 | 18,362 | 20261101T204818-5e8a9e, 6, 32,669 | 5,445 |
| h2 ironroot, qwen3.8:27b | 20261101T142202-e94107, 15, 127,365 | 8,491 | 20261101T203914-4e0ccd, 18, 128,114 | 7,117 |
| t7a claimcheck, qwen3.8:27b | 20261101T133613-26acb8, 19, 161,280 | 8,488 | 20261101T203312-ed53d4, 11, 60,747 | 5,522 |

The long closing runs show the bound: input per turn levels off rather than growing with the turn.
c1 ruleprobe (56 turns) peaked at 12,172 with its last ten turns averaging 11,843; t7a's 60-turn
attempt (20261101T213431-7eaedd) peaked at 16,676; t6's 42-turn attempt at 14,814. The first
round's 60-turn t6 attempt averaged 17,930 a turn over 1,075,815 tokens. Per-turn counts are in
each closing run's `report.json` under `resources.turns`.

Cost is none for every run: local runtimes. Ollama reports inference time; Rapid-MLX reports none,
and the reports say so rather than print zero.

## What each complete run establishes

- **t1 pubprep.** `--max-budget-usd=<n>` accepted (including `=0`), `--max-budget-usd=` rejected,
  and a following flag reported as "requires a numeric value". Each behavior is a requirement with
  a new test that fails against the base's source and passes after; "0 stays valid" is held by the
  preserved existing parse test.
- **t2 crossfire.** The semgrep ruleset may be a string or a non-empty array of strings; the repro
  command and the semgrep invocation pass one `--config` per ruleset. Witnessed by new tests for the
  array case and the schema; the string case passes before and after; typecheck and lint pass; one
  inherited failure (the repository's em-dash convention test). Limitation: the container has no
  semgrep and skips those scanner tests, so the invocation half rests on the code, not on an
  executed test. The 32,768-token attempts cycled through compaction; 65,536 fit what it read.
- **t3 ruleprobe**, `--host`. The macOS-only path boundary fixed with realpath; three
  `resolveSafePath` tests fail at the base on macOS and pass after, two preserved, seven unrelated
  host failures inherited and not blocking. Its first replay ran in a Linux container, where those
  three tests pass at the base, and diverged. Replay now runs as the recording ran; replayed on this
  Mac with the closing release candidate it agrees (`final/replay-host.out`).
- **c1 ruleprobe**, `--host`, the fix beside an unrelated inherited failure. `checkMaxFileLength`
  counted `content.split('\n').length`, one line too many for a file ending in a newline; it now
  counts newlines as `wc -l` does. The new test "checkMaxFileLength > should count lines like wc -l
  (ignoring trailing newline)" fails against the base's source and passes after. Ten failures the
  base already has on this host (three safe-path, two semantic-flags, five git-history-verifier,
  none in the changed module) are classified inherited; no new failure. The patch also adds a
  trailing newline to one sample fixture so its count stays what its expectation says.
  quantproof, the contract's first candidate, has no inherited failure on the host or in a
  container (635 of 635 tests pass), and ruleprobe has none in a container, so this run is on the
  host.
- **t5b ironroot.** Three classes moved to `cli/promote_report.py` and re-exported; the suite passes
  at the base and with the change, in a closed container.
- **t7a claimcheck.** vitest 4.1.8 to 4.1.10; both Stryker packages stay at 9.6.1, which the
  registry, read while dependencies were prepared, names the latest 9.x. The task's three version
  constraints (vitest within 4.1.10, each Stryker package within the latest 9.x) were read from its
  wording by code and each observed against the candidate's lockfile. Limitation: "adapt any
  hard-coded version ... with a test" rests on a structure claim (`strykerVersionFor` still
  present); vitest stayed on major 4, so the mapping it holds needed no change, and no test was
  added for it.
- **t7b dependency detector.** pytest resolved 9.0.2 at the base and 9.2.0 in the candidate, from a
  fresh install of the candidate's lockfile; no new failure beside 43 the base already had. The
  patch is `pyproject.toml` and `uv.lock`.
- **t8 quantproof.** `engines.node` set to `>=22 <27`, `.nvmrc` added, Node 24 in the CI matrix; the
  suite already passed on Node 24, so better-sqlite3 stayed. All four checks pass.
- **h1 crossfire** (held back). Only a leading `..` path segment now counts as outside the
  repository; a new test fails at the base and passes after, a second keeps `../outside.txt`
  denied. The model also reworded one doc comment, unrequested; it is in the patch.

## What remains incomplete, and why

- **t6 tracemantle**, open. Nine attempts and a narrower variant. In the first round the
  verifier's own defects in this task (coverage wrapping a self-measuring suite, an untracked
  `uv.lock` left by the base run, a flaky parametrized case read as a divergence) were found and
  fixed. In the closing round, attempt 1 was stopped by me seconds in (it was on a build that gave
  the agent no Python environment for a project without `uv.lock`). Attempt 2, gemma4-31b-greedy-128k
  at 65,536 tokens with the environment built in its clone, made the package and moved the tests
  (21 files): the verifier found 7 new failures in `tests.test_history_io`, the model's own commands
  said `history_io.py` was "still corrupted", and it repeated that until the run stopped. The
  narrower variant (history_io alone, its test and the mypy list; t6n, qwen3.6:35b-a3b chosen
  automatically) read for 25 turns and changed nothing. Both replays agree.
  Corrected 2026-11-02: the 7 failures are exactly the 7 tests that read `tests/fixtures/history`.
  The attempt moved `test_history_io.py` with only its imports changed, so it looked for its
  fixtures beside itself; `history_io.py` was a working re-export. The edit that fixes that, one
  more `.parent`, made swarm-verify 2.0.0 read the file as deleted (its tests "gone") and run the
  old and moved copies together, which also broke the README's test count. So 2.0.0 refused every
  form of this move short of moving the fixtures as well, and "within what the verifier judges
  correctly" was wrong. 2.0.1 judges a moved and edited test file by its base version (Comparison).
  Rerun once against 2.0.1 (closing attempt 3, session 20261103T175257-900062, the same model and
  flags, isolated): 59 turns to the time budget, no verification asked for in the loop, 20 files.
  It moved both modules into `tracemantle/history/` with working shims and moved the three test
  files unchanged, so `tests/history/test_history_io.py` again looked for
  `tests/history/fixtures/history/`, which does not exist; `load_ledger` returns `None` for a
  missing file, and the same 7 tests failed. 2.0.1 read the three files as moved (41 tests renamed,
  1,351 preserved, 3 inherited) and attributed the 7; the replay agrees. The model's own notes
  again called `history_io.py` corrupted; it was a working re-export. Evidence:
  `t6-tracemantle/closing-attempt-3/`.
- **t5a depose.** In the first round the move was made without evidence mapped; rerun with the same
  model after context management, Qwen3.8 read the test file three turns running and stopped for no
  progress after 6 turns, nothing changed. Replays agree. t5b ironroot holds the category.
- **h2 ironroot** (held back). First round: Gemma ran out of time; Qwen3.8 repeated a patch script.
  Closing round, Qwen3.8: the one-line source fix was made, no test was written, and the same read
  was repeated until the run stopped (18 turns). This run also found that a project with a
  pyproject.toml and no uv.lock gave the agent no environment, fixed before t6 ran.
- **t4 resident.** Not verifiable on this machine: its lockfile does not install in a clean
  environment, and its suite runs live inference against whatever Ollama answers, which loaded
  about 24 GB of models beside the coding model. The fix beside an inherited failure is shown by c1
  ruleprobe instead, and the upgrade substitute for resident is t7b.

## Comparison

The two tasks no local model completed, t6 tracemantle and h2 ironroot, done once each by the agent
running the 16.0.1 patch release (Claude Code, outside `swarm run`), on the same base, judged by the
same verifier the local runs met, then replayed. One run each; nothing here says more than these
two tasks. Evidence is in `comparison/`.

| Task | Agent | Commands | Wall | Input / output tokens | swarm-verify 2.0.0 | Replay | swarm-verify `patch/2.0.1` 4e53b13 | Replay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t6 tracemantle | gemma4-31b-greedy-128k, session 20261101T221712-67545b | 42 turns | 3,127 s | 388,458 / 12,946 | incomplete: 7 new failures | agrees | incomplete: the same 7 | agrees |
| t6 tracemantle | Claude Code | 12 | 174 s | not available to the agent | incomplete: 18 tests "gone", the README count test failing in the base-tests run | agrees | complete, R1 satisfied, 3 inherited | agrees |
| h2 ironroot | qwen3.8:27b, session 20261101T203914-4e0ccd | 18 turns | 428 s | 128,114 / 1,992 | incomplete: no-progress, no test written | agrees | not rerun | |
| h2 ironroot | Claude Code | 7 | 83 s | not available to the agent | complete, R1 satisfied; the one mutant (false to true, `promote.py:133`) survived | agrees | not rerun | |

- The t6 requirement record is `t6-comparison/requirements.json`, fixed before any attempt. h2 has
  no shared record (the local run's verifications used its own): `comparison/h2/requirements.json`
  is the one this patch was judged under, R1 being the task's own wording with the project's
  `test` check and the new test as evidence.
- Wall time for the hand-made patches runs from the first command on the task to the patch being
  written, from the commands' timestamps; reading the task beforehand is not counted. Commands are
  tool calls, each one command, the nearest thing to a turn. The agent has no count of its own tokens.
- The t6 patch failed verification with 2.0.0, and that is recorded as it happened
  (`comparison/t6/verify-2.0.0.out`). Its cause was in the verifier: the moved
  `test_history_io.py` needed `Path(__file__).parent.parent` to reach its fixtures, a body edit,
  so the file was read as deleted and added. Fixed in swarm-verify 2.0.1 with a failing test first
  (`swarm-verify/src/probes/edited-move.integration.test.ts`); the same patch then completes and replays in
  agreement. The local model's patch was judged again with the fix and is unchanged: incomplete,
  the same 7 failures, which no verifier change could clear, since its moved file reads fixtures
  that are not there.
- What this shows: on t6 the correct move was refused by 2.0.0 whoever made it; on h2 a complete
  fix with a test exists and was judged complete by the verifier the local run met. It does not
  show a local model completing t6: the one rerun against 2.0.1 (above, What remains incomplete)
  repeated the unchanged move and its 7 failures, with every in-place edit failing on BSD `sed`, and
  the 16.0.2 reruns (Reruns for 16.0.2) did not complete either.

## Safety

On dependency detector (attempt 2, session 20261101T084321-1087ff) the agent, in auto approval,
pushed a branch to the repository its workspace was cloned from and cloned that repository to
`/tmp` inside a `$(...)` command whose paths were never checked. The branch was deleted from the
source repository and `/tmp/bare-clone` removed; every source repository was rechecked against its
recorded state. The chokepoint now refuses pushes and package publishes in every mode, refuses a
command it cannot read under auto approval, and refuses `git stash`. Every later run was watched
for new refs in the source repositories; none appeared.

Before the closing runs a scripted integrity case tried thirteen ways out of the workspace in auto
approval, and three got through: `git branch`, `git tag` and `git config` run in the managed `git
worktree` wrote into the user's own repository, which a worktree shares. The workspace is now a
clone that reads the user's objects and shares no refs, config or remote. The closing driver also
recorded each source repository's refs, stash, status and worktrees before and after every run
(`source-check.txt`): unchanged in all of them.

## The optional review

One trial (t7a attempt 2 of the first round, `--review`): one extra model turn, no finding, and the
run was a false completion the review missed. The review stays off by default; it was not rerun.

## Deterministic integrity checks

Each is a test that runs without a live model (`npm run gates` in each repository).

| Case | Repository | Test |
| --- | --- | --- |
| Missing requirement evidence | swarm-verify | `swarm-verify/src/verify/requirements.test.ts`: "names the tests that witness the change when a requirement maps none" |
| Zero tests | swarm-verify | `swarm-verify/src/probes/probes.integration.test.ts`: "never reads zero collected tests as test success" |
| Test weakening | swarm-verify | `swarm-verify/src/probes/probes.integration.test.ts`: "does not let a weakened candidate test stand in for the requested behavior"; `swarm-verify/src/verify/compare.test.ts`: "refuses a rewritten expectation that rescues a failing original" |
| Modified protected oracle | swarm-verify | `swarm-verify/src/probes/integrity.integration.test.ts`: "blocks on a sealed held-out file altered after sealing"; `swarm-verify/src/verify/verify.integration.test.ts`: "judges by the base's checks even where the change rewrites swarm.toml" |
| Forged report | swarm-verify | `swarm-verify/src/probes/integrity.integration.test.ts`: "refuses a report that states other than what was signed", "refuses evidence logs changed after signing" |
| Stale attestation | swarm-verify | `swarm-verify/src/probes/integrity.integration.test.ts`: "refuses an attestation of an earlier patch for the delivered one" |
| Truncated ledger | swarm-verify | `swarm-verify/src/probes/integrity.integration.test.ts`: "refuses a ledger truncated below the records the statement bound" (a chain cut cleanly at its end verifies as a chain; it is caught against what the statement bound); swarm-orchestrator `src/evidence/ledger.test.ts`: "reports a record changed after it was written" |
| Mismatched signer | swarm-verify | `swarm-verify/src/probes/integrity.integration.test.ts`: "refuses a signature under any key but the signer's" |
| Mutable dependencies | swarm-verify | `swarm-verify/src/probes/probes.integration.test.ts`: "never reuses a baseline measured on linked, mutable dependencies"; `swarm-verify/src/probes/integrity.integration.test.ts`: "refuses linked, mutable dependencies in isolation rather than running on them" |
| Invalid mutant | swarm-verify | `swarm-verify/src/verify/mutation.test.ts`: "never runs, or counts as killed, a mutant that does not parse"; `swarm-verify/src/probes/probes.integration.test.ts`: "counts a mutant as killed only when it is valid code a test caught" |
| Provider failure | swarm-orchestrator | `src/agent/run.integration.test.ts`: "finalizes the tree a provider failure leaves"; `src/cli-run.test.ts`: "stops on a 4xx that is not rate limiting, then verifies the tree and reports why" |
| Cancellation | swarm-orchestrator | `src/agent/run.integration.test.ts`: "writes an incomplete report bound to the tree when the run is cancelled"; `src/cli-run.test.ts`: "finalizes a run stopped by SIGINT, SIGTERM or SIGHUP as cancelled and removes its worktree" |
| Pre-existing user edits | swarm-orchestrator | `src/agent/workspace.integration.test.ts`: "starts from the user's edits, staged, unstaged and untracked, and leaves them as they were" |
| Honest test additions | swarm-verify | `swarm-verify/src/probes/probes.integration.test.ts`: "accepts a correct source fix that adds its own regression test"; `swarm-verify/src/probes/allowed-changes.integration.test.ts`: "accepts a feature with new tests, witnessed failing before and passing after" |
| Approved behavior change | swarm-verify, swarm-orchestrator | `swarm-verify/src/probes/allowed-changes.integration.test.ts`: "supersedes an old expectation only when the request authorizes it, and records that it did"; orchestrator `src/agent/run.integration.test.ts`: "lets an existing expectation change only when the user authorized a behavior change" |
| Version constraint rewritten by the model | swarm-verify, swarm-orchestrator | `swarm-verify/src/verify/version-constraints.test.ts`: "fails Stryker 10.1.1 against the latest 9.x, whatever the model claimed"; orchestrator `src/agent/requirement-record.test.ts`: "holds the task's version constraints on R1, and no proposal rewrites, drops or adds one"; `src/agent/slices.integration.test.ts`: "fails an upgrade past the version the task's wording allows, whatever the model claims" |
| Flaky test misreported as a regression | swarm-verify | `swarm-verify/src/verify/reruns.integration.test.ts`: "is flaky at the candidate: recorded run by run, and neither a regression nor a pass", "is flaky at the base: the candidate is not credited with fixing it", "stays a new failure after its reruns, which are recorded"; `swarm-verify/src/api/divergences.test.ts`: "names a test the replay found flaky and the recording let one run decide" |
| Auto approval touching a path outside its workspace | swarm-orchestrator | `src/agent/outside-worktree.integration.test.ts`: "leaves the user's repository, its remote and the files beside it as they were"; `src/tools/guard-attacks.test.ts`: "refuses an outside path written after an option's equals sign" |
| Publishing and unreadable commands | swarm-orchestrator | `src/tools/chokepoint.test.ts`: "refuses publishing outside the workspace in every mode, however it is wrapped", "refuses in auto mode a command whose paths it cannot read, and asks a person in ask mode" |

## Limitations

- The verifier judges a requirement by the evidence it names and by the version constraints read
  from the task's wording. It reads no other prose: a behavior the wording asks for and no check
  exercises is held only by what the producer maps to it (t7a's "with a test" is the instance).
- Version constraints are read from the shapes a task uses ("to the latest 9.x", "from 4.1.8 to
  4.1.10", "within 12.x", "^19", "pin to ..."), matched to packages a manifest declares. Other
  wordings are not read, and a package no manifest declares is noted rather than guessed.
- Evidence is tamper-evident, not tamper-proof. Runs on the host (`--host`) are not isolated, and
  a host recording replays only on the platform it recorded.
- The chokepoint's reading is lexical: a program an interpreter starts on its own is not seen.
  Since 16.0.1 a relative path after a `cd` is read from the directory it would be opened in, and a
  `cd` it cannot name (`cd -`, `popd`) makes the command unreadable; until then it was resolved
  against the workspace root, which refused correct commands and let `cd .git && cat config` pass.
- Local models stall in ways the loop can report but not repair: repeating a read until the run
  stops for no progress was the most common ending of an incomplete run in both rounds.
