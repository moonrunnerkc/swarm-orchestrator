## Stage A: four fresh tasks, one launch per arm

Manifest `sha256:95bd822fcd3bdeff06ae1afffc96f804dc7c6564c85275d12f58a13be47aa3cb`; 8 of 8 launches recorded; halts 0, recoveries 0.

### Launches

| task | arm | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chai-upgrade-c8-v12 | swarm | yes | no | 0 | reports-not-acceptable | 18.0 min | 18.1 min | 308,045 | exit 1; claim: reports-not-acceptable (exit 1: the gates settled escalated; the run stopped as max-wall-time; the run was cancelled); swarm's own verdict is not acceptable |
| chai-upgrade-c8-v12 | opencode | yes | yes | 0 | claims-completion | 11.9 min | 12.0 min | 781,692 |  |
| lru-cache-refactor-autopurge-noop-timer | opencode | no | no | 0 | killed | 20.0 min | 20.3 min | 12,212,725 | hidden fail: structural: /!this\.ttlAutopurge \?/ occurs 0 time(s) in src/index.ts, expected 1; visible checks never resolved; killed at the wall (SIGKILL(deadline)); claim: killed (ended on SIGKILL(deadline)) |
| lru-cache-refactor-autopurge-noop-timer | swarm | yes | yes | 0 | claims-completion | 3.1 min | 3.5 min | 74,707 |  |
| chai-feature-deep-contain-oneof | swarm | yes | yes | 0 | claims-completion | 2.1 min | 2.2 min | 51,954 |  |
| chai-feature-deep-contain-oneof | opencode | no | no | 0 | killed | 20.0 min | 20.1 min | 10,841,542 | hidden fail: the final tree is the base: nothing was changed; visible checks never resolved; killed at the wall (SIGKILL(deadline)); claim: killed (ended on SIGKILL(deadline)) |
| csstree-bugfix-raw-value-whitespace | opencode | no | no | 0 | killed | 20.0 min | 20.1 min | 7,558,424 | hidden fail: the final tree is the base: nothing was changed; visible checks never resolved; killed at the wall (SIGKILL(deadline)); claim: killed (ended on SIGKILL(deadline)) |
| csstree-bugfix-raw-value-whitespace | swarm | no | no | 2 | reports-not-acceptable | 19.4 min | 19.5 min | 695,120 | hidden fail: the final tree is the base: nothing was changed; visible checks never resolved; exit 1; claim: reports-not-acceptable (exit 1: required checks unmet: task-acceptance; the gates settled escalated; the run stopped as max-wall-time; the run was cancelled); swarm's own verdict is not acceptable |

### Per arm

| measure | swarm | opencode |
| --- | --- | --- |
| launches recorded (valid) | 4 (4) | 4 (4) |
| correct patches | 3 | 1 |
| correctly delivered | 2 | 1 |
| delivered without scripted correction | 2 | 1 |
| claimed completion the oracle rejects | 0 | 0 |
| uncertain claims | 0 | 0 |
| scripted corrections, total | 2 | 0 |
| launches killed at the wall | 0 | 3 |
| agent time, all launches | 42.6 min | 71.9 min |
| preparation (install), all launches | 0.1 min | 0.1 min |
| scoring and harness, all launches | 0.7 min | 0.5 min |
| end-to-end, all launches | 43.4 min | 72.5 min |
| tokens, all launches | 1,129,826 | 31,394,383 |
| agent minutes per delivery (all work / deliveries) | 21.3 | 71.9 |
| end-to-end minutes per delivery | 21.7 | 72.5 |
| tokens per delivery | 564,913 | 31,394,383 |

### Stage A gate: does not qualify

| item | holds | value |
| --- | --- | --- |
| eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure | yes | 8 valid of 8 recorded |
| Swarm correctly delivers at least three of four, including the bug fix and the feature | no | 2 delivered: chai-feature-deep-contain-oneof, lru-cache-refactor-autopurge-noop-timer |
| Swarm makes zero false completion claims, needs no manual repair or hints, respects controls and budgets | yes | 0 false claim(s); max agent time 19.352116666666667 min; manual involvement: none recorded by the launcher |
| comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver | yes | deliveries swarm 2 vs opencode 1; end-to-end 43.4 vs 72.5 min; corrections no worse on the 0 task(s) both deliver: true |

OpenCode's claim classification is a keyword heuristic over its final text; the text is kept in the analysis JSON beside each launch.

