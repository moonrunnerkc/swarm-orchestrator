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
| 1 | Swarm, ordinary configuration, no workflow flag, handoff off; development launch 1 of at most 2 | `96b20a89c` (`~/.cache/swarm-comparison/tools/swarm-96b20a89c`, `dist/` tree `sha256:d2c614e8495e...`) | 2026-10-21 03:04:16 (runner), 03:04:20 (launch); arm spawned after preparation and the gate-plan preflight | 1 sequence of 2, 3.1 s, `ok`: chat, tool-call and tool-result all answered; 753 tokens, apart from the task's | **490.9 s (8.2 min)**; loop 1 stopped `max-steps` after 40 steps at 03:10:14, repair loop stopped `max-wall-time` after 14 steps at 03:12:13; cleanup 0.19 s, no deadline kill | **1,992,179 tokens** (1,970,267 input, 21,912 output), every call reporting usage | **Not delivered: the delivered tree is the base.** Exit 1, `not accepted`, no completion claim. The obstruction is gone: the file set minimatch's src/index.ts and `test/partial-globstar.js` was declared and accepted (record 166), and every `node -e` diagnostic ran (seven, exit 0; no shell denial; one `read` denied on `/src/index.ts`, an absolute path the model typed). First implementation (four edits to minimatch's src/index.ts, `development/first-implementation.patch` (packed), reconstructed from the recorded edits): the tests gate failed on 16 existing subtests (dot-file patterns such as `.x/**/*`), the visible check failed on its non-partial case (`minimatch("/b/c/d/a", "/**/a/b/c")` came back true), the frozen probe differs on two scored rows (both non-partial matches loosened), and the declared test file was never written. Repair attempt 1: the model wrote "The current changes are broken. Let me reset to base" and ran `git checkout HEAD -- src/index.ts` (record 351), then its wall ran out; the ratchet accepted that attempt (tests pass on the base, acceptance still failing), attempt 2 was withheld with 0 ms left. Repair **damaged** the candidate: a wrong implementation became no implementation. Hidden oracle: fail, "the final tree is the base". Records: the launch record in [packed-derived/records](packed-derived/records/), the trace, the first implementation and its probe reading under `development/` and the run's ledger and streams in [packed-derived/comparison-streams](packed-derived/comparison-streams/) (restore with `node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/permissions-repair/packed-derived/comparison-streams`); session `20261021T030431-6350fc`. |

## Comparative stage ([comparison/protocol.md](comparison/protocol.md))

Before the first launch, with no model: the three tasks validated under the policy with the
base's checks executed ([comparison/validation.json](comparison/validation.json)); the manifest
([comparison/manifest.json](comparison/manifest.json), `sha256:914841de5a97...`) freezes six
launches in the runner's counterbalanced order: `sinon-bugfix-mock-oncall-expectations` Swarm
then OpenCode, `dotenv-bugfix-fast-parser-line-ends` OpenCode then Swarm,
`sinon-bugfix-stub-accessor-calls` Swarm then OpenCode; Swarm's gate-plan preflight on each base
([comparison/preflight.json](comparison/preflight.json)); `opencode --version` 1.14.48. One
runner invocation for all six, entered here before it starts: launches 2 to 7 below.

| # | order | task | arm | started (UTC) | arm wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 0 | `sinon-bugfix-mock-oncall-expectations` | Swarm | 03:22:58 | 489.1 s (8.2 min); loop 1 `max-steps` 40 at 03:26:06, two repair attempts (lint fixed at attempt 1, the owed follow-up at attempt 2), attempt 3 withheld (0 ms left) | 1,773,288 (1,757,946 in, 15,342 out), 0 unknown; readiness 3.1 s, 753 tokens | **Correct tree, no test, exit 1.** Hidden oracle **pass**, visible check and `npm run test-node` pass, policy satisfied, 0 assertions added. The product reported `not accepted` over a tree every gate passed: its lint instrument closure read the whole source as the runner's configuration, the cycle never read green, and the run escalated at an "unknown" gate (commit `f6e13ca2f`, after the freeze). Four `claim` calls were refused on the model's own malformed record digest (no `sha256:` prefix). Not delivered under the rule (no regression test; exit 1) |
| 3 | 1 | `sinon-bugfix-mock-oncall-expectations` | OpenCode | 03:31:35 | 156.1 s (2.6 min) | 904,352 (896,096 in, 8,256 out), 0 unknown; readiness 0.9 s | **Correct tree, no test, claimed.** Hidden **pass**, visible pass, policy satisfied, 0 assertions added; exit 0 with a completion claim. Not delivered under the rule (no regression test) |
| 4 | 2 | `dotenv-bugfix-fast-parser-line-ends` | OpenCode | 03:34:26 | 540.5 s, **killed at the wall** (no exit code), cleanup confirmed | 2,086,224 (2,057,203 in, 29,021 out), 0 unknown; readiness 1.2 s | **Not delivered.** Hidden **fail** (two of the sealed file's cases fail: the quoted value before a Unicode separator, the unquoted value keeping it), visible check fails, project tests fail; no claim (killed). Policy satisfied after the fact, 0 assertions added |
| 5 | 3 | `dotenv-bugfix-fast-parser-line-ends` | Swarm | 03:43:42 | 488.2 s (8.1 min); loop 1 `max-steps` 40 at 03:47:16; one repair attempt, the second withheld | 1,713,835 (1,687,908 in, 25,927 out), 0 unknown; readiness 1.1 s | **Not delivered.** Hidden **fail** (the sealed file's colon-newline and Unicode cases), visible check passes, `npm test` fails (4 of 409 tap assertions in the project's own fast-parser tests); exit 1, `not accepted`. Five debug files were refused outside the workspace or outside the declared set and then declared and removed; policy satisfied after the fact, 0 assertions added |
| 6 | 4 | `sinon-bugfix-stub-accessor-calls` | Swarm | 03:52:18 | 352.6 s (5.9 min); loop 1 `max-steps` 40 at 03:54:28; one repair attempt, then `repair-unavailable` | 1,457,785 (1,450,338 in, 7,447 out), 0 unknown; readiness 1.1 s | **Correct source-and-test tree, exit 4.** The runner halted on the exit code ("the product could not run the task") and did not score the tree; scored after the fact with the runner's own verdicts ([comparison/scored](comparison/scored/), packed): hidden **pass**, visible check and `npm run test-node` pass, policy satisfied, **18 assertions added** in `test/src/stub-test.js` (displaced by the overlay at scoring; the delivered tree's own tests pass). The product's final verification read "unmeasured": its instrument closure treated the two source files as the test runner's configuration, and with them restored the new tests failed, so the pass was withheld and the run exited as unavailable (the same defect as launch 2; `f6e13ca2f`). Not delivered under the rule (exit 4, no claim) |
| 7 | 5 | `sinon-bugfix-stub-accessor-calls` | OpenCode | 04:02:39, after the recovery of [comparison/protocol.md](comparison/protocol.md) amendment 1 | 265.4 s (4.4 min) | 26,376 (25,961 in, 415 out), 0 unknown; readiness 0.9 s | **Nothing delivered, success claimed.** Two steps: a sub-agent exploration and two file reads, then the turn ended on a message; exit 0 with no change in the tree (0 bytes). Hidden fail ("the final tree is the base"), visible fail. A false completion claim under the oracle |

**Allowance, whole work:** 7 launches, 46.4 minutes of arm wall (2,782.8 s) of the 90 agent-minutes; readiness 11.4 s and 5,271 tokens apart; one halt and one recovery, no relaunch of any arm's attempt, no scripted correction, no server restart. Tokens: Swarm 6,937,087 over four launches, OpenCode 3,016,952 over three, every call reporting usage.

**Development allowance after launch 1:** 8.2 of the 90 agent-minutes used (8.2 min arm wall, 3.1 s readiness). No second development launch: the earliest actionable failure is the model's own implementation (it loosened non-partial matching inside its first 40 steps) and nothing in the harness or product caused it, so no correction is named and a second launch of the same configuration is not made ([protocol.md](protocol.md), "If it fails").
