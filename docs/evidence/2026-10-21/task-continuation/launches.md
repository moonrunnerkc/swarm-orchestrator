# Every model-powered launch of this follow-up, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests
and usage apart from the task's. The allowance for the whole stage is at most six live launches
and 60 agent-minutes of inference and failed starts, at most two of them development launches
([protocol.md](protocol.md)). The reconstruction, the real-tree checks, the controller replay,
the regression tests, the build and the preflight used no model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| the task | `sinon-bugfix-stub-accessor-calls-v2`, unchanged since `d2437c430`; validation and the API check's sensitivity as recorded for the first trial |
| Swarm build | commit `87b6f294e`, `~/.cache/swarm-comparison/tools/swarm-87b6f294e`, `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:3503870a31f1...` (the entry file, unchanged by the fix), `dist/agent-run.js` `sha256:61fc2fa65cb3...`, 864 files under `dist/`, the tree's digest `af7342fd918e...` |
| endpoint before launch | Ollama serving `qwen3.6:35b-a3b` (version in the launch row), nothing resident before the launch, nothing else heavy running |

## Launches

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off; development launch 1 of at most 2 | `87b6f294e` (`~/.cache/swarm-comparison/tools/swarm-87b6f294e`, `dist/cli.js` `sha256:3503870a31f1...`); manifest [manifest.json](manifest.json), protocol committed as `290c38fbd` before the launch; Ollama 0.32.14 serving `qwen3.6:35b-a3b`, nothing resident | 2026-10-21 16:38:52 (runner), 16:38:58 (launch record) | 1 sequence of 2, 5.4 s, `ok`; 753 tokens, apart from the task's | **282.5 s (4.7 min)**; loop 1 stopped `max-steps` after 40 steps; repair attempt 1 (1 step, no tool call) and attempt 2 (1 step, no tool call) each stopped `completed` with the tree unchanged and lint still failing, both accepted by the ratchet (nothing moved); attempt 3 (14 steps) fixed lint and completed; the continuation was **withheld: no attempt was left under the cap of 3**; no deadline kill | **1,011,623 tokens** (1,004,282 input, 7,341 output), every call reporting usage | **Not delivered: exit 0, verdict acceptable, lifecycle `max-steps`, `completion.claim: none`** (the harness read the product's own lifecycle). **The source is correct**: hidden oracle **pass** (the sealed `test/src/stub-test.js` including the `resetBehavior` case, the hidden API check and `npm run test-node` on the overlaid tree; policy satisfied). **No test was written**: 0 assertions added, no test file touched; the product's report said so ("regression tests: no test file differs from the base, so none was added"; "the task's own loop stopped at its step limit before it reported the task done; its continuation was withheld (no attempt was left under the cap of 3), so the task may be unfinished"). Visible check and `npm run test-node` pass on the delivered tree. Earliest actionable failure: two repair attempts that called no tool were each counted as a finished attempt and measured over an unchanged tree, consuming the cap the continuation needed (records 289, 311: one step, `completed`, no edit; lint failed identically at cycles 0, 1 and 2). Records: [records/sinon-bugfix-stub-accessor-calls-v2.swarm.json](records/sinon-bugfix-stub-accessor-calls-v2.swarm.json), [results.md](results.md); session `20261021T163913-c4c5b7`; the patch `sha256:4e17bc094eea...` |

**Allowance after launch 1:** 4.7 of the 60 agent-minutes, 1 of at most 6 launches and 1 of at most 2 development launches used; readiness 5.4 s and 753 tokens apart.

## Launch 2, after amendment 1 ([protocol.md](protocol.md))

Before it, with no model: the correction `cbf9544b4` committed with its regression test (failing on
`87b6f294e`: [regressions-on-87b6f294e/](regressions-on-87b6f294e/)); the build at that commit
(`~/.cache/swarm-comparison/tools/swarm-cbf9544b4`, `npm ci` and `npm run build`); its `dist/cli.js`
is byte-identical to launch 1's (`sha256:3503870a31f1...`, the entry file loads the modules that
changed), so the changed module and the whole tree are recorded: `dist/agent-run.js`
`sha256:88e17c3f835e...` against launch 1's `61fc2fa65cb3...`, 864 files, the tree's digest
`451b6fbc0860...` against `af7342fd918e...`; manifest [manifest-2.json](manifest-2.json), one
launch, order 1, the same task, model, endpoint, budgets and harness digest as launch 1; gate-plan
preflight on the base ok ([preflight-2.json](preflight-2.json)); Ollama 0.32.14 serving, nothing
resident, nothing else heavy running.

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | Swarm, the same ordinary configuration; development launch 2 of at most 2, after the named correction of amendment 1 | `cbf9544b4` (`dist/agent-run.js` `sha256:88e17c3f835e...`) | entered before the launch command was started | | | | |
