# Phase 4 run summary (config BPP — B'' (Codex + Copilot + ClaudeCode))

- Patch SHA: `86cc48a83224bfd92fff217951a78b9a3cab3beb`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-3`
- Fixture content hash: `6232435322b9d0736d18a7b847ea32bd0a04cab3216d092fb351a5b4bbbdc460`
- Cost cap (per obligation, USD): 1.5000
- Obligations: 20
- Pass count: 0 (passes when *no* adapter reports a counter-example)
- Counter-examples returned (machine-claimed, total across adapters): 115
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 461.3 s
- Total LLM calls: 40
- Total dollars (billed): $1.0121
- Total dollars (token estimate): $1.5321

| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | calls | ms | cap | error |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| I1 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0485 | 0.0745 | 2 | 23207 |  |  |
| I2 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0484 | 0.0744 | 2 | 20574 |  |  |
| I3 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0488 | 0.0748 | 2 | 19625 |  |  |
| I4 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0487 | 0.0747 | 2 | 19082 |  |  |
| I5 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0489 | 0.0749 | 2 | 20055 |  |  |
| I6 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=2 | 5 | 1 | 0.0541 | 0.0801 | 2 | 26077 |  |  |
| I7 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=2 | 5 | 1 | 0.0542 | 0.0802 | 2 | 31545 |  |  |
| I8 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=2 | 5 | 1 | 0.0541 | 0.0801 | 2 | 31577 |  |  |
| I9 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=2 | 5 | 1 | 0.0549 | 0.0809 | 2 | 27562 |  |  |
| I10 | I | import-graph-must-satisfy | no | copilot,claude-code | copilot=3,claude-code=2 | 5 | 1 | 0.0558 | 0.0818 | 2 | 38112 |  |  |
| F1 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0484 | 0.0744 | 2 | 18783 |  |  |
| F2 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0494 | 0.0754 | 2 | 19608 |  |  |
| F3 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0499 | 0.0759 | 2 | 20822 |  |  |
| F4 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0486 | 0.0746 | 2 | 20024 |  |  |
| F5 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0529 | 0.0789 | 2 | 23314 |  |  |
| F6 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0529 | 0.0789 | 2 | 26947 |  |  |
| F7 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0492 | 0.0752 | 2 | 19472 |  |  |
| F8 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0483 | 0.0743 | 2 | 17522 |  |  |
| F9 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0479 | 0.0739 | 2 | 18332 |  |  |
| F10 | F | function-must-have-signature | no | copilot,claude-code | copilot=3,claude-code=3 | 6 | 0 | 0.0482 | 0.0742 | 2 | 18837 |  |  |
