# Swarm and Claude Code on four tasks (2026-11-04)

Section 12 of the recovery plan asks how Swarm on local models and Brad's usual CLI agent compare
on the same tasks under the same acceptance criteria: completion quality, inconvenience and total
resource use. Four tasks, one per category, from repositories no earlier acceptance task used for
that task. Each task's `task.md`, `criteria.md`, `requirements.json`, `judge.toml` and held-out
tests were committed (90afcf52b) before either agent started, after each held-out check was shown
to fail at the base and pass with a known good patch (`*/screening/`).

- **Swarm**: the installed swarm-orchestrator 16.0.4 with swarm-verify 2.0.3, `swarm run "<task.md>"
  --model auto --approve auto --max-steps 60 --max-minutes 60`, isolated, on Ollama 0.32.14 with
  cloud models disabled, then `swarm-verify replay` of its final verification
  (`scripts/swarm-run.sh`).
- **Claude Code**: a fresh Claude Code subagent (Claude Opus 5.5) given only the task's text, the
  clone's path and the rules in `claude-prompt.md`, in a clone prepared exactly as Swarm's
  (`scripts/claude-prep.sh`). Its patch is the working tree's diff against the base.
- **Judging**: both patches by the same `scripts/judge.sh`: a fresh clone at the base, the held-out
  tests sealed, `judge.toml` as the declared checks, `swarm-verify verify` with the task's
  `requirements.json`, isolated, then `swarm-verify replay`. Every one of the eight replays agrees.

