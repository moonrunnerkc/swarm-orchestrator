Derived by analyzer sha256:92562b207da36aeb9792af46f4b2cb228fc16840dc2ff4470873cf5bf855450d (swarm-real-task-pilot.analysis.v2).

## Development stage dev: the upgrade and the feature, one launch per arm

### Development stage dev: the upgrade and the feature, one launch per arm: evidence complete

Manifest `sha256:962ab7fdba5a389afe367a40e2c04187b17df701cffc5312e92dc6e1f880fb54`; 4 of 4 frozen cells recorded once each; every cited blob present and verified; halts 0, recoveries 0.

### Launches

| task | arm | record valid | eligible for comparison | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered | why not eligible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chai-upgrade-c8-v12-dev | swarm | yes | yes | yes | yes | 0 | claims-completion | 2.6 min | 2.9 min | 80,588 |  |  |
| chai-upgrade-c8-v12-dev | opencode | yes | yes | yes | yes | 0 | claims-completion | 1.2 min | 1.3 min | 108,946 |  |  |
| chai-feature-deep-contain-oneof-dev | opencode | yes | yes | no | no | 0 | killed | 20.0 min | 20.1 min | 587,646 | hidden fail: the final tree is the base: nothing was changed; visible checks never resolved; killed at the wall (SIGKILL(deadline)); claim: killed (ended on SIGKILL(deadline)) |  |
| chai-feature-deep-contain-oneof-dev | swarm | yes | yes | yes | no | 0 | reports-not-acceptable | 4.2 min | 4.5 min | 104,895 | exit 1; claim: reports-not-acceptable (exit 1: required checks unmet: task-acceptance; the gates settled escalated); swarm's own verdict is not acceptable |  |

### Per arm

| measure | swarm | opencode |
| --- | --- | --- |
| launches recorded (valid, eligible) | 2 (2, 2) | 2 (2, 2) |
| correct patches | 2 | 1 |
| correctly delivered (of which eligible) | 1 (1) | 1 (1) |
| delivered without scripted correction | 1 | 1 |
| claimed completion the oracle rejects | 0 | 0 |
| uncertain claims | 0 | 0 |
| scripted corrections, total | 0 | 0 |
| launches killed at the wall | 0 | 1 |
| agent time, all launches | 6.8 min | 21.2 min |
| preparation (install), all launches | 0.3 min | 0.0 min |
| scoring and harness, all launches | 0.2 min | 0.2 min |
| end-to-end, all launches | 7.3 min | 21.4 min |
| tokens, all launches | 185,483 | 696,592 |
| agent minutes per delivery (all work / deliveries) | 6.8 | 21.2 |
| end-to-end minutes per delivery | 7.3 | 21.4 |
| tokens per delivery | 185,483 | 696,592 |

### Stage A gate: does not qualify

| item | holds | value |
| --- | --- | --- |
| eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure | no | 4 valid of 4 recorded; evidence complete; no setup problem |
| Swarm correctly delivers at least three of four, including the bug fix and the feature | no | 1 delivered: chai-upgrade-c8-v12-dev |
| Swarm makes zero false completion claims, needs no manual repair or hints, respects controls and budgets | yes | 0 false claim(s); max agent time 4.2 min; manual involvement: none recorded by the launcher; exposure status: as scanned by the launcher, unknown beyond that scan |
| comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver | yes | deliveries swarm 1 vs opencode 1; end-to-end 7.3 vs 21.4 min; corrections no worse on the 1 task(s) both deliver: true |

OpenCode's claim classification is a keyword heuristic over its final text; the text is kept in the analysis JSON beside each launch. Eligibility is derived from the records and the packaged blobs: the product's planned tests gate, prerequisite installs it printed, and the packaged gate runs of its sessions.

