# Comparison A: identical-patch verifier decisions

Derived from 50 row(s) in `docs/evidence/2026-09-27/ai-pr-study/rows-replay-1.0.3.json.br` (digest sha256:84ce7fe14b88b6cca931b703bf8bf1998614ef040cbef58e86536a27ea70251a) under the
frozen decision rule of `docs/verifier-first/comparison-protocol.md`. Rows with adjudicated
truth: 22 of 50; every other row is outside every denominator here.

| Arm | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- |
| A0 | agreement 3 / 22 = 13.6% [4.7, 33.3] | false green 0 / 22 = 0.0% [0.0, 14.9] | false red 3 / 22 = 13.6% [4.7, 33.3] | unmeasured 16 / 22 = 72.7% [51.8, 86.8] |
| A1 | agreement 6 / 22 = 27.3% [13.2, 48.2] | false green 0 / 22 = 0.0% [0.0, 14.9] | false red 5 / 22 = 22.7% [10.1, 43.4] | unmeasured 11 / 22 = 50.0% [30.7, 69.3] |
| A2 | agreement 4 / 22 = 18.2% [7.3, 38.5] | false green 0 / 22 = 0.0% [0.0, 14.9] | false red 4 / 22 = 18.2% [7.3, 38.5] | unmeasured 14 / 22 = 63.6% [43.0, 80.3] |

Paired false-green difference A0 minus A1: 0, over
0 discordant row(s) (below the ten the rule requires before a difference is called meaningful).

A0 is the repository's own test command, exit code only. A1 is swarm-verify's regression-only
verdict over the same run: the same suite, plus the base control and the refusal paths. A2 is
swarm-verify with the held-back check as an oracle; rows without an A2 pass read "not run".

## Rows

| # | Pull request | Truth | A0 | A1 | A2 |
| --- | --- | --- | --- | --- | --- |
| 1 | [yukieiji/ExtremeRoles#1061](https://github.com/yukieiji/ExtremeRoles/pull/1061) | requirement-met | accept | accept | accept |
| 2 | [Francis1998/nexus-llm-router#210](https://github.com/Francis1998/nexus-llm-router/pull/210) | requirement-met | unmeasured | unmeasured | unmeasured |
| 3 | [Francis1998/agentic-career-search#193](https://github.com/Francis1998/agentic-career-search/pull/193) | requirement-met | unmeasured | unmeasured | refuse |
| 5 | [Francis1998/agentic-career-search#205](https://github.com/Francis1998/agentic-career-search/pull/205) | requirement-met | unmeasured | unmeasured | refuse |
| 7 | [glincker/thesvg#1153](https://github.com/glincker/thesvg/pull/1153) | requirement-met | unmeasured | refuse | unmeasured |
| 10 | [Francis1998/scholar-rag-agent#221](https://github.com/Francis1998/scholar-rag-agent/pull/221) | requirement-met | unmeasured | unmeasured | refuse |
| 14 | [glincker/thesvg#1159](https://github.com/glincker/thesvg/pull/1159) | requirement-met | unmeasured | refuse | unmeasured |
| 15 | [github/gh-aw-firewall#9077](https://github.com/github/gh-aw-firewall/pull/9077) | requirement-met | refuse | accept | accept |
| 16 | [glincker/thesvg#1138](https://github.com/glincker/thesvg/pull/1138) | requirement-met | unmeasured | refuse | unmeasured |
| 17 | [Francis1998/nexus-llm-router#203](https://github.com/Francis1998/nexus-llm-router/pull/203) | requirement-met | unmeasured | unmeasured | unmeasured |
| 18 | [felixrieseberg/claude-coach#18](https://github.com/felixrieseberg/claude-coach/pull/18) | requirement-violated | refuse | refuse | refuse |
| 20 | [Francis1998/nexus-llm-router#212](https://github.com/Francis1998/nexus-llm-router/pull/212) | requirement-met | unmeasured | unmeasured | unmeasured |
| 21 | [yukieiji/ExtremeRoles#1067](https://github.com/yukieiji/ExtremeRoles/pull/1067) | requirement-met | accept | accept | accept |
| 25 | [Francis1998/nexus-llm-router#201](https://github.com/Francis1998/nexus-llm-router/pull/201) | requirement-met | unmeasured | unmeasured | unmeasured |
| 26 | [Francis1998/nexus-llm-router#218](https://github.com/Francis1998/nexus-llm-router/pull/218) | requirement-met | unmeasured | unmeasured | unmeasured |
| 28 | [BYK/loreai#1947](https://github.com/BYK/loreai/pull/1947) | requirement-met | unmeasured | unmeasured | unmeasured |
| 34 | [Francis1998/agentic-career-search#200](https://github.com/Francis1998/agentic-career-search/pull/200) | requirement-met | unmeasured | unmeasured | refuse |
| 35 | [Francis1998/scholar-rag-agent#229](https://github.com/Francis1998/scholar-rag-agent/pull/229) | requirement-met | unmeasured | unmeasured | unmeasured |
| 39 | [glincker/thesvg#1160](https://github.com/glincker/thesvg/pull/1160) | requirement-met | unmeasured | refuse | unmeasured |
| 43 | [kentcdodds/kody#2597](https://github.com/kentcdodds/kody/pull/2597) | requirement-met | refuse | accept | unmeasured |
| 45 | [glincker/thesvg#1147](https://github.com/glincker/thesvg/pull/1147) | requirement-met | unmeasured | refuse | unmeasured |
| 50 | [kentcdodds/kody#2447](https://github.com/kentcdodds/kody/pull/2447) | requirement-met | refuse | accept | unmeasured |
