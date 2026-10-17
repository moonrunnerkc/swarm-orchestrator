Derived by analyzer sha256:6e731b4f517465bc3f957e2da8cf02603b412dc60eafa47698a66a99887128f8 (swarm-real-task-pilot.analysis.v2).

## Stage A: four fresh tasks, one launch per arm

### Stage A: evidence complete

Manifest `sha256:ae376337176db88ceeda9589cba9018106b6c64b3ace9d3d39ff2756d017318c`; 16 of 16 frozen cells recorded once each; every cited blob present and verified; halts 0, recoveries 0.

### Launches

| task | arm | record valid | eligible for comparison | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered | why not eligible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| domutils-upgrade-htmlparser2-12-r1 | swarm | yes | yes | yes | yes | 0 | claims-completion | 0.8 min | 1.2 min | 63,723 |  |  |
| domutils-upgrade-htmlparser2-12-r1 | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.3 min | 0.5 min | 73,886 |  |  |
| tar-bugfix-negative-size-r1 | opencode | yes | yes | yes | yes | 0 | claims-completion | 1.9 min | 2.4 min | 623,485 |  |  |
| tar-bugfix-negative-size-r1 | swarm | yes | yes | yes | yes | 0 | claims-completion | 4.2 min | 5.0 min | 648,378 |  |  |
| json5-refactor-parse-state-switch-r1 | swarm | yes | yes | yes | yes | 0 | claims-completion | 1.8 min | 1.9 min | 768,956 |  |  |
| json5-refactor-parse-state-switch-r1 | opencode | yes | yes | yes | yes | 0 | claims-completion | 1.0 min | 1.1 min | 284,802 |  |  |
| css-select-feature-lang-r1 | opencode | yes | yes | yes | yes | 0 | claims-completion | 2.7 min | 2.9 min | 967,261 |  |  |
| css-select-feature-lang-r1 | swarm | yes | yes | yes | yes | 0 | claims-completion | 4.5 min | 4.9 min | 1,200,358 |  |  |
| domutils-upgrade-htmlparser2-12-r2 | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.5 min | 0.7 min | 201,840 |  |  |
| domutils-upgrade-htmlparser2-12-r2 | swarm | yes | yes | yes | yes | 0 | claims-completion | 0.8 min | 1.2 min | 65,446 |  |  |
| tar-bugfix-negative-size-r2 | swarm | yes | yes | no | no | 0 | claims-completion | 4.9 min | 5.6 min | 949,576 | hidden fail: node acceptance/hidden/negative-size.mjs exited 1 |  |
| tar-bugfix-negative-size-r2 | opencode | yes | yes | yes | yes | 0 | claims-completion | 1.3 min | 1.8 min | 549,315 |  |  |
| json5-refactor-parse-state-switch-r2 | opencode | yes | yes | yes | yes | 0 | claims-completion | 2.1 min | 2.2 min | 847,432 |  |  |
| json5-refactor-parse-state-switch-r2 | swarm | yes | yes | yes | yes | 0 | claims-completion | 2.8 min | 3.0 min | 932,604 |  |  |
| css-select-feature-lang-r2 | swarm | yes | yes | yes | yes | 0 | claims-completion | 4.0 min | 4.4 min | 987,439 |  |  |
| css-select-feature-lang-r2 | opencode | yes | yes | yes | yes | 0 | claims-completion | 4.4 min | 4.7 min | 1,948,989 |  |  |

### Per arm

| measure | swarm | opencode |
| --- | --- | --- |
| launches recorded (valid, eligible) | 8 (8, 8) | 8 (8, 8) |
| correct patches | 7 | 8 |
| correctly delivered (of which eligible) | 7 (7) | 8 (8) |
| delivered without scripted correction | 7 | 8 |
| claimed completion the oracle rejects | 1 | 0 |
| uncertain or unjudged claims | 0 | 0 |
| scripted corrections, total | 0 | 0 |
| launches killed at the wall | 0 | 0 |
| agent time, all launches | 23.7 min | 14.2 min |
| cleanup after the arm, all launches | 0.0 min | 0.0 min |
| preparation (install), all launches | 1.7 min | 0.1 min |
| scoring and harness, all launches | 1.7 min | 1.8 min |
| end-to-end, all launches | 27.1 min | 16.1 min |
| tokens, all launches | 5,616,480 | 5,497,010 |
| input tokens, as each arm reports it | 5,565,855 | 5,451,412 |
| output tokens, as each arm reports it | 50,625 | 45,598 |
| reasoning tokens (inside output), as each arm reports it | 0 | 0 |
| cached input tokens (inside input), as each arm reports it | 0 | 0 |
| agent minutes per delivery (all work / deliveries) | 3.4 | 1.8 |
| end-to-end minutes per delivery | 3.9 | 2 |
| tokens per delivery | 802,354.3 | 687,126.3 |

### Stage A gate (pilot-2026-10-14 rule): does not qualify

| item | holds | value |
| --- | --- | --- |
| eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure | no | 16 valid of 16 recorded; evidence complete; no setup problem |
| Swarm correctly delivers at least three of four, including the bug fix and the feature | yes | 7 delivered: css-select-feature-lang-r1, css-select-feature-lang-r2, domutils-upgrade-htmlparser2-12-r1, domutils-upgrade-htmlparser2-12-r2, json5-refactor-parse-state-switch-r1, json5-refactor-parse-state-switch-r2, tar-bugfix-negative-size-r1 |
| Swarm makes zero false completion claims, needs no manual repair or hints, respects controls and budgets | no | 1 false claim(s); max agent time 4.9 min; manual involvement: none recorded by the launcher; exposure status: as scanned by the launcher, unknown beyond that scan |
| comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver | no | deliveries swarm 7 vs opencode 8; end-to-end 27.1 vs 16.1 min; corrections no worse on the 7 task(s) both deliver: true |

Claims are classified by the stage's dated review under final-report-claim-v1 (claims-review.json): one rule applied to both tools' final reports, the quoted text kept beside each launch with the keyword heuristic's reading. Eligibility is derived from the records and the packaged blobs: the product's planned tests gate, prerequisite installs it printed, and the packaged gate runs of its sessions.

