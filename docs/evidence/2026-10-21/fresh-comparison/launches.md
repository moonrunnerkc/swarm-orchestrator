# Every launch of the fresh comparison, in order

Each launch is entered before it starts with its order, task, arm and build; its duration, usage
and outcome are filled in after. Readiness sequences are the runner's own, recorded apart from
the task's usage. The allowance for this stage is at most four task launches and 60 agent-minutes
of inference and failed starts ([protocol.md](protocol.md)). The selection, validation,
sensitivity reads, scorer validation, builds, gates and preflight used no model and are not
launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| tasks | `mocha-bugfix-long-prefix-short-alias` and `mocha-bugfix-unparse-attached-values`, registered in `736251101`; harness validation VALID for both with the hidden behaviour checks ([validation-with-behaviour-checks.json](validation-with-behaviour-checks.json)) |
| gates on `736251101` | `npm run gates` exit 0: 476 test files passed, 5 skipped; 4,705 tests passed, 29 skipped; lint 29 warnings, no error; 6.2 MB headroom; all 15 cited bundles verify. `npm run build`, `npm run check:packaged`, `npm run fuzz:build` exit 0 |
| Swarm build | `736251101`, `~/.cache/swarm-comparison/tools/swarm-736251101`, `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:3503870a31f1...`, `dist/agent-run.js` `sha256:0d88056407d2...`, `dist/evidence/run-assessment.js` `sha256:a81ceb3e740c...`, 864 files, sorted per-file list digest `8bd7f7ae36d0...` |
| manifest | [manifest.json](manifest.json), `sha256:36d8d71b8418...` on disk at freeze; harness digest `sha256:65f35d13747f...`; order: unparse Swarm (0), unparse OpenCode (1), alias OpenCode (2), alias Swarm (3) |
| preflight | [preflight.json](preflight.json): Swarm's gate plan reads `npm run test-node:unit` and passes on both bases; OpenCode 1.14.48 |
| endpoint | Ollama 0.32.14 serving, nothing resident before the first launch, nothing else heavy running |

## Launches

| # | task | arm | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | mocha-bugfix-unparse-attached-values | swarm | | | | | |
| 1 | mocha-bugfix-unparse-attached-values | opencode | | | | | |
| 2 | mocha-bugfix-long-prefix-short-alias | opencode | | | | | |
| 3 | mocha-bugfix-long-prefix-short-alias | swarm | | | | | |
