# Phase 1 dev gate — run summary

- Patch SHA: `cb283648ad584921065b2bd5842a75506c880912`
- Obligations: 9
- Total wall-clock: 126.8 s
- Total dollars: $0.0000
- Counter-examples returned (machine-claimed): 24
- Errored obligations: 1

| id | stratum | result | yield | FP | $ | ms | codex_exit | error |
|---|---|---|---:|---:|---:|---:|---:|---|
| A1 | A | counter-example-input | 3 | 0 | 0.0321 | 15397 | 0 |  |
| A2 | A | counter-example-input | 3 | 0 | 0.0240 | 13873 | 0 |  |
| A3 | A | counter-example-input | 3 | 0 | 0.0237 | 12495 | 0 |  |
| A4 | A | counter-example-input | 3 | 0 | 0.0477 | 14537 | 0 |  |
| A5 | A | counter-example-input | 3 | 0 | 0.0489 | 15582 | 0 |  |
| A6 | A | counter-example-input | 3 | 0 | 0.0402 | 13697 | 0 |  |
| A7 | A | counter-example-input | 3 | 0 | 0.1084 | 13595 | 0 |  |
| A8 | A | counter-example-input | 3 | 0 | 0.0237 | 11247 | 0 |  |
| B1 | B | errored | 0 | 0 | 0.0000 | 14966 | 0 | candidate "root-env-empty" file[0].bytes must be a non-empty string |

Yield is *machine-claimed* only. Operator hand-inspection in inspection.md
determines confirmed-vs-false-positive yield.
