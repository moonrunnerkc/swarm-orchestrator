# Real-task pilot, 2026-10-14: does the tool work usefully on small real tasks?

> **Corrected on 2026-10-15.** This report is kept as published. The gate's first item below
> ("no unresolved setup or scoring problem") does not hold: three of the four Swarm launches ran
> a product gate the task did not name, and two of them shared an environment one of them had
> changed. The corrected derivation, when each fact was observable and recognized, the amended
> upgrade oracle and the repairs made afterwards are in
> [correction-2026-10-15.md](correction-2026-10-15.md); the corrected tables are
> [results-corrected.md](results-corrected.md). The decision below stands, with that setup
> validity failure added. The development checks of the repairs are reported under
> [development/](development/README.md).

## Decision: DO NOT PROCEED to a larger study

Stage A ran all eight launches it froze and failed one item of the frozen gate: Swarm correctly
delivered two of the four tasks (the refactor and the feature), not the three including the bug
fix that the gate requires. Stage B was not run, as the protocol says. Functionality was
demonstrated: on three of four tasks Swarm's final patch passed the sealed oracle, two of them as
clean deliveries in about two and three minutes, and it made no false completion claim. Added
value against OpenCode on this configuration is a one-sided descriptive signal (two deliveries
against one, 43 against 73 end-to-end minutes, 1.1 million against 31.4 million tokens), from
four tasks, and is inconclusive as evidence of superiority. The thresholds were a spending gate,
not a benchmark; the gate was not met, so no larger study is recommended from this pilot.

The frozen protocol is [protocol.md](protocol.md); the per-launch tables and the gate, item by
item, are [results.md](results.md), rendered by `scripts/pilot/analyze.mjs` from the records
under [stage-a/](stage-a/).

## Paired outcomes (stage A, four unique tasks, one launch per arm)

| task | arm | correct patch | delivered | corrections | agent time | tokens | what happened |
| --- | --- | --- | --- | --- | --- | --- | --- |
| chai-upgrade-c8-v12 | swarm | yes | no | 0 | 18.0 min | 308,045 | patch right in 8 model calls; its blocking `tests` gate ran chai's `npm test`, whose browser suite needs Playwright browsers absent from Swarm's scratch HOME; the automatic repair installed them, the wall ran out, exit 1 (cancelled, not acceptable) |
| chai-upgrade-c8-v12 | opencode | yes | yes | 0 | 11.9 min | 781,692 | exit 0, final text claims completion, oracle agrees |
| lru-cache-refactor-autopurge-noop-timer | opencode | no | no | 0 | 20.0 min | 12,212,725 | 348 turns, 344 of them the same grep on one path, no edit; killed at the wall |
| lru-cache-refactor-autopurge-noop-timer | swarm | yes | yes | 0 | 3.1 min | 74,707 | 12 steps, acceptable verdict, exit 0, oracle agrees |
| chai-feature-deep-contain-oneof | swarm | yes | yes | 0 | 2.1 min | 51,954 | 9 steps, acceptable verdict, exit 0, oracle agrees; its `tests` gate passed with the browsers the earlier launch had installed |
| chai-feature-deep-contain-oneof | opencode | no | no | 0 | 20.0 min | 10,841,542 | 306 turns of the same grep, no edit; killed at the wall |
| csstree-bugfix-raw-value-whitespace | opencode | no | no | 0 | 20.0 min | 7,558,424 | 206 turns of grep, no edit; killed at the wall |
| csstree-bugfix-raw-value-whitespace | swarm | no | no | 2 | 19.4 min | 695,120 | read and searched without editing; the stall detector ended loop 1 after 32 steps, the repair loop hit the 600,000-token cap, two scripted corrections had 5 and 1 minutes left and their gates were refused for lack of time; exit 1 |

"Delivered" is the frozen definition: a correct patch, visible checks resolved, exit 0 within
budget, a completion claim, and for Swarm its own acceptable verdict with evidence present and
no oracle exposure. A correct patch that is not a delivery is listed as such with its reason.

