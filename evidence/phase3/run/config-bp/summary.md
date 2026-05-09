# Phase 3 run summary (config BP — B' (producer + Codex + Copilot))

- Patch SHA: `6f76f94fd44c7f67dd645130870bb9cef88795cb`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-3`
- Fixture content hash: `6232435322b9d0736d18a7b847ea32bd0a04cab3216d092fb351a5b4bbbdc460`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 20
- Pass count: 0 (passes when system returns no falsification)
- Counter-examples returned (machine-claimed): 60
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 339.3 s
- Total LLM calls: 20
- Total dollars (billed): $0.0000
- Total dollars (token estimate): $0.5200

| id | stratum | type | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| I1 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 14644 |  |  |
| I2 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 14359 |  |  |
| I3 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 15383 |  |  |
| I4 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 12566 |  |  |
| I5 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 12306 |  |  |
| I6 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 24446 |  |  |
| I7 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 33252 |  |  |
| I8 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 41164 |  |  |
| I9 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 22295 |  |  |
| I10 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 21275 |  |  |
| F1 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 11267 |  |  |
| F2 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 9662 |  |  |
| F3 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 13505 |  |  |
| F4 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 12079 |  |  |
| F5 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 12383 |  |  |
| F6 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 15561 |  |  |
| F7 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 13749 |  |  |
| F8 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 11869 |  |  |
| F9 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 16758 |  |  |
| F10 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0260 | 1 | 10627 |  |  |

Pass = system returns no falsification. For config B (producer + Codex), Codex does not handle Phase 3 obligation types and does not run; pass therefore reflects only whether the bare fixture verifies. For config B' (producer + Codex + Copilot), Copilot's adversarial perturbations decide.
