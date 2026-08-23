# Release-completion run report, 2026-08-23

One session, run start to finish on `v13-main` without pausing for approval. Every decision
point took the stated default; the decision and its reasoning are recorded in the decisions
section. Steps that could not run live are recorded as NOT-RUN or NOT-DONE with the exact
reason and the exact command, never synthesized.

This run continues from `../2026-08-18/run-report.md`, which is left in place as the record
of what was true then.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 (npm notices 12.0.2 is available; not taken mid-release) |
| Branch | `v13-main` at a5ce696b |
| Working tree | clean apart from untracked `RELEASE-COMPLETION-PROMPT.md` (the work list itself, not committed) |
| Baseline `npm run gates` | exit 0, 88 files, 1082 tests passed |
| Baseline `npm run fuzz:build` | exit 0, 8 harnesses, 84 seeds |
| `node scripts/check-invariant-drift.mjs` | exit 0, 12 invariants identical across CLAUDE.md and AGENTS.md |
| Container runtime | none: `docker`, `podman`, `nerdctl`, `lima`, `limactl`, `colima`, `orbctl` all absent; no container app in /Applications. Homebrew is present at /opt/homebrew/bin/brew |
| `gh` | 2.92.0, authenticated as `moonrunnerkc` (keyring), scopes `gist`, `read:org`, `repo`, `workflow` |
| `npm whoami` | not logged in (`ENEEDAUTH`) |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in repo-root `.env` (names only; no value read or echoed) |
| Ollama, port 11434 | not running at preflight; started with `ollama serve`, then responds with 30 models |
| rapid-mlx, port 8000 | responds; serves `qwen3-coder:30b-a3b` |
| `$TERM` | `xterm-256color` (`COLORTERM=truecolor`) |
| `NO_COLOR` | unset |

Consequences carried into the rest of the run: the clean-container verification in phase 4
has no runtime at preflight and phase 4 begins by trying to install one. Everything needing a
local model can run; the frontier keys authenticate but were unfunded at the 08-18 run and are
re-checked in phase 6 rather than assumed.

The baseline is 88 files and 1082 tests, up from the 84 and 1021 the 08-18 run closed at. The
difference is the five commits that landed after it.

## Per-item status log

Appended as the run proceeds.

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
