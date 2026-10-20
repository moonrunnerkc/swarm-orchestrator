# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests
and usage apart from the task's. The allowance is exactly two launches of at most 10 minutes
(9 minutes and half a second of arm wall, the kill confirmed inside 59.5 s), at most two readiness
sequences of at most 90 seconds and three requests each per launch, and 20 minutes of task wall in
all, with no replacement ([protocol.md](protocol.md)). The validation, probe and preflight runs
used no model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| task validation ([validation.json](validation.json)) | valid: base fails the hidden oracle and the visible check, reference passes both and the project's tests |
| evaluation probe at reference and base ([probe/run-reference.txt](probe/run-reference.txt)) | six requested rows differ, four negative and nine preserved rows agree, two observed rows recorded |
| runner dry run of [manifest.json](manifest.json) (`sha256:45bd0be08b4c...`) | `0 minimatch-bugfix-partial-globstar swarm`, `1 minimatch-bugfix-partial-globstar opencode`; no halt, no lock, 2 remaining |
| Swarm gate-plan preflight on the base, called directly ([preflight.json](preflight.json)) | ok: `npm test` is the effective blocking tests gate and passes on the base; the override read back by the pinned build's parser |
| OpenCode | `opencode --version` answers 1.14.48, the pinned version |
| endpoint before launch | Ollama 0.32.14 serving, no model resident (`/api/ps` empty); nothing else running on the box |

## Launches

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off | `8ce795eb8` (`~/.cache/swarm-comparison/tools/swarm-8ce795eb8`, `dist/` tree `sha256:138b638e0300...`) | (entered before launch; filled after) | | | | |
| 2 | OpenCode 1.14.48 | n/a (configured by the runner) | (entered before launch; filled after) | | | | |

Command, from the repository root, once for both launches in the registered order:
`node scripts/comparison/run.mjs --manifest docs/evidence/2026-10-20/ordinary-comparison/manifest.json`.