| Task | Category | Swarm: state (judged) | Swarm: model | Swarm: tokens in / out | Swarm: wall | Swarm: interventions | Claude Code: state (judged) | Claude Code: wall | Claude Code: tokens (reported) | Claude Code: interventions | Verifier, Swarm's patch | Verifier, Claude Code's patch |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fix-claimcheck` | fix | incomplete | gemma4:31b, 50 turns | 527,962 / 14,421 | 2,814 s | 0 | complete | 163 s | 61,361 | 0 | R1 unverified; held-out pass; no regression | R1 satisfied; held-out pass; no regression |
| `feature-pubprep` | feature | incomplete | gemma4:31b, escalated to qwen3.6:35b-a3b, 42 turns | 315,549 / 9,980 | 956 s | 0 | complete | 111 s | 81,194 | 0 | R1 satisfied; held-out fail; no regression | R1 satisfied; held-out pass; no regression |
| `refactor-ironroot` | refactor | incomplete | gemma4:31b, escalated to qwen3.6:35b-a3b, 22 turns | 230,871 / 12,767 | 1,097 s | 0 | complete | 167 s | 79,932 | 0 | R1 satisfied; held-out fail; no regression | R1 satisfied; held-out pass; no regression |
| `upgrade-claimcheck` | upgrade | complete | gemma4:31b, escalated to qwen3.6:35b-a3b, 48 turns | 546,364 / 9,486 | 1,933 s | 0 | complete | 150 s | 58,478 | 0 | R1 satisfied; held-out pass; no regression | R1 satisfied; held-out pass; no regression |

How the columns were measured:
- **State (judged)** is the verdict of `judge.sh`, not either agent's own account.
- **Swarm's tokens and turns** come from its session report.
- **Swarm's wall** runs from launch to exit, its own verifications and finalization included.
- **Claude Code's wall** runs from its first command to its last (`date -u`, by its own report).
- **Claude Code's tokens** are the one total the Agent tool reported to the session that
  delegated it, with no input/output split; its tool uses were 13, 16, 17 and 14.
- **Interventions** are zero on both sides: nobody approved, answered or edited anything during a
  run.
- **Setup** was the same for both before a run: a clone at the base with dependencies installed
  (`npm ci`, or `uv venv` and `uv pip install -e .[dev]`). Swarm also needed colima and Ollama
  running and a local model on disk.

## Per task

**fix-claimcheck** (claimcheck e050152, base d381bec).
- **Swarm.** Its patch makes the change in `test-weakening.ts`, `decision.ts` and
  `evidence-record.ts` and passes the sealed tests of the fix commit. Its tests went into six new
  files under `test/unit/`, several repeating each other (`-r3`, `-r3-regression`,
  `-r3-regression-final`, `-r3-fail-base`). The verdict lists 7 of its added tests as failing
  before and passing after.
- **R1's evidence.** The requirement maps tests under `src/` only, where claimcheck keeps its
  tests beside their sources. That is narrower than the repository allows, since its vitest
  config also collects `test/**`. I wrote the criteria that way before either run, so R1 reads
  unverified for Swarm's patch.
- **Claude Code.** Its patch changes the same three source files, adds its tests to the existing
  `src/` test files, and is complete.

**feature-pubprep** (pubprep 99d8d05, `--reviewers`).
- **Swarm.** Its patch parses and wires the option. It fails one of the ten sealed cases: it
  keeps the order the names were typed in, where the task asks for tech-debt, docs, security
  "whatever order they were typed" (`swarm/held-out-host.out`).
- **Claude Code.** Its patch passes all ten and is complete. It also changed two help and prompt
  lines that said "three" reviewers.
- **The self-reports.** Swarm reported its run complete; its own tests did not cover the order.

**refactor-ironroot** (ironroot 1d325c2, the built-in falsifiers to `builtin_claims.py`).
- **Swarm.** Its patch adds `builtin_claims.py` with copies of the three falsifiers and the tuple,
  and leaves `falsification.py` as it was. Its structure claims hold (the new file holds the
  functions); the sealed structural test fails, since the old module still defines them. Swarm
  stopped on no progress and reported the run complete.
- **Claude Code.** Its patch moves them, imports the tuple lazily in `get_claim_registry` and
  serves it through a module-level `__getattr__` so the old import keeps working, and is complete.

**upgrade-claimcheck** (claimcheck d93aea5, vitest 5 with Stryker 10).
- **Both patches** resolve vitest 5.1.0, @vitest/coverage-v8 5.1.0 and both Stryker packages
  10.1.1 (the registry's targets in `registry.txt`), move the overlay pin to 10.1.1, and are
  complete.
- **Swarm's run.** It reported itself incomplete (unusable replies after escalating). Its first
  verification had said all four packages were failing: the verifier defect below. The model
  spent about 40 turns on that failure, and nothing in its patch was wrong. Its patch also lowers
  `engines.node` from `>=20.19.0` to `>=18.18.0`, below what vitest 5 requires (`^22.12.0`).
  Nothing in the criteria tests that field.
- **Claude Code's patch** raises `engines.node` to `>=22.12.0` and drops Node 20 from the CI
  matrix. Neither change was asked for.

## Swarm defects found in Phase 2 and Phase 3

Each is fixed with a failing test first, on a pushed swarm-verify branch, not merged and not
released. Under hard rule 7 a release follows only a defect that changed a comparison outcome.
Judged by the verifier's statuses, none did. The second changed Swarm's own run on the upgrade
task: its turns, tokens, wall, escalation and self-reported state. That is set out below for
Brad's decision.

| Defect | Failing test | Fix commit | Branch | Changed a result |
| --- | --- | --- | --- | --- |
| Isolated checks run as a uid the image's passwd does not list, so ssh-keygen and anything else that looks its user up fails (47 tracemantle tests read as inherited) | `swarm-verify/src/probes/isolated.integration.test.ts`, "runs the checks as a user the image's passwd and group list" | d8ed6bc | `fix/container-user-entry` | No: no compared project looks its user up |
| A package claim's version read `^5` as a version nothing equals, so a correct upgrade failed "outside ^5" | `swarm-verify/src/verify/requirement-evidence.test.ts`, "holds a caret or tilde range, as the version constraints read it" | 401c196 | `fix/version-claim-ranges` | Not the judged result (the sealed criteria wrote `5.x`); it did drive Swarm's upgrade run into about 40 turns on a false failure and a self-reported incomplete |
| A structure claim could not say a text left a file, so a copy read as a move | `swarm-verify/src/verify/requirements-refactor.test.ts`, "a move whose text stays behind in the old file" | 7128a1b | `fix/structure-text-absent` | No: the sealed check failed the copy either way |

The third needs a matching change in the agent's prompt once a verifier carrying it is released
(`docs/FOLLOW-UPS.md`).

## What these four show

On these four tasks, under criteria sealed before either agent ran:
- **Claude Code's four patches** were each judged complete.
- **Swarm's patches** were judged complete on the upgrade and incomplete on the other three:
  - one sealed case failed on the feature;
  - the refactor was a copy rather than a move;
  - on the fix, the tests sat where the criteria did not look.
- **Swarm's self-reports** said complete for the feature and the refactor, which the sealed
  checks contradicted, and incomplete for the upgrade, which they did not.
- **Resources.** Swarm ran entirely on this machine at no API cost. It took 956 s to 2,814 s and
  230,871 to 546,364 input tokens a task. Claude Code took 111 s to 167 s and 58,478 to 81,194
  reported tokens a task, on Anthropic's service.

These are single attempts on four tasks and say nothing about other tasks or other runs. Swarm's
upgrade figures were inflated by a defect in its verifier. The fix-task criteria were narrower than
the repository's layout. The Claude Code attempts ran while the tracemantle branch's verification
was using the machine's container, and the Swarm runs ran alone.

The agent that ran the Claude Code side is the same model as the agent that chose the tasks, wrote
the criteria, the held-out tests and the reference patches, and wrote this document. It saw only
`task.md`, but it is not independent of its author. The verifier's statuses are the only judged
outcome here; nothing else in this document is a judgment of either patch.

Evidence: each task's `swarm/` (run output, session report, trace, patch, replay, judgment) and
`claude/` (agent report, patch, judgment), `scripts/`, and the run directories under
/Users/brad/projects/recovery-2026-10-31/comparison/.

## 17.0.0 (2026-11-05)

Swarm only; Claude Code was not run again. Every task once, `swarm run --model auto --approve auto
--max-steps 60 --max-minutes 60`, isolated unless the entry is host-only, from packed tarballs, on
this machine with Ollama and colima (Rapid-MLX was stopped for memory; docs/DECISIONS.md). Each
run's patch was judged by `run-17/judge-17.sh` with the sealed criteria of its corpus entry (the
same as above, with fix-claimcheck's one recorded correction) and replayed with `swarm-verify
replay`. The first four rows are the tasks above; "recorded" is the November 4 row for them and,
for the other six, the latest recorded auto-selected run (docs/acceptance/2026-10-31/README.md).
The candidate is 17.0.0-rc.19 over swarm-verify 2.1.0-rc.11, except h2 and c4dc276c4, run again on
17.0.0-rc.21: rc.19 lost h2's authored check to a coverage-threshold defect and judged c4dc276c4
incomplete against a complete judgment; rc.20 and rc.21 change only how an authored check is
validated at the base (four files of `src/agent`, 75 lines added and 8 removed outside tests;
whether the other eight runs' checks would have been validated the same way on rc.21 was not measured). Each judge ran while the next
task ran, so the wall times are those of a busier machine than November 4's.

| Task | Category | Self-reported | Judged | Model | Turns (recorded) | Tokens in / out | Wall s (recorded) | Turns, wall vs recorded | Replay | Candidate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cmp-fix-claimcheck` | fix | incomplete | incomplete | gemma4:31b | 15 (50) | 247,479 / 20,368 | 1,701 (2,814) | -35, -1,113 s | agrees | 17.0.0-rc.19 |
| `cmp-feature-pubprep` | feature | incomplete | incomplete | gemma4:31b | 10 (42) | 75,856 / 6,244 | 471 (956) | -32, -485 s | agrees | 17.0.0-rc.19 |
| `cmp-refactor-ironroot` | refactor | incomplete | incomplete | gemma4:31b | 16 (22) | 206,560 / 11,847 | 1,237 (1,097) | -6, +140 s | agrees | 17.0.0-rc.19 |
| `cmp-upgrade-claimcheck` | upgrade | incomplete | incomplete | gemma4:31b | 10 (48) | 92,335 / 3,443 | 602 (1,933) | -38, -1,331 s | agrees | 17.0.0-rc.19 |
| `t6-tracemantle` | refactor | incomplete | incomplete | gemma4:31b | 15 (19) | 104,108 / 2,567 | 1,497 (1,212) | -4, +285 s | agrees | 17.0.0-rc.19 |
| `h2-ironroot` (superseded) | fix | incomplete | incomplete | gemma4:31b | 10 (18) | 179,921 / 18,960 | 1,362 (428) | -8, +934 s | agrees | 17.0.0-rc.19 |
| `h2-ironroot` | fix | incomplete | incomplete | gemma4:31b | 15 (18) | 214,905 / 19,709 | 1,333 (428) | -3, +905 s | agrees | 17.0.0-rc.21 |
| `fix-tracemantle-f69ad0c58` | fix | incomplete | incomplete | gemma4:31b | 10 (20) | 47,742 / 2,592 | 544 (821) | -10, -277 s | agrees | 17.0.0-rc.19 |
| `fix-tracemantle-c4dc276c4` (superseded) | fix | incomplete | complete | gemma4:31b | 14 (45) | 103,274 / 5,497 | 761 (1,507) | -31, -746 s | agrees | 17.0.0-rc.19 |
| `fix-tracemantle-c4dc276c4` | fix | incomplete | incomplete | resident-heavy:24b | 7 (45) | 32,143 / 3,850 | 478 (1,507) | -38, -1,029 s | agrees | 17.0.0-rc.21 |
| `fix-depose-09b01c1` | fix | incomplete | incomplete | gemma4:31b | 14 (28) | 145,744 / 14,876 | 1,152 (554) | -14, +598 s | agrees | 17.0.0-rc.19 |
| `fix-claimcheck-d2f136c` | fix | incomplete | incomplete | gemma4:31b | 14 (60) | 98,715 / 3,136 | 300 (2,339) | -46, -2,039 s | agrees | 17.0.0-rc.19 |

What the runs show. No run reported a state its judge contradicted, on the rows that stand; the one
that did (c4dc276c4 on rc.19: three authored cases wrote config keys of their own and failed the
human fix too) was traced, fixed in 17.0.0-rc.21 and run again, where the run and the judge agreed.
No task was judged complete. On the rows that stand: the authored check still failed on the
change and the change broke tests that passed at the base (fix-claimcheck); an authored claim still
failed and the change broke tests (ironroot: the old module still defines _BUILTIN_CLAIMS); the
authored check or claims held but the change broke tests (pubprep, t6), or added none of the tests
the wording asks for (pubprep, h2, depose, which also broke tests); and four ran with no
independent check because the author's attempts were all refused (upgrade, f69ad0c58, the
claimcheck pick, and c4dc276c4's rerun, whose `auto` choice fell to resident-heavy:24b once the
pass's incompletes put gemma4:31b under the even prior). Turns were fewer than recorded on every task. Wall time was lower
on six and higher on four: ironroot (+140 s), t6 (+285 s), h2 (+905 s) and depose (+598 s), where
writing and validating the authored check took part of the time.

Evidence: `run-17/runs/<task>/rc19b` and `rc21` in the work root (run output, report, patch,
judgment, replay), and the sessions under `~/.swarm/sessions` they name.

