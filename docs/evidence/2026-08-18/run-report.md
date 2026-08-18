# Production-readiness run report, 2026-08-18

One session, run start to finish on `v13-main` without pausing for approval. Every decision
point took the stated default; the decision and its reasoning are recorded below. Steps that
could not run live are recorded as NOT-RUN with the exact reason, never synthesized.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 |
| Branch | `v13-main` at 4e37753c |
| Working tree | clean apart from untracked `docs/state-report-2026-08-17.md` |
| Baseline `npm run gates` | exit 0, 81 files, 984 tests passed |
| Container runtime | none: no `docker`, no `podman`, no Docker.app, no colima or lima |
| `gh` | 2.92.0, authenticated as `moonrunnerkc`, scopes `gist`, `read:org`, `repo`, `workflow` |
| `npm whoami` | not logged in (`ENEEDAUTH`) |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in repo-root `.env` (names only; no value read or echoed) |
| Ollama, port 11434 | responds; 11 models present |
| rapid-mlx, port 8000 | responds; serves `qwen3-coder:30b-a3b` |

Consequences carried into the rest of the run: the clean-container verification in section 3
has no runtime to run in and is recorded NOT-RUN there. Everything needing a frontier or a
local model can run.

## Per-item status log

Appended as the run proceeds.

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
| 1.1 Merge crossfire-h3 | done, no merge needed | `git branch --contains crossfire-h3` already lists `v13-main`: crossfire-h3 is at 1303aa2c and v13-main is one commit ahead of it. Nothing was stranded. Gates exit 0 and the floor-4 cases in `src/evidence/scrub.test.ts` run on trunk. |
| 1.2 pass5 dangling pointer | done, restored | found in history at cdbe9651 on `redteam/loop/lap-1-attack`; restored byte-exact. Correction record appended at `redteam/loop/state/corrections.jsonl`. |
| 1.3 Lap-accounting addendum | done | `redteam/loop/state/lap-accounting.jsonl`, 10 records, new file so no JSONL was rewritten. |
| 1.4 Housekeeping | done | `redteam/leep/` removed (empty and untracked); fixture README in `state-dryrun/` and `state-wake/`; `schema-v1` recorded below as a known dangling tag. |

## Decisions

**1.1 crossfire-h3 needed no merge.** The branch is an ancestor of `v13-main`, so a merge
would have been a no-op commit. Recorded rather than manufactured.

**1.2 pass5 restored byte-exact, not repaired.** The suite fails 20 of 51 against current
source. Every failure class checked runs the same way: the tree got stricter than the probe
asserted. `parseTestOutcomes` is not merely guarded, it is gone from `src/gates/parsers.ts`;
the coverage arm refuses an invocation it cannot vouch for rather than correcting it; pass 4
closed the wrapper-array scrub the probe asserts is open. Editing a probe to green it would
forge the record the file is kept as, so nothing was edited and the status is written down
instead. Ten of the twenty failures are classified in the correction record; the other ten
were not individually re-derived and the record says so.

**1.4 `schema-v1` left in place.** The tag points at 79c9c856, which no branch contains, so
it is dangling. Tag deletion is not this run's call, so it is recorded here and left alone.
