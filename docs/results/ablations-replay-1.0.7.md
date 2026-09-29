# Ablations S0, S1, S2

Derived from 50 row(s) in `docs/evidence/2026-09-27/ai-pr-study/rows-replay-1.0.7.json.br` (digest sha256:20af881e9712f649407362cf6c251e9c1c4ac6cb753cda9930e3ba0d69708335) under the
frozen decision rule; 22 rows carry adjudicated truth and are the denominator of every
count. Read as what each addition changed, never as a ranking.

| Rung | What it adds | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- | --- |
| S0 | the repository's own test command, exit code only | 11 / 22 = 50.0% [30.7, 69.3] | 0 / 22 = 0.0% [0.0, 14.9] | 5 / 22 = 22.7% [10.1, 43.4] | 6 / 22 = 27.3% [13.2, 48.2] |
| S1 | the base control and the identity, isolation, install and output refusals, as the verifier version in these rows applies them | 5 / 22 = 22.7% [10.1, 43.4] | 0 / 22 = 0.0% [0.0, 14.9] | 3 / 22 = 13.6% [4.7, 33.3] | 14 / 22 = 63.6% [43.0, 80.3] |
| S2 | changed-line coverage and mutation witnesses, and the held-back check as oracle where an A2 pass exists | 6 / 22 = 27.3% [13.2, 48.2] | 0 / 22 = 0.0% [0.0, 14.9] | 0 / 22 = 0.0% [0.0, 14.9] | 16 / 22 = 72.7% [51.8, 86.8] |

S1 is read off the same rows as the verifier's verdict with the coverage and mutation
dimensions masked, which on these rows changes no decision: those dimensions feed the
unmeasured and oracle-reach readings, not the accept or refuse decision, when no contract is
supplied. S2 differs from S1 only on rows with an A2 pass.

## Rows

| # | Pull request | Truth | S0 | S1 | S2 |
| --- | --- | --- | --- | --- | --- |
| 1 | [yukieiji/ExtremeRoles#1061](https://github.com/yukieiji/ExtremeRoles/pull/1061) | requirement-met | accept | accept | accept |
| 2 | [Francis1998/nexus-llm-router#210](https://github.com/Francis1998/nexus-llm-router/pull/210) | requirement-met | accept | unmeasured | unmeasured |
| 3 | [Francis1998/agentic-career-search#193](https://github.com/Francis1998/agentic-career-search/pull/193) | requirement-met | accept | accept | accept |
| 5 | [Francis1998/agentic-career-search#205](https://github.com/Francis1998/agentic-career-search/pull/205) | requirement-met | accept | accept | accept |
| 7 | [glincker/thesvg#1153](https://github.com/glincker/thesvg/pull/1153) | requirement-met | unmeasured | unmeasured | unmeasured |
| 10 | [Francis1998/scholar-rag-agent#221](https://github.com/Francis1998/scholar-rag-agent/pull/221) | requirement-met | refuse | refuse | unmeasured |
| 14 | [glincker/thesvg#1159](https://github.com/glincker/thesvg/pull/1159) | requirement-met | unmeasured | unmeasured | unmeasured |
| 15 | [github/gh-aw-firewall#9077](https://github.com/github/gh-aw-firewall/pull/9077) | requirement-met | refuse | unmeasured | unmeasured |
| 16 | [glincker/thesvg#1138](https://github.com/glincker/thesvg/pull/1138) | requirement-met | unmeasured | unmeasured | unmeasured |
| 17 | [Francis1998/nexus-llm-router#203](https://github.com/Francis1998/nexus-llm-router/pull/203) | requirement-met | accept | unmeasured | unmeasured |
| 18 | [felixrieseberg/claude-coach#18](https://github.com/felixrieseberg/claude-coach/pull/18) | requirement-violated | refuse | unmeasured | refuse |
| 20 | [Francis1998/nexus-llm-router#212](https://github.com/Francis1998/nexus-llm-router/pull/212) | requirement-met | accept | unmeasured | unmeasured |
| 21 | [yukieiji/ExtremeRoles#1067](https://github.com/yukieiji/ExtremeRoles/pull/1067) | requirement-met | accept | accept | accept |
| 25 | [Francis1998/nexus-llm-router#201](https://github.com/Francis1998/nexus-llm-router/pull/201) | requirement-met | accept | unmeasured | unmeasured |
| 26 | [Francis1998/nexus-llm-router#218](https://github.com/Francis1998/nexus-llm-router/pull/218) | requirement-met | accept | unmeasured | unmeasured |
| 28 | [BYK/loreai#1947](https://github.com/BYK/loreai/pull/1947) | requirement-met | unmeasured | refuse | unmeasured |
| 34 | [Francis1998/agentic-career-search#200](https://github.com/Francis1998/agentic-career-search/pull/200) | requirement-met | accept | accept | accept |
| 35 | [Francis1998/scholar-rag-agent#229](https://github.com/Francis1998/scholar-rag-agent/pull/229) | requirement-met | refuse | refuse | unmeasured |
| 39 | [glincker/thesvg#1160](https://github.com/glincker/thesvg/pull/1160) | requirement-met | unmeasured | unmeasured | unmeasured |
| 43 | [kentcdodds/kody#2597](https://github.com/kentcdodds/kody/pull/2597) | requirement-met | refuse | unmeasured | unmeasured |
| 45 | [glincker/thesvg#1147](https://github.com/glincker/thesvg/pull/1147) | requirement-met | unmeasured | unmeasured | unmeasured |
| 50 | [kentcdodds/kody#2447](https://github.com/kentcdodds/kody/pull/2447) | requirement-met | refuse | unmeasured | unmeasured |
