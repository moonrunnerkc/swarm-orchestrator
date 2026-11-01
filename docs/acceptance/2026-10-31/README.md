# Product acceptance, 2026-10-31 to 2026-11-01

Eight real tasks across Brad's own repositories, Node/TypeScript and Python, and two held back for
the release check. Every run used a local model with nobody in the loop:

    swarm run "<task>" --approve auto --max-steps 60 --max-minutes 60 [--endpoint ... --model ... --context ...]

on a fresh clone of the source repository with its dependencies installed as a user's checkout has
them, followed by `swarm-verify replay` of the final verification with the pinned verifier package.
No run needed Brad's intervention. The figures below are copied from each run's `report.json`;
nothing here is measured anew.

Each task directory holds `final/` (the last run) and `attempt-N/` (every earlier one): `task.txt`
(the request), `start.txt` (the starting commit), `delivered.patch` (the change), `report.md` and
`report.json` (the requirement report, model, resources), `result.json` where kept, `run.out` (the
printed summary), `replay.out` (the independent replay), `trace.txt` (every command the model ran)
and `session.txt` (the evidence session under `~/.swarm/sessions/`, which holds the hash-chained
ledger and the signed attestation). What each failed attempt taught, and the fix it led to, is in
`docs/DECISIONS.md` under 2026-11-01.

## Categories

| Category | Task | Final run | Replay |
| --- | --- | --- | --- |
| Feature with a boundary case | t1 pubprep | complete | agrees |
| Multi-file feature, backward compatible | t2 crossfire | complete | agrees |
| Fix a real defect | t3 ruleprobe, h1 crossfire | complete, complete | see t3; agrees |
| Fix beside an inherited failure | t3 ruleprobe (t4 resident could not be verified here) | complete | see t3 |
| Refactor: move without behavior change | t5b ironroot (t5a depose incomplete) | complete | agrees |
| Refactor across modules, tests and config | t6 tracemantle | incomplete | diverges by one test |
| Upgrade a dependency | t7b dependency detector (t7a claimcheck incomplete) | complete | agrees |
| Upgrade the runtime | t8 quantproof | complete | agrees |

Seven of the eight categories have a complete, replayable run. The cross-module refactor does not:
see t6. Of the two held-back tasks, h1 completed on its first run and h2 did not.

## Final runs

| Task | Model | State | Stop | Turns | Input / output tokens | Wall | Attempts before |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t1 pubprep | qwen3.8:27b (Rapid-MLX) | complete | complete | 32 | 290,094 / 6,135 | 425 s | 5 |
| t2 crossfire | qwen3.8:27b (Rapid-MLX, 65,536 context) | complete | complete | 38 | 646,974 / 4,653 | 687 s | 9 |
| t3 ruleprobe | swarm-redesign-qwen36-32k (Ollama, auto) | complete | complete | 30 | 560,835 / 4,765 | 322 s | 2 |
| t4 resident | swarm-redesign-qwen36-32k (Ollama, auto) | incomplete | time-budget | 22 | 209,209 / 2,642 | 2,910 s | 2 |
| t5a depose | qwen3.8:27b (Rapid-MLX, 65,536 context) | incomplete | no-progress | 46 | 844,628 / 5,808 | 438 s | 3 |
| t5b ironroot | swarm-redesign-qwen36-32k (Ollama, auto) | complete | complete | 39 | 735,845 / 7,243 | 224 s | 0 |
| t6 tracemantle | swarm-redesign-qwen36-32k (Ollama, named, 65,536 context) | incomplete | step-budget | 60 | 1,075,815 / 10,300 | 1,065 s | 5 |
| t7a claimcheck | qwen3.8:27b (Rapid-MLX) | incomplete | no-progress | 19 | 161,280 / 1,236 | 151 s | 4 |
| t7b dependency detector | gemma4-31b-greedy-128k (Ollama, auto) | complete | complete | 11 | 56,251 / 302 | 224 s | 2 |
| t8 quantproof | qwen3.6:35b-a3b (Ollama, auto) | complete | complete | 34 | 222,006 / 1,990 | 226 s | 1 |
| h1 crossfire | gemma4-31b-greedy-128k (Ollama, auto) | complete | complete | 23 | 299,897 / 3,421 | 944 s | 0 |
| h2 ironroot | qwen3.8:27b (Rapid-MLX) | incomplete | no-progress | 15 | 127,365 / 1,860 | 211 s | 1 |

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
  host failures inherited and not blocking. The replay, which runs in a Linux container, diverges
  as it must for a macOS-only defect: those three tests pass at the base there. Replay is
  container-only by design; this run's agreement can only be checked on another macOS host.
