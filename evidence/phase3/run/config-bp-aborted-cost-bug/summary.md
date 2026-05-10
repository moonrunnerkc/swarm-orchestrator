# Phase 3 run summary (config BP — B' (producer + Codex + Copilot))

- Patch SHA: `8536bc080643d76fb5f85a93884c9fd3608829ef`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-3`
- Fixture content hash: `6232435322b9d0736d18a7b847ea32bd0a04cab3216d092fb351a5b4bbbdc460`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 20
- Pass count: 0 (passes when system returns no falsification)
- Counter-examples returned (machine-claimed): 60
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 328.9 s
- Total LLM calls: 20
- Total dollars (billed): $0.0000
- Total dollars (token estimate): $0.0000

| id | stratum | type | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| I1 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 11827 |  |  |
| I2 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 10657 |  |  |
| I3 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 17202 |  |  |
| I4 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 14000 |  |  |
| I5 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 15106 |  |  |
| I6 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 23243 |  |  |
| I7 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 27931 |  |  |
| I8 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 20170 |  |  |
| I9 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 18953 |  |  |
| I10 | I | import-graph-must-satisfy | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 26531 |  |  |
| F1 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 12687 |  |  |
| F2 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 15378 |  |  |
| F3 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 13318 |  |  |
| F4 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 18565 |  |  |
| F5 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 14456 |  |  |
| F6 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 17393 |  |  |
| F7 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 11213 |  |  |
| F8 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 10248 |  |  |
| F9 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 13609 |  |  |
| F10 | F | function-must-have-signature | no | counter-example-input | 3 | 0 | 0.0000 | 0.0000 | 1 | 16277 |  |  |

Pass = system returns no falsification. For config B (producer + Codex), Codex does not handle Phase 3 obligation types and does not run; pass therefore reflects only whether the bare fixture verifies. For config B' (producer + Codex + Copilot), Copilot's adversarial perturbations decide.
