# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests
and usage apart from the task's. The allowance for the whole of this work is two development
launches and six comparison launches, at most 90 agent-minutes of inference and failed starts in
all ([protocol.md](protocol.md)). Validation, feasibility, probe and preflight runs used no
model and are not launches.

## Before the first launch, with no model

| check | result |
| --- | --- |
| task validation under the corrected policy ([validation.json](validation.json)) | valid: the base's hidden argv executed and exits 1, the visible check fails; the reference passes both, satisfies the policy (14 assertions added, 7 removed, `test/partial.ts` added) |
| reference feasibility ([reference-feasibility.json](reference-feasibility.json)) | base `npm test` exit 0; source-only reference exit 1 (coverage, lines 955 to 957); complete reference exit 0; the overlay makes the source-only reference pass (hidden exit 0, `npm test` exit 0) |
| manifest ([manifest.json](manifest.json)) | `sha256:186041e5bbaa...`, one launch: `0 minimatch-bugfix-partial-globstar swarm` |
| Swarm gate-plan preflight on the base ([preflight.json](preflight.json)) | see the table below |
| endpoint before launch | Ollama 0.32.14 serving, nothing resident before the launch |

## Launches

| # | arm | build | started (UTC) | readiness | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off; development launch 1 of at most 2 | `96b20a89c` (`~/.cache/swarm-comparison/tools/swarm-96b20a89c`, `dist/` tree `sha256:d2c614e8495e...`) | 2026-10-21 03:04:16 (runner), 03:04:20 (launch); arm spawned after preparation and the gate-plan preflight | 1 sequence of 2, 3.1 s, `ok`: chat, tool-call and tool-result all answered; 753 tokens, apart from the task's | **490.9 s (8.2 min)**; loop 1 stopped `max-steps` after 40 steps at 03:10:14, repair loop stopped `max-wall-time` after 14 steps at 03:12:13; cleanup 0.19 s, no deadline kill | **1,992,179 tokens** (1,970,267 input, 21,912 output), every call reporting usage | **Not delivered: the delivered tree is the base.** Exit 1, `not accepted`, no completion claim. The obstruction is gone: the file set `src/index.ts` and `test/partial-globstar.js` was declared and accepted (record 166), and every `node -e` diagnostic ran (seven, exit 0; no shell denial; one `read` denied on `/src/index.ts`, an absolute path the model typed). First implementation (four edits to `src/index.ts`, [development/first-implementation.patch](development/first-implementation.patch), reconstructed from the recorded edits): the tests gate failed on 16 existing subtests (dot-file patterns such as `.x/**/*`), the visible check failed on its non-partial case (`minimatch("/b/c/d/a", "/**/a/b/c")` came back true), the frozen probe differs on two scored rows (both non-partial matches loosened), and the declared test file was never written. Repair attempt 1: the model wrote "The current changes are broken. Let me reset to base" and ran `git checkout HEAD -- src/index.ts` (record 351), then its wall ran out; the ratchet accepted that attempt (tests pass on the base, acceptance still failing), attempt 2 was withheld with 0 ms left. Repair **damaged** the candidate: a wrong implementation became no implementation. Hidden oracle: fail, "the final tree is the base". Records: [records/minimatch-bugfix-partial-globstar.swarm.json](records/minimatch-bugfix-partial-globstar.swarm.json), [development/launch-1-trace.txt](development/launch-1-trace.txt), session `20261021T030431-6350fc`. |

**Development allowance after launch 1:** 8.2 of the 90 agent-minutes used (8.2 min arm wall, 3.1 s readiness). No second development launch: the earliest actionable failure is the model's own implementation (it loosened non-partial matching inside its first 40 steps) and nothing in the harness or product caused it, so no correction is named and a second launch of the same configuration is not made ([protocol.md](protocol.md), "If it fails").