- **t5b ironroot.** Three classes moved to `cli/promote_report.py` and re-exported; the suite passes
  at the base and with the change, in a closed container.
- **t7b dependency detector.** pytest resolved 9.0.2 at the base and 9.2.0 in the candidate, from a
  fresh install of the candidate's lockfile; no new failure beside 43 the base already had. The
  patch is `pyproject.toml` and `uv.lock`.
- **t8 quantproof.** `engines.node` set to `>=22 <27`, `.nvmrc` added, Node 24 in the CI matrix; the
  suite already passed on Node 24, so better-sqlite3 stayed. All four checks pass.
- **h1 crossfire** (held back). Only a leading `..` path segment now counts as outside the
  repository; a new test fails at the base and passes after, a second keeps `../outside.txt`
  denied. The model also reworded one doc comment, unrequested; it is in the patch.

## What remains incomplete, and why

- **t6 tracemantle.** Six attempts. The verifier's own defects in this task (coverage wrapping a
  self-measuring suite, an untracked `uv.lock` left by the base run) are fixed. The last attempt
  made most of the move, 39 moved tests recognized as renamed, but broke 30 history CLI tests, which
  the verifier found. Its replay agrees on the state and on 30 of the 31 failures: one
  parametrized case failed in the replay and not in the recording, against a broken candidate.
- **t5a depose.** The move was made; no evidence was mapped to the requirement, and the model
  repeated a command until the run stopped. Replayed with the corrected verifier: agreement.
- **t7a claimcheck.** Attempts 1 and 2 completed falsely: the task allowed Stryker "to the latest
  9.x" and both delivered 10.1.1, which the model's own package claim named and the verifier
  confirmed. The verifier now takes a version range in a package claim and fails a version outside
  it, and the prompt says a claim names the version the task asks for; the verifier still reads no
  prose, so a claim that names the wrong version still passes. Attempt 3 made the correct upgrade
  (vitest 4.1.10, Stryker on 9.x) but cited an undeclared check; attempts 4 and 5 stalled reading.
  This false completion is a known residual: see Limitations.
- **h2 ironroot** (held back). Gemma ran out of time; Qwen3.8 repeated a patch script that found
  nothing to replace.
- **t4 resident.** Not verifiable on this machine: its lockfile does not install in a clean
  environment, and its suite runs live inference against whatever Ollama answers, which loaded
  about 24 GB of models beside the coding model. The fix-beside-inherited-failure category is
  shown by t3 instead, and the upgrade substitute for resident is t7b.

## Safety

On dependency detector (attempt 2, session 20261101T084321-1087ff) the agent, in auto approval,
pushed a branch to the repository its workspace was cloned from and cloned that repository to
`/tmp` inside a `$(...)` command whose paths were never checked. The branch was deleted from the
source repository and `/tmp/bare-clone` removed; every source repository was rechecked against its
recorded state. The chokepoint now refuses pushes and package publishes in every mode, refuses a
command it cannot read under auto approval, and refuses `git stash`. Every later run was watched
for new refs in the source repositories; none appeared.

## The optional review

One trial (t7a attempt 2, `--review`): one extra model turn, no finding, and the run was a false
completion the review missed. The review stays off by default.

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
| Publishing and unreadable commands | swarm-orchestrator | `src/tools/chokepoint.test.ts`: "refuses publishing outside the workspace in every mode, however it is wrapped", "refuses in auto mode a command whose paths it cannot read, and asks a person in ask mode" |

## Limitations

- The verifier judges a requirement by the evidence the requirement names. It reads no prose: a
  model that writes the wrong version into its own claim, or names no behavior it skipped, is held
  only by what the executed checks show. t7a's first two runs are the instance.
- Evidence is tamper-evident, not tamper-proof. Runs on the host (`--host`) are not isolated and
  their replay, which runs in a container, may legitimately diverge (t3).
- The chokepoint's reading is lexical: a program an interpreter starts on its own is not seen.
- Local models stall in ways the loop can report but not repair: repeating a read until the run
  stops for no progress was the most common ending of an incomplete run here. A sampled turn tried
  against it broke none of three repeats and was removed.
