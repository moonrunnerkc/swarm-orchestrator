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
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off; development launch 1 of at most 2 | `d2437c430` (`~/.cache/swarm-comparison/tools/swarm-d2437c430`, `dist/cli.js` `sha256:2bb07c9a9bf4...`) | 2026-10-21 14:33:31 (runner), 14:33:37 (launch record); arm spawned after preparation and the gate-plan preflight | 1 sequence of 2, 5.4 s, `ok`: chat, tool-call and tool-result all answered; 753 tokens, apart from the task's | **455.9 s (7.6 min)**; loop 1 stopped `max-steps` after 40 steps at 14:35:57; repair attempt 1 (20 steps) completed at 14:38:02, attempt 2 (33 steps) at 14:40:23, attempt 3 withheld with 4.2 s left; cleanup, no deadline kill | **2,197,049 tokens** (2,179,213 input, 17,836 output), **one call reported no usage**, so the total is a lower bound | **Not delivered: exit 1, `not accepted`, no claim** (`completion.claim: none`, the product's own verdict). **The source is correct**: hidden oracle **pass** (the sealed `test/src/stub-test.js`, the hidden API check `acceptance/hidden/api-check.mjs` and `npm run test-node` on the overlaid tree; policy satisfied, **17 assertions added**, the delivered `test/src/stub-test.js` displaced by the overlay). **The delivered tree's own tests fail**: the visible check passes, `npm run test-node` exits 7 on the run's own nine new cases (`assert.isNotUndefined` is not a referee method; `obj` for `myObj`; `stub` unassigned; a bare `myObj.prop;` the lint rejects: lint 4 errors, tests 7 failures at the first gate cycle, records 276 and 278). **Repair fixed the tests and was refused by a wrong measure**: attempts 1 and 2 each turned lint and tests green with the independent verification reading `regression pass` (records 430 to 443, 649 to 662), replacing the two `assert.isNotUndefined` calls with referee's `refute.isUndefined` and the bare expression with an assertion; the ratchet rejected both as "assertions in the touched test files fell from 558 to 557" (records 445, 664), because `src/gates/measures.ts` counted `assert`, `expect` and `should` and not `refute`. The rejected attempts were reverted and the first tree was delivered (final verification record 684: lint and tests fail as at the first cycle). Earliest actionable failure: the product's assertion measure, fixed in `643b9ef4c` (amendment 1). Model-side: nine test cases with four lint errors and three runtime errors in the first loop. Six `claim` calls refused on a malformed record digest (no `sha256:` prefix), as in launch 6 of the stage before. Records: [records/sinon-bugfix-stub-accessor-calls-v2.swarm.json](records/sinon-bugfix-stub-accessor-calls-v2.swarm.json), [results.md](results.md); session `20261021T143352-d0c908`; the patch `sha256:7609a024e18d...` |

**Allowance after launch 1:** 7.6 of the 60 agent-minutes, 1 of at most 6 launches and 1 of at most 2 development launches used; readiness 5.4 s and 753 tokens apart.

## Launch 2, after amendment 1 ([protocol.md](protocol.md))

Before it, with no model: the correction `643b9ef4c` committed with its regression test; the
build at that commit (`~/.cache/swarm-comparison/tools/swarm-643b9ef4c`, `npm ci` and `npm run
build`); its `dist/cli.js` is byte-identical to launch 1's (`sha256:2bb07c9a9bf4...`, the entry
file loads the modules that changed), so the whole `dist/` tree is recorded as well: 862 files,
`sha256:4d3e26218b3e...` against launch 1's `sha256:b2cbe045f8b4...`, `dist/gates/measures.js`
`69b5339dce67...` against `9df58a78f60d...`; manifest [manifest-2.json](manifest-2.json)
`sha256:d7ed23ed74f6...`, one launch, order 1, the same task, model, endpoint, budgets and
harness digest as launch 1; gate-plan preflight on the base ok ([preflight-2.json](preflight-2.json));
Ollama serving, nothing resident, nothing else heavy running.

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | Swarm, the same ordinary configuration; development launch 2 of at most 2, after the named correction of amendment 1 | `643b9ef4c` (`dist/` tree `sha256:4d3e26218b3e...`) | entered before the start; filled in after | | | | |
