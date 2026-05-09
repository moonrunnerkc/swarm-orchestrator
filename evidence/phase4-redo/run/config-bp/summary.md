# Phase 4 redo run summary (config BP — B' (Codex))

- Patch SHA: `c32fd3d7395d08a6b2be35bdd7b16023a6d32e5e`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-1-gate`
- Fixture content hash: `b7f129e7335e96e1a1166828eac6696f24bd140f7378d1fa86199a621feacd25`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 20
- Pass count: 2 (passes when *no* adapter reports a counter-example)
- Counter-examples returned (machine-claimed): 54
- Errored obligations: 0
- Cost-cap hits: 0
- Total wall-clock: 467.3 s
- Total LLM calls: 20
- Total dollars (billed): $2.5349
- Total dollars (token estimate): $2.5349
- Total dollars (API-equivalent): $2.5349

| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | $apiEquiv | calls | ms | cap | error |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| A1 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1525 | 0.1525 | 0.1525 | 1 | 15794 |  |  |
| A2 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1516 | 0.1516 | 0.1516 | 1 | 12708 |  |  |
| A3 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1521 | 0.1521 | 0.1521 | 1 | 13471 |  |  |
| A4 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1521 | 0.1521 | 0.1521 | 1 | 12205 |  |  |
| A5 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.0288 | 0.0288 | 0.0288 | 1 | 9596 |  |  |
| A6 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1494 | 0.1494 | 0.1494 | 1 | 12810 |  |  |
| A7 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1450 | 0.1450 | 0.1450 | 1 | 10399 |  |  |
| A8 | A | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.0281 | 0.0281 | 0.0281 | 1 | 9518 |  |  |
| B1 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.0304 | 0.0304 | 0.0304 | 1 | 12620 |  |  |
| B2 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.0281 | 0.0281 | 0.0281 | 1 | 8745 |  |  |
| B3 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1499 | 0.1499 | 0.1499 | 1 | 10190 |  |  |
| B4 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1442 | 0.1442 | 0.1442 | 1 | 8404 |  |  |
| B5 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1509 | 0.1509 | 0.1509 | 1 | 10557 |  |  |
| B6 | B | property-must-hold | yes | — | codex=0 | 0 | 3 | 0.1607 | 0.1607 | 0.1607 | 1 | 28065 |  |  |
| B7 | B | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1507 | 0.1507 | 0.1507 | 1 | 10379 |  |  |
| C1 | C | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1493 | 0.1493 | 0.1493 | 1 | 10216 |  |  |
| C2 | C | property-must-hold | yes | — | codex=0 | 0 | 3 | 0.1573 | 0.1573 | 0.1573 | 1 | 221488 |  |  |
| C3 | C | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1563 | 0.1563 | 0.1563 | 1 | 23651 |  |  |
| C4 | C | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1512 | 0.1512 | 0.1512 | 1 | 14098 |  |  |
| C5 | C | property-must-hold | no | codex | codex=3 | 3 | 0 | 0.1463 | 0.1463 | 0.1463 | 1 | 12332 |  |  |
