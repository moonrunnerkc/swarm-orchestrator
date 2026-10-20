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
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off | `8ce795eb8` (`~/.cache/swarm-comparison/tools/swarm-8ce795eb8`, `dist/` tree `sha256:138b638e0300...`) | 2026-10-20 23:37:52 (readiness), 23:37:58 (launch); arm spawned after 11.9 s of preparation | 1 sequence of 2, 5.9 s, `ok`: chat 5.2 s (the server loading the model inside it), tool-call 0.5 s, tool-result 0.3 s, all answered; 753 tokens, apart from the task's | **469.1 s (7.8 min)**; the product reports 7m 48s, 80 steps, loop stopped `max-steps`; cleanup 0.17 s, no deadline kill | **2,513,621 tokens** (2,492,257 input, 21,364 output), a lower bound: 1 of its calls reported no usage | **Not delivered.** Exit 1, `not accepted`, no completion claim. Hidden oracle **fail**: `npm test` exits 1 on tap's 100% coverage rule (every one of 6,235 assertions passed, the upstream `test/partial.ts` included; branches 99.77%, lines 978 and 1001 uncovered). Visible: the check passes, the project tests fail, so unresolved. Frozen probe: all 19 scored rows match the reference. Two repair attempts: the first accepted by the ratchet with tests and `task-acceptance` still failing, the second withheld (8.5 s of budget left, 23.4 s needed). Final verification of the exact tree: regression fail (tests). Phases: seal and preflight 10.9 s; worker loop and repairs 443.4 s (model 357.5 s, tools 40.2 s); final gates, acceptance and verification 14.2 s. Records: [records/minimatch-bugfix-partial-globstar.swarm.json](records/minimatch-bugfix-partial-globstar.swarm.json), [records/swarm-final.patch](records/swarm-final.patch), [records/swarm-reading.json](records/swarm-reading.json), [probe/swarm.json](probe/swarm.json). |
| 2 | OpenCode 1.14.48 | n/a (configured by the runner) | 2026-10-20 23:46:15; arm spawned after 2.2 s of preparation | 1 sequence of 2, 0.9 s, `ok`: chat 0.3 s (the model resident), tool-call 0.3 s, tool-result 0.3 s, all answered; 753 tokens | **204.9 s (3.4 min)**; cleanup 0.11 s, no deadline kill | **1,149,636 tokens** (1,140,722 input, 8,914 output), every call reporting usage | **Not delivered; a false completion claim.** Exit 0, success claimed ("All tests pass", after its own run showed "minor uncovered lines due to my new partial paths"). Hidden oracle **fail**: `npm test` exits 1 on the coverage rule (6,235 of 6,235 assertions passed; statements 99.49%, branches 99.77%, lines 980 to 991 and 1017 to 1018 uncovered). Visible: the check passes, the project tests fail, so unresolved. Frozen probe: all 19 scored rows match the reference. Records: [records/minimatch-bugfix-partial-globstar.opencode.json](records/minimatch-bugfix-partial-globstar.opencode.json), [records/opencode-final.patch](records/opencode-final.patch), [probe/opencode.json](probe/opencode.json). |

**Allowance used:** 2 of 2 launches, in the registered order, one runner invocation (23:37:51 to 23:49:57 UTC); 674.0 s (11.2 min) of arm wall of the 20 minutes; 2 of 4 readiness sequences, 6.8 s and 1,506 tokens in all; no correction, no replacement, no retry, no halt, no server restart. Both arms' output streams, the verdict details and Swarm's two session chains (the gate-plan preflight `20261020T233802-834768` and the run `20261020T233810-339b33`, ledger and payloads) are packed losslessly in [packed-derived/comparison-streams](packed-derived/comparison-streams/) (`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-20/ordinary-comparison/packed-derived/comparison-streams`).

Command, from the repository root, once for both launches in the registered order:
`node scripts/comparison/run.mjs --manifest docs/evidence/2026-10-20/ordinary-comparison/manifest.json`.
