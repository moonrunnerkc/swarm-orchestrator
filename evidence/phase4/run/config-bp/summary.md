# Phase 4 run summary (config BP — B' (Codex + Copilot))

- Patch SHA: `86cc48a83224bfd92fff217951a78b9a3cab3beb`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-3`
- Fixture content hash: `6232435322b9d0736d18a7b847ea32bd0a04cab3216d092fb351a5b4bbbdc460`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 20
- Pass count: 0 (passes when *no* adapter reports a counter-example)
- Counter-examples returned (machine-claimed, total across adapters): 60
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 371.5 s
- Total LLM calls: 20
- Total dollars (billed): $0.0000
- Total dollars (token estimate): $0.4680

| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| I1 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 28056 |  |  |
| I2 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 15129 |  |  |
| I3 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 13845 |  |  |
| I4 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 17318 |  |  |
| I5 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 14683 |  |  |
| I6 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 30211 |  |  |
| I7 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 26324 |  |  |
| I8 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 27416 |  |  |
| I9 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 17472 |  |  |
| I10 | I | import-graph-must-satisfy | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 24107 |  |  |
| F1 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 12004 |  |  |
| F2 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 13647 |  |  |
| F3 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 12935 |  |  |
| F4 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 11721 |  |  |
| F5 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 12993 |  |  |
| F6 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0000 | 1 | 31382 |  |  |
| F7 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 12650 |  |  |
| F8 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0000 | 1 | 23343 |  |  |
| F9 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 13084 |  |  |
| F10 | F | function-must-have-signature | no | copilot | copilot=3 | 3 | 0 | 0.0000 | 0.0260 | 1 | 12943 |  |  |
