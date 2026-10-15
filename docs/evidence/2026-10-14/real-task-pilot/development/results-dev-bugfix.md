Derived by analyzer sha256:92562b207da36aeb9792af46f4b2cb228fc16840dc2ff4470873cf5bf855450d (swarm-real-task-pilot.analysis.v2).

## Development stage dev-bugfix: the bug fix under Swarm

### Development stage dev-bugfix: the bug fix under Swarm: evidence complete

Manifest `sha256:240e4e961a2b8d36942abb17295f694833f4147d3d02fcb8935cc93bbb6bfe25`; 1 of 1 frozen cells recorded once each; every cited blob present and verified; halts 0, recoveries 0.

### Launches

| task | arm | record valid | eligible for comparison | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered | why not eligible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| csstree-bugfix-raw-value-whitespace-dev | swarm | yes | yes | no | no | 2 | reports-not-acceptable | 19.0 min | 19.4 min | 843,830 | hidden fail: hidden tests (npx mocha lib/__tests/generate.js --require lib/__tests/helpers/setup.js) exited 1; visible checks never resolved; exit 1; claim: reports-not-acceptable (exit 1: required checks unmet: task-acceptance; the gates settled escalated; the run stopped as max-wall-time; the run was cancelled); swarm's own verdict is not acceptable |  |

### Per arm

| measure | swarm | opencode |
| --- | --- | --- |
| launches recorded (valid, eligible) | 1 (1, 1) | 0 (0, 0) |
| correct patches | 0 | 0 |
| correctly delivered (of which eligible) | 0 (0) | 0 (0) |
| delivered without scripted correction | 0 | 0 |
| claimed completion the oracle rejects | 0 | 0 |
| uncertain claims | 0 | 0 |
| scripted corrections, total | 2 | 0 |
| launches killed at the wall | 0 | 0 |
| agent time, all launches | 19.0 min | 0.0 min |
| preparation (install), all launches | 0.2 min | 0.0 min |
| scoring and harness, all launches | 0.2 min | 0.0 min |
| end-to-end, all launches | 19.4 min | 0.0 min |
| tokens, all launches | 843,830 | 0 |
| agent minutes per delivery (all work / deliveries) | undefined (zero deliveries) | undefined (zero deliveries) |
| end-to-end minutes per delivery | undefined (zero deliveries) | undefined (zero deliveries) |
| tokens per delivery | undefined (zero deliveries) | undefined (zero deliveries) |

### Stage A gate: does not qualify

| item | holds | value |
| --- | --- | --- |
| eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure | no | 1 valid of 1 recorded; evidence complete; no setup problem |
| Swarm correctly delivers at least three of four, including the bug fix and the feature | no | 0 delivered: none |
| Swarm makes zero false completion claims, needs no manual repair or hints, respects controls and budgets | yes | 0 false claim(s); max agent time 19.0 min; manual involvement: none recorded by the launcher; exposure status: as scanned by the launcher, unknown beyond that scan |
| comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver | no | deliveries swarm 0 vs opencode 0; end-to-end 19.4 vs 0.0 min; corrections no worse on the 0 task(s) both deliver: true |

OpenCode's claim classification is a keyword heuristic over its final text; the text is kept in the analysis JSON beside each launch. Eligibility is derived from the records and the packaged blobs: the product's planned tests gate, prerequisite installs it printed, and the packaged gate runs of its sessions.

