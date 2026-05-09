# Phase 1 dev gate — run summary

- Patch SHA: `00afa45313c2d57303472695e00c29e9ac12409b`
- Obligations: 3
- Total wall-clock: 35.7 s
- Total dollars: $0.0000
- Counter-examples returned (machine-claimed): 6
- Errored obligations: 1

| id | stratum | result | yield | FP | $ | ms | codex_exit | error |
|---|---|---|---:|---:|---:|---:|---:|---|
| A1 | A | counter-example-input | 3 | 0 | 0.1442 | 10988 | 0 |  |
| A2 | A | counter-example-input | 3 | 0 | 0.1442 | 9347 | 0 |  |
| A3 | A | errored | 0 | 0 | 0.0000 | 14839 | 0 | Codex output contained a fenced ```json``` block but it did not parse as JSON. Inspect captured stdout to debug the prompt; do not auto-retry — the prompt may need a strategy iteration. |

Yield is *machine-claimed* only. Operator hand-inspection in inspection.md
determines confirmed-vs-false-positive yield.