| measure | swarm | opencode |
| --- | --- | --- |
| correct patches / launches | 3 / 4 | 1 / 4 |
| correctly delivered / launches | 2 / 4 | 1 / 4 |
| delivered without scripted correction | 2 | 1 |
| completion claims the oracle rejected | 0 | 0 |
| scripted corrections used | 2 (both on the bug fix) | 0 (every failed run spent its wall before a correction could start) |
| launches killed at the wall | 0 | 3 |
| agent time, all launches | 42.6 min | 71.9 min |
| preparation and scoring outside the arm, all launches | 0.8 min | 0.6 min |
| end-to-end, all launches | 43.4 min | 72.5 min |
| tokens, all launches (every invocation's usage known) | 1,129,826 | 31,394,383 |
| agent minutes per delivery (all work / deliveries) | 21.3 | 71.9 |
| tokens per delivery (all work / deliveries) | 564,913 | 31,394,383 |

Token accounts are the arms' own and are not precisely comparable: Swarm sums the provider's
input and output per step; OpenCode's step-finish parts report input, output, reasoning (0) and
cache (0 read, 0 write). No reasoning tokens were reported by either arm. Swarm's 600,000-token
cap bound once (the bug fix's first invocation); OpenCode has no cap and was bounded by the wall
only, so the two arms were not budget-matched on tokens.

## Gate, item by item

| item | holds |
| --- | --- |
| eight valid, inspectable launches, no unresolved setup or scoring problem, no oracle exposure | yes (8 of 8; every Swarm evidence directory scanned, no mention of the sealed commit or mirror) |
| Swarm delivers at least three of four, including the bug fix and the feature | no (two: feature and refactor; the bug fix failed, the upgrade is a correct patch without a delivery) |
| zero false claims, no manual repair or hints, controls and budgets respected | yes (0 false claims; no human involvement; longest launch 19.4 agent minutes under the 20-minute maximum; no halt) |
| comparative benefit | yes on the correctness route (2 against 1), reported but not decisive since item 2 fails |

## What worked

- The instrument. The proved runner launched eight cells in the frozen order, watched the
  endpoint through every invocation (the same server instance from first to last record), wrote
  every record once, killed three OpenCode runs at the wall within the grace, and halted nothing.
- Two clean Swarm deliveries: the lru-cache refactor (3.1 min, 74,707 tokens, structural count
  and the full tap suite right) and the chai feature (2.1 min, 51,954 tokens, the maintainer's
  tests and messages right), each with an acceptable verdict the sealed oracle agreed with.
- Swarm's own bounds held: the stall detector ended a read-only loop, the token cap ended a
  repair loop, the wall ended the rest; no run claimed success it had not earned.
- Validation caught a bad task before freeze: the htmlparser2 bug fix an agent had verified
  turned out to have a base whose own suite fails and hangs ([candidates.md](candidates.md)).

## What failed, by demonstrated cause

- **Swarm, bug fix (model)**: 26 model calls of reading and searching (eight searches for a
  symbol that does not exist), no edit; the final tree is the base. The product bounded it.
- **Swarm, upgrade (configuration, then budget)**: the patch was right; the delivery failed on
  the product's default `tests` gate, which runs the project's `npm test` (chai's includes a
  Playwright browser suite) while the task named `npm run test-node`. Swarm's isolated child
  HOME had no browsers; the repair attempt downloaded 479 MB of them and the wall expired. A
  `[gates]` override in swarm.toml exists for this and the harness did not write one. That is a
  pilot configuration gap, frozen with the pilot and disclosed, not a product defect; the same
  default passed in the feature launch once the browsers were present, which is an environment
  change the arm made inside its own scratch HOME ([environment.json](environment.json)).
- **OpenCode, refactor, feature and bug fix (model)**: the model looped on one grep call (344,
  306 and 206 repetitions) until the wall; no edit, no final text, so no claim either way.
- **Inconclusive**: whether Swarm's upgrade would have been delivered under a configured
  `tests` gate, and whether any arm would do better with more wall; neither was run.

## Spend

| what | value |
| --- | --- |
| assignment | started 2026-10-14T23:50:07Z; preparation to first launch 34 min (limit 90); stage A 00:23:55Z to 02:19:56Z (1 h 56 min); analysis, publication and gates after |
| agent minutes | 114.5 of the 240 allowed (Swarm 42.6, OpenCode 71.9); stage B's 4 launches and the preflight were not spent |
| model usage | Swarm 1,129,826 tokens over 6 invocations; OpenCode 31,394,383 over 4; all local, no paid provider |
| infrastructure and preparation | gates before freeze 4 min; mining by four delegated agents about 25 min each in parallel; validation 2 min; model server loaded for the pilot and unloaded after |

## Evidence

- [manifest-stage-a.json](manifest-stage-a.json), digest `sha256:95bd822fcd3bdeff06ae1afffc96f804dc7c6564c85275d12f58a13be47aa3cb`; [manifest-stage-b.json](manifest-stage-b.json), frozen and unrun.
- [stage-a/records/](stage-a/packed-derived/records/) (packed in place; `node scripts/evidence-pack.mjs restore <that directory>` gives the files back) the eight launch records as the runner wrote them (invocation argv, exit, digests, verdicts, command log); [stage-a/patches/](stage-a/patches) each final patch; [stage-a/output/](stage-a/output) Swarm's result line and output tail, OpenCode's text, error and step events, and stderr tails per invocation; [stage-a/index.json](stage-a/index.json) the digests. Full stdout blobs stay in `~/.cache/swarm-comparison/blobs/` under the digests the records cite; Swarm's session bundles under `~/.swarm/sessions/2026101{4,5}T*`.
- [analysis.json](analysis.json) and [results.md](results.md): the analyzer's output, including OpenCode's final texts and the claim classification beside each.
- [validation.json](validation.json), [candidates.md](candidates.md), [environment.json](environment.json), [protocol.md](protocol.md).
- No credentials appear in the published material; nothing was redacted or omitted from the records.

Reproduce the tables: `node scripts/pilot/analyze.mjs --manifest docs/evidence/2026-10-14/real-task-pilot/manifest-stage-a.json`.

## Smallest next action

Configure Swarm's `tests` gate from the task definition (the harness already knows the project
test argv; swarm.toml takes `[gates] tests = { command = "..." }`), re-validate that the gate
plan matches the task text for every task, and only then consider a second small pilot. That
removes the one failure here that was neither the model's nor the product's. Nothing in this
pilot supports launching the larger comparison.
