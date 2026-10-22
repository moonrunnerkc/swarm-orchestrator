# Every launch of the 2026-10-22 trial, in order

Each launch is entered before it starts with its order, task, arm and build; its duration, usage
and outcome are filled in after. The allowance is at most eight launches and 90 agent-minutes
([protocol.md](protocol.md)). The selection, validation, scorer validation, builds and freezing
used no model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| build | `06531fb5e` at `~/.cache/swarm-comparison/tools/swarm-06531fb5e`, `npm ci` and `npm run build` exit 0; `dist/cli.js` `sha256:35681373fdcf164487a22164e8c4f516400dfc1ab0bdb0c655280617d1b927f3`, 870 files |
| tasks | both VALID under the harness validator ([fresh-tasks/](fresh-tasks/)) |
| manifests | [control/manifest.json](control/manifest.json) `sha256:a6f4d7ce7ca2...`, [trace/manifest.json](trace/manifest.json) `sha256:f7c4cf926400...`; they differ in `pins.swarmFlags` and their launches only |
| scorer | [score-tests.mjs](score-tests.mjs) on both references: acorn 40 failures over the base's source (its runner counts each case under two parser modes), entities 4 added tests, all failing over the base's source ([tool-validation/](tool-validation/)) |
| endpoint | Ollama 0.32.14 serving `qwen3.6:35b-a3b`, nothing resident; OpenCode 1.14.48 |

## Launches

| # | task | arm | started (UTC) | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | mocha-bugfix-long-prefix-short-alias (repair boundary) | Swarm control | 08:12:00 | | | |
| 1 | mocha-bugfix-long-prefix-short-alias (repair boundary) | Swarm trace | 08:21:25 | | | |
| 2 | acorn-bugfix-member-target-pattern-errors | Swarm control | 08:29:18 | | | |
| 3 | acorn-bugfix-member-target-pattern-errors | Swarm trace | 08:39:24 | | | |
| 4 | acorn-bugfix-member-target-pattern-errors | OpenCode | 08:49:55 | | | |
| 5 | entities-bugfix-restore-get-code-point | OpenCode | 09:01:04 | | | |
| 6 | entities-bugfix-restore-get-code-point | Swarm trace | 09:02:08 | | | |
| 7 | entities-bugfix-restore-get-code-point | Swarm control | 09:02:26 | | | |
