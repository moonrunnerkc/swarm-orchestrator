Derived by analyzer sha256:6e731b4f517465bc3f957e2da8cf02603b412dc60eafa47698a66a99887128f8 (swarm-real-task-pilot.analysis.v2).

## Stage A: four fresh tasks, one launch per arm

### Stage A: evidence complete

Manifest `sha256:52fa6b4625e360fa50376761f99acad451b1be155e5b41d795f7b3dcf1996f75`; 8 of 8 frozen cells recorded once each; every cited blob present and verified; halts 0, recoveries 0.

### Launches

| task | arm | record valid | eligible for comparison | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered | why not eligible |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pako-feature-inflate-push-after-end | swarm | yes | yes | yes | yes | 0 | claims-completion | 1.3 min | 1.6 min | 136,822 |  |  |
| pako-feature-inflate-push-after-end | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.5 min | 0.7 min | 125,544 |  |  |
| csstree-upgrade-esbuild-0-24 | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.4 min | 0.6 min | 134,166 |  |  |
| csstree-upgrade-esbuild-0-24 | swarm | yes | yes | yes | no | 0 | no-completion-claim | 1.0 min | 1.3 min | 137,297 | exit 1; claim: no-completion-claim (reviewed under final-report-claim-v1: the report says the work was not accepted; its 'blocked by' line names a reason that is not the blocker (the unjustified advisory diff-budget failure is), which is a reporting defect of its own and not a completion claim); swarm's own verdict is not acceptable |  |
| mime-bugfix-gettype-line-terminators | swarm | yes | yes | yes | yes | 0 | claims-completion | 2.8 min | 3.0 min | 384,799 |  |  |
| mime-bugfix-gettype-line-terminators | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.5 min | 0.7 min | 114,637 |  |  |
| pako-refactor-options-default-param | opencode | yes | yes | yes | yes | 0 | claims-completion | 0.9 min | 1.1 min | 262,819 |  |  |
| pako-refactor-options-default-param | swarm | yes | yes | yes | yes | 0 | claims-completion | 2.0 min | 2.3 min | 346,650 |  |  |

### Per arm

| measure | swarm | opencode |
| --- | --- | --- |
| launches recorded (valid, eligible) | 4 (4, 4) | 4 (4, 4) |
| correct patches | 4 | 4 |
| correctly delivered (of which eligible) | 3 (3) | 4 (4) |
| delivered without scripted correction | 3 | 4 |
| claimed completion the oracle rejects | 0 | 0 |
| uncertain or unjudged claims | 0 | 0 |
| scripted corrections, total | 0 | 0 |
| launches killed at the wall | 0 | 0 |
| agent time, all launches | 7.0 min | 2.3 min |
| cleanup after the arm, all launches | 0.0 min | 0.0 min |
| preparation (install), all launches | 0.6 min | 0.1 min |
| scoring and harness, all launches | 0.6 min | 0.7 min |
| end-to-end, all launches | 8.2 min | 3.1 min |
| tokens, all launches | 1,005,568 | 637,166 |
| input tokens, as each arm reports it | 990,092 | 629,890 |
| output tokens, as each arm reports it | 15,476 | 7,276 |
| reasoning tokens (inside output), as each arm reports it | 0 | 0 |
| cached input tokens (inside input), as each arm reports it | 0 | 0 |
| agent minutes per delivery (all work / deliveries) | 2.3 | 0.6 |
| end-to-end minutes per delivery | 2.7 | 0.8 |
| tokens per delivery | 335,189.3 | 159,291.5 |

### Stage A gate (2026-10-15 rule): does not qualify

| item | holds | value |
| --- | --- | --- |
| all eight stage A records valid and inspectable; no unresolved setup, scoring or exposure problem | yes | 8 valid of 8 recorded; evidence complete; no setup problem |
| Swarm correctly delivers at least three of four, including the bug fix and the feature, with no manual help and no false completion claim (every delivery met the hidden oracle, which holds the task's mandatory requirements) | yes | 3 delivered: mime-bugfix-gettype-line-terminators, pako-feature-inflate-push-after-end, pako-refactor-options-default-param; 0 false claim(s); manual involvement: none recorded by the launcher |
| a concrete quality or supervision advantage: more correct deliveries without correction, or fewer corrections at equal delivery performance (the predeclared-quality route is judged outside the analyzer) | no | neither more deliveries without correction nor fewer corrections at equal deliveries; a predeclared quality improvement is not derivable by the analyzer and stays unjudged |
| Swarm no worse on the other primary quality, supervision and reliability measures; primary cost measures shown, a regression or an unresolved one named | no | correct deliveries: loss (3 vs 4); deliveries without correction: loss (3 vs 4); false completion claims: tie (0 vs 0); scripted corrections: tie (0 vs 0); launches killed at the wall: tie (0 vs 0); unresolved launches (no correct delivery): loss (1 vs 0); end-to-end minutes per correct delivery (cost): loss (2.7 vs 0.8); tokens per correct delivery, as each arm reports them (cost): loss (335,189.3 vs 159,291.5); cost regression: yes; cost unresolved: no |

Claims are classified by the stage's dated review under final-report-claim-v1 (claims-review.json): one rule applied to both tools' final reports, the quoted text kept beside each launch with the keyword heuristic's reading. Eligibility is derived from the records and the packaged blobs: the product's planned tests gate, prerequisite installs it printed, and the packaged gate runs of its sessions.

