# Phase 4 redo run summary (config BPP — B'' (Codex + ClaudeCode))

- Patch SHA: `ae56f2183a79d3ace2be6338a24abc2dd1a5f427`
- Fixture root: `/Users/brad/projects/swarm-orchestrator/evidence/fixtures/phase-1-gate`
- Fixture content hash: `b7f129e7335e96e1a1166828eac6696f24bd140f7378d1fa86199a621feacd25`
- Cost cap (per obligation, USD): 0.6500
- Obligations: 20
- Pass count: 1 (passes when *no* adapter reports a counter-example)
- Counter-examples returned (machine-claimed): 105
- Errored obligations: 1
- Cost-cap hits: 0
- Total wall-clock: 77.3 s
- Total LLM calls: 39
- Total dollars (billed): $4.3931
- Total dollars (token estimate): $4.3931
- Total dollars (API-equivalent): $4.3931

| id | stratum | type | pass | falsifying | per-adapter | yield | FP | $billed | $tokenEst | $apiEquiv | calls | ms | cap | error |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| A1 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.3262 | 0.3262 | 0.3262 | 2 | 23783 |  |  |
| A2 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2000 | 0.2000 | 0.2000 | 2 | 21312 |  |  |
| A3 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2104 | 0.2104 | 0.2104 | 2 | 41472 |  |  |
| A4 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1980 | 0.1980 | 0.1980 | 2 | 19548 |  |  |
| A5 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2007 | 0.2007 | 0.2007 | 2 | 21837 |  |  |
| A6 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2004 | 0.2004 | 0.2004 | 2 | 19886 |  |  |
| A7 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2164 | 0.2164 | 0.2164 | 2 | 22182 |  |  |
| A8 | A | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1971 | 0.1971 | 0.1971 | 2 | 17993 |  |  |
| B1 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1973 | 0.1973 | 0.1973 | 2 | 19087 |  |  |
| B2 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1980 | 0.1980 | 0.1980 | 2 | 18154 |  |  |
| B3 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.0754 | 0.0754 | 0.0754 | 2 | 20720 |  |  |
| B4 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1984 | 0.1984 | 0.1984 | 2 | 17513 |  |  |
| B5 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2028 | 0.2028 | 0.2028 | 2 | 20638 |  |  |
| B6 | B | property-must-hold | yes | — | codex=0,claude-code=0 | 0 | 6 | 0.2293 | 0.2293 | 0.2293 | 2 | 44505 |  |  |
| B7 | B | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.3339 | 0.3339 | 0.3339 | 2 | 16017 |  |  |
| C1 | C | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2004 | 0.2004 | 0.2004 | 2 | 21397 |  |  |
| C2 | C | property-must-hold | no | — | codex=0,claude-code=0 | 0 | 3 | 0.2741 | 0.2741 | 0.2741 | 1 | 380004 |  | claude-code: claude exec exceeded the 300000ms time budget; the call was killed. Increase FalsificationInput.timeBudgetMs if the obligation legitimately needs more time. |
| C3 | C | property-must-hold | no | codex | codex=3,claude-code=0 | 3 | 3 | 0.3331 | 0.3331 | 0.3331 | 2 | 36037 |  |  |
| C4 | C | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.2063 | 0.2063 | 0.2063 | 2 | 24049 |  |  |
| C5 | C | property-must-hold | no | codex,claude-code | codex=3,claude-code=3 | 6 | 0 | 0.1948 | 0.1948 | 0.1948 | 2 | 17210 |  |  |
