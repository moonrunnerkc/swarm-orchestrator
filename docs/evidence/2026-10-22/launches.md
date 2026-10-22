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
| 0 | mocha-bugfix-long-prefix-short-alias (repair boundary) | Swarm control | 08:12:05 | **511.3 s** | 837,049 (829,284 in, 7,765 out), **a lower bound: 1 call reported no usage**; model 108.1 s | exit 1, `not-accepted`, no claim. Scripted first loop wrote the retained candidate; repair attempt 1 ran 32 steps live, edited both files, was cut at the model-work cutoff and rolled back by the ratchet (lint and format regressed); the delivered tree is the retained candidate. Two `run_check` calls (8.8 s each, acceptance-only). Session `20261022T081213-bbf324` |
| 1 | mocha-bugfix-long-prefix-short-alias (repair boundary) | Swarm trace | 08:21:30 | **415.6 s** | 491,992 (every call reporting); model 69.0 s | exit 1, `not-accepted`, no claim. The trace notice was given to attempt 1 (`passingAtBase: tests`); no `compare_base` call; attempt 1 completed in 21 steps, edited both files and was rolled back (lint and format regressed); attempt 2 withheld (no model-work wall left); the delivered tree is the retained candidate. Session `20261022T082133-6e195b` |
| 2 | acorn-bugfix-member-target-pattern-errors | Swarm control | 08:29:25 | **462.9 s** | 1,086,391 (every call reporting); model 198.2 s | exit 1, no claim. First model call at 74.4 s (install and base preflight); loop 1 stopped `max-steps` after 40 steps with **no edit**; no repair or continuation could run (no wall left after the gate cycle and its 88 s verification). Delivered: nothing changed |
| 3 | acorn-bugfix-member-target-pattern-errors | Swarm trace | 08:39:26 | **497.8 s** | 997,395 (every call reporting); model 242.1 s | exit 1, no claim. First model call at 93.7 s; loop 1 `max-steps` after 40 steps with **no edit**; no repair ran, so the trace was never given. Delivered: nothing changed |
| 4 | acorn-bugfix-member-target-pattern-errors | OpenCode | 08:50:01 | **540.5 s**, killed at the deadline | 4,740,151 (every step reporting); 98 tool calls | killed, no claim. Delivered a 5.8 KB unfinished change (debugging `console.error` calls in the parser): hidden fail, visible fail, 18 of 31 behaviour cases fail including valid destructuring the base parses |
| 5 | entities-bugfix-restore-get-code-point | OpenCode | 09:01:10 | **42.6 s** | 263,116 (every step reporting) | exit 0, claimed. **Correct and complete**: hidden pass, visible and project tests pass, all 22 behaviour cases, 6 meaningful added tests. Introduces lint errors the base does not have |
| 6 | entities-bugfix-restore-get-code-point | Swarm trace | 09:02:08 | 0 s | 0 | **halted before dispatch** by the runner's gate-plan preflight (configuration: a string comparison read the product's structured form of `npm run test:vi` as another gate); no inference; counts against the eight; not relaunched ([protocol.md](protocol.md), amendment 1) |
| 7 | entities-bugfix-restore-get-code-point | Swarm control | 09:04:38 | **191.8 s** | 815,416 (every call reporting); model 92.6 s | exit 0, accepted, claimed. **Correct and complete**: hidden pass, visible and project tests pass, all 22 behaviour cases, 6 meaningful added tests; project lint clean. First candidate (22 steps) already correct and complete but failing lint; repair attempt 1 fixed lint and was accepted. Run under the amended control manifest. Session `20261022T090449-8bd2bb` |

**Allowance used:** 8 of 8 launches (7 dispatched, 1 halted before dispatch); 2,661.6 s (44.4 min) of
arm wall of the 90 agent-minutes; no launch was repeated.
