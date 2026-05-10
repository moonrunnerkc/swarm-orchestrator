# Phase 3 run summary (config B — B (producer + Codex))

- Patch SHA: `8536bc080643d76fb5f85a93884c9fd3608829ef`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-3`
- Fixture content hash: `6232435322b9d0736d18a7b847ea32bd0a04cab3216d092fb351a5b4bbbdc460`
- Cost cap (per obligation, USD): 0.0100
- Obligations: 20
- Pass count: 20 (passes when system returns no falsification)
- Counter-examples returned (machine-claimed): 0
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 0.1 s
- Total LLM calls: 0
- Total dollars (billed): $0.0000
- Total dollars (token estimate): $0.0000

| id | stratum | type | pass | result | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| I1 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 3 |  |  |
| I2 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| I3 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |
| I4 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| I5 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |
| I6 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |
| I7 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |
| I8 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| I9 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| I10 | I | import-graph-must-satisfy | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F1 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F2 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F3 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F4 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F5 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F6 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F7 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |
| F8 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F9 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 0 |  |  |
| F10 | F | function-must-have-signature | yes | producer-pass | 0 | 0 | 0.0000 | 0.0000 | 0 | 1 |  |  |

Pass = system returns no falsification. For config B (producer + Codex), Codex does not handle Phase 3 obligation types and does not run; pass therefore reflects only whether the bare fixture verifies. For config B' (producer + Codex + Copilot), Copilot's adversarial perturbations decide.
