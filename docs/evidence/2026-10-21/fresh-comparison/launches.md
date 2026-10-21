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
| 0 | mocha-bugfix-unparse-attached-values | swarm | 21:29:58 | 1 sequence, 5.4 s, ok; 753 tokens apart | **324.5 s**; loop 1 stopped `completed` after 14 steps; escalated after 0 of 3 repair attempts (repair classed unavailable) | **148,823** (146,572 in, 2,251 out), every call reporting | exit **4**, outcome `unverified`, no claim; the runner halted (`configuration`), recovered without relaunch ([protocol.md](protocol.md), amendment 1). Kept workspace scored: **correct** (hidden pass with the behaviour check, visible check and unit suite pass), **4 regression tests added, all 4 fail over the base's source**. Records: `mocha-bugfix-unparse-attached-values.swarm.halted-1.json`, session `20261021T213030-b3dabd` |
| 1 | mocha-bugfix-unparse-attached-values | opencode | 21:36:48 | 1 sequence, 0.8 s, ok; 753 tokens apart | **62.8 s** | **300,146** (296,783 in, 3,363 out), every step reporting | exit 0, completion claimed. **Correct** (hidden pass with the behaviour check, visible and unit suite pass), **2 regression tests added, both fail over the base's source** |
| 2 | mocha-bugfix-long-prefix-short-alias | opencode | 21:38:19 | 1 sequence, 0.9 s, ok; 753 tokens apart | **113.7 s** | **549,895** (544,715 in, 5,180 out), every step reporting | exit 0, completion claimed. **Correct** (hidden pass with the behaviour check, visible and unit suite pass), **8 regression tests added, 6 fail over the base's source** (the other 2 hold behaviour the base already had) |
| 3 | mocha-bugfix-long-prefix-short-alias | swarm | 21:40:41 | 1 sequence, 0.9 s, ok; 753 tokens apart | **468.5 s**; loop 1 stopped `max-steps` after 40 steps; repair attempt 1 stopped `max-wall-time` after 24 steps and was rejected by the ratchet (lint regressed) and rolled back; attempt 2 withheld (no wall left) | **1,416,957** (1,405,515 in, 11,442 out), **a lower bound: 2 calls reported no usage** | exit 1, outcome `not accepted`, no claim. **Not correct**: the one-dash forms the task said must not change now throw (`-t 10`, `-j 4`), 3 unit tests fail, hidden fails; **no test added**. The delivered tree is the first candidate. Session `20261021T214114-aa33a0` |

**Allowance used:** 4 of 4 launches; 969.5 s (16.2 min) of arm wall of the 60 agent-minutes;
readiness 8.1 s and 3,012 tokens apart. No launch was repeated. Preparation (clone and install,
outside the arms): 32.0 s, 1.6 s, 1.7 s and 32.5 s, the Swarm launches' including the product's
gate-plan preflight.

**Reading the rendered [results.md](results.md):** it counts launch 0 as an infrastructure
attempt, which is the runner's class for the halt; under amendment 1 it is Swarm's result, and its
kept workspace is scored in [README.md](README.md). Its "(0 unknown)" counts invocations with no
total; Swarm's launch 3 had 2 calls with unknown usage inside its total, which is a lower bound.
