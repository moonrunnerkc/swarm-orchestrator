# Ablations S0, S1, S2

Derived from 50 row(s) in `docs/evidence/2026-09-27/ai-pr-study/rows.json.br` (digest sha256:cd149c7661dbbb17814828ccefc4fb6a9d5859cacba6f9afe24aef718ac3a101) under the
frozen decision rule; 22 rows carry adjudicated truth and are the denominator of every
count. Read as what each addition changed, never as a ranking.

| Rung | What it adds | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- | --- |
| S0 | the repository's own test command, exit code only | 3 / 22 = 13.6% [4.7, 33.3] | 0 / 22 = 0.0% [0.0, 14.9] | 3 / 22 = 13.6% [4.7, 33.3] | 16 / 22 = 72.7% [51.8, 86.8] |
| S1 | the base control (an inherited failure is not charged to the patch) and the identity, isolation, install and output refusals | 8 / 22 = 36.4% [19.7, 57.0] | 1 / 22 = 4.5% [0.8, 21.8] | 3 / 22 = 13.6% [4.7, 33.3] | 10 / 22 = 45.5% [26.9, 65.3] |
| S2 | changed-line coverage and mutation witnesses, and the held-back check as oracle where an A2 pass exists | 1 / 22 = 4.5% [0.8, 21.8] | 0 / 22 = 0.0% [0.0, 14.9] | 10 / 22 = 45.5% [26.9, 65.3] | 11 / 22 = 50.0% [30.7, 69.3] |

S1 is read off the same rows as the verifier's verdict with the coverage and mutation
dimensions masked, which on these rows changes no decision: those dimensions feed the
unmeasured and oracle-reach readings, not the accept or refuse decision, when no contract is
supplied. S2 differs from S1 only on rows with an A2 pass.

## Rows

| # | Pull request | Truth | S0 | S1 | S2 |
| --- | --- | --- | --- | --- | --- |
| 1 | [yukieiji/ExtremeRoles#1061](https://github.com/yukieiji/ExtremeRoles/pull/1061) | requirement-met | accept | accept | refuse |
| 2 | [Francis1998/nexus-llm-router#210](https://github.com/Francis1998/nexus-llm-router/pull/210) | requirement-met | unmeasured | unmeasured | unmeasured |
| 3 | [Francis1998/agentic-career-search#193](https://github.com/Francis1998/agentic-career-search/pull/193) | requirement-met | unmeasured | unmeasured | unmeasured |
| 5 | [Francis1998/agentic-career-search#205](https://github.com/Francis1998/agentic-career-search/pull/205) | requirement-met | unmeasured | unmeasured | unmeasured |
| 7 | [glincker/thesvg#1153](https://github.com/glincker/thesvg/pull/1153) | requirement-met | unmeasured | refuse | refuse |
| 10 | [Francis1998/scholar-rag-agent#221](https://github.com/Francis1998/scholar-rag-agent/pull/221) | requirement-met | unmeasured | unmeasured | unmeasured |
| 14 | [glincker/thesvg#1159](https://github.com/glincker/thesvg/pull/1159) | requirement-met | unmeasured | refuse | refuse |
| 15 | [github/gh-aw-firewall#9077](https://github.com/github/gh-aw-firewall/pull/9077) | requirement-met | refuse | accept | refuse |
| 16 | [glincker/thesvg#1138](https://github.com/glincker/thesvg/pull/1138) | requirement-met | unmeasured | accept | refuse |
| 17 | [Francis1998/nexus-llm-router#203](https://github.com/Francis1998/nexus-llm-router/pull/203) | requirement-met | unmeasured | unmeasured | unmeasured |
| 18 | [felixrieseberg/claude-coach#18](https://github.com/felixrieseberg/claude-coach/pull/18) | requirement-violated | refuse | accept | refuse |
| 20 | [Francis1998/nexus-llm-router#212](https://github.com/Francis1998/nexus-llm-router/pull/212) | requirement-met | unmeasured | unmeasured | unmeasured |
| 21 | [yukieiji/ExtremeRoles#1067](https://github.com/yukieiji/ExtremeRoles/pull/1067) | requirement-met | accept | accept | refuse |
| 25 | [Francis1998/nexus-llm-router#201](https://github.com/Francis1998/nexus-llm-router/pull/201) | requirement-met | unmeasured | unmeasured | unmeasured |
| 26 | [Francis1998/nexus-llm-router#218](https://github.com/Francis1998/nexus-llm-router/pull/218) | requirement-met | unmeasured | unmeasured | unmeasured |
| 28 | [BYK/loreai#1947](https://github.com/BYK/loreai/pull/1947) | requirement-met | unmeasured | accept | unmeasured |
| 34 | [Francis1998/agentic-career-search#200](https://github.com/Francis1998/agentic-career-search/pull/200) | requirement-met | unmeasured | unmeasured | unmeasured |
| 35 | [Francis1998/scholar-rag-agent#229](https://github.com/Francis1998/scholar-rag-agent/pull/229) | requirement-met | unmeasured | unmeasured | unmeasured |
| 39 | [glincker/thesvg#1160](https://github.com/glincker/thesvg/pull/1160) | requirement-met | unmeasured | refuse | refuse |
| 43 | [kentcdodds/kody#2597](https://github.com/kentcdodds/kody/pull/2597) | requirement-met | refuse | accept | refuse |
| 45 | [glincker/thesvg#1147](https://github.com/glincker/thesvg/pull/1147) | requirement-met | unmeasured | accept | refuse |
| 50 | [kentcdodds/kody#2447](https://github.com/kentcdodds/kody/pull/2447) | requirement-met | refuse | accept | refuse |
