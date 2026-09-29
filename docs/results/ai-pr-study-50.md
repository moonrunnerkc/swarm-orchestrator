# AI-authored pull request study: report

Derived from 50 row(s) in `docs/evidence/2026-09-27/ai-pr-study/rows.json.br` (digest sha256:cd149c7661dbbb17814828ccefc4fb6a9d5859cacba6f9afe24aef718ac3a101) under the
registered protocol `docs/verifier-first/ai-pr-study-protocol.md`, frame queried 2026-09-27T21:04:18.412Z, seed
`verifier-first-2026-09-27`, window 2026-06-29 to 2026-09-27. Verifier version(s) in
the executed rows: 1.0.2. Every rate carries its denominator and a Wilson 95%
interval. This is an observational study of a convenience population; it makes no claim about
AI-written code in general and none about any tool that was not run.

## Denominators

| Quantity | Count | Share |
| --- | --- | --- |
| Selected pull requests with a fetched row | 50 / 50 | 100.0% [92.9, 100.0] |
| Executed: the verifier ran to a verdict on the exact head in a fresh container | 50 / 50 | 100.0% [92.9, 100.0] |
| Blocked: the verifier could not execute, reason recorded | 0 / 50 | 0.0% [0.0, 7.1] |
| Not yet run through the verifier | 0 / 50 | 0.0% [0.0, 7.1] |
| Original-suite green among executed | 6 / 50 | 12.0% [5.6, 23.8] |
| Adjudicated: task truth established by an executed held-back check | 13 / 50 | 26.0% [15.9, 39.6] |
| Text-inspection checks (grep, file presence): reported apart, not task truth | 9 / 50 | 18.0% [9.8, 30.8] |
| Unjudged: no executable check, or the check did not fail on the base, or an assertion beyond the requirement | 28 / 50 | 56.0% [42.3, 68.8] |
| Not yet adjudicated | 0 / 50 | 0.0% [0.0, 7.1] |

## Primary outcome

| Quantity | Count | Share |
| --- | --- | --- |
| Original-suite green with adjudicated task truth (the false-green denominator) | 0 / 50 | 0.0% [0.0, 7.1] |
| Observed false green: suite green and the held-back check demonstrates a violated requirement | 0 / 0 | n/a |
| Requirement violated among adjudicated | 0 / 13 | 0.0% [0.0, 22.8] |
| Requirement met among adjudicated | 13 / 13 | 100.0% [77.2, 100.0] |

## Verifier detection and acceptance

| Quantity | Count | Share |
| --- | --- | --- |
| Observed false greens the verifier refused (a held-back finding is not a verifier catch) | 0 / 0 | n/a |
| Adjudicated-correct pull requests the verifier accepted | 0 / 13 | 0.0% [0.0, 22.8] |
| Adjudicated-correct pull requests the verifier refused | 1 / 13 | 7.7% [1.4, 33.3] |
| Adjudicated-correct pull requests the verifier left unmeasured | 12 / 13 | 92.3% [66.7, 98.6] |

## Practical cost

- Wall time per executed pull request (clone, fetch, install, checks, base control):
  median 29 s, over 50 row(s).
- Manual interventions: none; every row was produced by the runner without a person acting.

## Per author account

| Account | Rows | Executed | Suite green | Adjudicated | Violated | False green |
| --- | --- | --- | --- | --- | --- | --- |
| claude | 9 | 9 | 0 | 0 | 0 | 0 |
| copilot-swe-agent | 4 | 4 | 1 | 0 | 0 | 0 |
| cursor | 23 | 23 | 0 | 9 | 0 | 0 |
| devin-ai-integration | 4 | 4 | 0 | 1 | 0 | 0 |
| google-labs-jules | 10 | 10 | 5 | 3 | 0 | 0 |

## Why rows were blocked

No blocked rows.

No row was rerun after an infrastructure failure.

## Why rows stayed unjudged

