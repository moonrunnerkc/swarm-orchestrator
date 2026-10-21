# Every model-powered launch of this follow-up, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests
and usage apart from the task's. The allowance for the whole follow-up is at most six live
launches and 60 agent-minutes of inference and failed starts, at most two of them development
launches ([protocol.md](protocol.md)). Validation, the API check's sensitivity, the build and the
preflight used no model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| task validation ([validation.json](validation.json)) | valid: the base's hidden argv executed and exits 3, the visible check fails on the base; the reference passes the hidden argv, the hidden API check and the project's tests, satisfies the policy (11 assertions added, 0 removed, `test/src/stub-test.js` touched); lint passes with the visible check in the tree |
| the hidden API check's sensitivity ([../accessor-audit/api-check-validation.json](../accessor-audit/api-check-validation.json)) | fails on the base, fails on the published accessor patch of launch 6 (`withArgs` absent), passes on the upstream reference: 43 spy methods present |
| manifest ([manifest.json](manifest.json)) | `sha256:ddcd8ae7c428...`, one launch: `0 sinon-bugfix-stub-accessor-calls-v2 swarm`; harness `sha256:220f8c064609...` |
| Swarm build | commit `d2437c430`, `~/.cache/swarm-comparison/tools/swarm-d2437c430`, `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:2bb07c9a9bf4...` |
| Swarm gate-plan preflight on the base ([preflight.json](preflight.json)) | ok: the product runs `npm run test-node` as its blocking tests gate and it passes on the base |
| endpoint before launch | Ollama serving `qwen3.6:35b-a3b`, nothing resident before the launch, nothing else heavy running |

## Launches

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off; development launch 1 of at most 2 | `d2437c430` (`~/.cache/swarm-comparison/tools/swarm-d2437c430`, `dist/cli.js` `sha256:2bb07c9a9bf4...`) | entered before the start; filled in after | | | | |
