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