- 1: Check that the CI workflow file exists and contains all required elements
- 1: The PR adds a CommuteCostTradeoffAdvisor service that computes commute cost vs remote-stip
- 1: The PR adds a SeverancePackageGapAdvisor class that computes severance coverage bands vs t
- 1: The PR adds a new constant `STANDALONE_GLOBAL_EVAL_SAFE_CONSTRUCTOR_NAMES` containing ["Sy
- 1: The PR fixes a NullReferenceException in BakaryRoleTests by updating SetupGameOptionsManag
- 1: The pull request removes the `organizations
- 1: The requirement is to verify that the unit test compilation and execution errors in Enclos
- 1: This PR is a documentation-only change that updates existing docs to reflect recently ship
- 1: This check verifies the core requirements of PR #331 which integrates the top bar on Windo
- 1: This is a documentation-only PR that updates usage-metering docs to be in present tense an
- 2: no executable check
- 3: the check does not fail on the base
- 3: the check fails the same way on the base and the head
- 4: the head fails an assertion that is not stated in the requirement
- 6: the reviewer produced no check within 30 steps

## Rows

| # | Pull request | Verifier | Suite green | Truth | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | [yukieiji/ExtremeRoles#1061](https://github.com/yukieiji/ExtremeRoles/pull/1061) | executed | yes | requirement-met (text inspection) | unmeasured |
| 2 | [Francis1998/nexus-llm-router#210](https://github.com/Francis1998/nexus-llm-router/pull/210) | executed | no | requirement-met | unmeasured |
| 3 | [Francis1998/agentic-career-search#193](https://github.com/Francis1998/agentic-career-search/pull/193) | executed | no | requirement-met | unmeasured |
| 4 | [yukieiji/ExtremeRoles#1068](https://github.com/yukieiji/ExtremeRoles/pull/1068) | executed | yes | unjudged | unmeasured |
| 5 | [Francis1998/agentic-career-search#205](https://github.com/Francis1998/agentic-career-search/pull/205) | executed | no | requirement-met | unmeasured |
| 6 | [yukieiji/ExtremeRoles#1041](https://github.com/yukieiji/ExtremeRoles/pull/1041) | executed | yes | unjudged | unmeasured |
| 7 | [glincker/thesvg#1153](https://github.com/glincker/thesvg/pull/1153) | executed | no | requirement-met | refuse |
| 8 | [loopdive/js2#6187](https://github.com/loopdive/js2/pull/6187) | executed | no | unjudged | unmeasured |
| 9 | [BYK/loreai#1941](https://github.com/BYK/loreai/pull/1941) | executed | no | unjudged | unmeasured |
| 10 | [Francis1998/scholar-rag-agent#221](https://github.com/Francis1998/scholar-rag-agent/pull/221) | executed | no | requirement-met | unmeasured |
| 11 | [loopdive/js2#6115](https://github.com/loopdive/js2/pull/6115) | executed | no | unjudged | unmeasured |
| 12 | [Francis1998/agentic-career-search#199](https://github.com/Francis1998/agentic-career-search/pull/199) | executed | no | unjudged | unmeasured |
| 13 | [yukieiji/ExtremeRoles#1079](https://github.com/yukieiji/ExtremeRoles/pull/1079) | executed | yes | unjudged | unmeasured |
| 14 | [glincker/thesvg#1159](https://github.com/glincker/thesvg/pull/1159) | executed | no | requirement-met | unmeasured |
| 15 | [github/gh-aw-firewall#9077](https://github.com/github/gh-aw-firewall/pull/9077) | executed | no | requirement-met (text inspection) | unmeasured |
| 16 | [glincker/thesvg#1138](https://github.com/glincker/thesvg/pull/1138) | executed | no | requirement-met | unmeasured |
| 17 | [Francis1998/nexus-llm-router#203](https://github.com/Francis1998/nexus-llm-router/pull/203) | executed | no | requirement-met | unmeasured |
| 18 | [felixrieseberg/claude-coach#18](https://github.com/felixrieseberg/claude-coach/pull/18) | executed | no | requirement-violated (text inspection) | unmeasured |
| 19 | [Francis1998/scholar-rag-agent#223](https://github.com/Francis1998/scholar-rag-agent/pull/223) | executed | no | unjudged | unmeasured |
| 20 | [Francis1998/nexus-llm-router#212](https://github.com/Francis1998/nexus-llm-router/pull/212) | executed | no | requirement-met (text inspection) | unmeasured |
| 21 | [yukieiji/ExtremeRoles#1067](https://github.com/yukieiji/ExtremeRoles/pull/1067) | executed | yes | requirement-met (text inspection) | unmeasured |
| 22 | [loopdive/js2#6127](https://github.com/loopdive/js2/pull/6127) | executed | no | unjudged | unmeasured |
| 23 | [getsentry/sentry#125248](https://github.com/getsentry/sentry/pull/125248) | executed | no | unjudged | unmeasured |
| 24 | [loopdive/js2#6129](https://github.com/loopdive/js2/pull/6129) | executed | no | unjudged | unmeasured |
| 25 | [Francis1998/nexus-llm-router#201](https://github.com/Francis1998/nexus-llm-router/pull/201) | executed | no | requirement-met | unmeasured |
| 26 | [Francis1998/nexus-llm-router#218](https://github.com/Francis1998/nexus-llm-router/pull/218) | executed | no | requirement-met (text inspection) | unmeasured |
| 27 | [Francis1998/agentic-career-search#191](https://github.com/Francis1998/agentic-career-search/pull/191) | executed | no | unjudged | unmeasured |
| 28 | [BYK/loreai#1947](https://github.com/BYK/loreai/pull/1947) | executed | no | requirement-met | unmeasured |
| 29 | [loopdive/js2#6111](https://github.com/loopdive/js2/pull/6111) | executed | no | unjudged | unmeasured |
| 30 | [YoungCan-Wang/WyckoffTradingAgent#490](https://github.com/YoungCan-Wang/WyckoffTradingAgent/pull/490) | executed | no | unjudged | unmeasured |
| 31 | [BYK/loreai#1937](https://github.com/BYK/loreai/pull/1937) | executed | no | unjudged | unmeasured |
| 32 | [Francis1998/scholar-rag-agent#204](https://github.com/Francis1998/scholar-rag-agent/pull/204) | executed | no | unjudged | unmeasured |
| 33 | [Francis1998/scholar-rag-agent#228](https://github.com/Francis1998/scholar-rag-agent/pull/228) | executed | no | unjudged | unmeasured |
| 34 | [Francis1998/agentic-career-search#200](https://github.com/Francis1998/agentic-career-search/pull/200) | executed | no | requirement-met | unmeasured |
| 35 | [Francis1998/scholar-rag-agent#229](https://github.com/Francis1998/scholar-rag-agent/pull/229) | executed | no | requirement-met | unmeasured |
| 36 | [github/gh-aw-firewall#9075](https://github.com/github/gh-aw-firewall/pull/9075) | executed | no | unjudged | unmeasured |
| 37 | [felixrieseberg/claude-coach#20](https://github.com/felixrieseberg/claude-coach/pull/20) | executed | no | unjudged | unmeasured |
| 38 | [felixrieseberg/claude-coach#21](https://github.com/felixrieseberg/claude-coach/pull/21) | executed | no | unjudged | unmeasured |
| 39 | [glincker/thesvg#1160](https://github.com/glincker/thesvg/pull/1160) | executed | no | requirement-met (text inspection) | refuse |
| 40 | [kentcdodds/kody#2596](https://github.com/kentcdodds/kody/pull/2596) | executed | no | unjudged | unmeasured |
| 41 | [lidge-ai/ima2-gen#331](https://github.com/lidge-ai/ima2-gen/pull/331) | executed | no | unjudged | unmeasured |
| 42 | [kentcdodds/kody#2626](https://github.com/kentcdodds/kody/pull/2626) | executed | no | unjudged | unmeasured |
| 43 | [kentcdodds/kody#2597](https://github.com/kentcdodds/kody/pull/2597) | executed | no | requirement-met | unmeasured |
| 44 | [kentcdodds/kody#2611](https://github.com/kentcdodds/kody/pull/2611) | executed | no | unjudged | unmeasured |
| 45 | [glincker/thesvg#1147](https://github.com/glincker/thesvg/pull/1147) | executed | no | requirement-met (text inspection) | unmeasured |
| 46 | [YoungCan-Wang/WyckoffTradingAgent#496](https://github.com/YoungCan-Wang/WyckoffTradingAgent/pull/496) | executed | no | unjudged | unmeasured |
| 47 | [librespeed/speedtest#858](https://github.com/librespeed/speedtest/pull/858) | executed | yes | unjudged | unmeasured |
| 48 | [mscerts/hub#59](https://github.com/mscerts/hub/pull/59) | executed | no | unjudged | unmeasured |
| 49 | [felixrieseberg/claude-coach#15](https://github.com/felixrieseberg/claude-coach/pull/15) | executed | no | unjudged | unmeasured |
| 50 | [kentcdodds/kody#2447](https://github.com/kentcdodds/kody/pull/2447) | executed | no | requirement-met (text inspection) | unmeasured |
