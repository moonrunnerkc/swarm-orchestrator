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
