# Claim-differential over the wild cheat corpus

The claim-differential proof family run over the 6 EG-viable
entries of the HELD-OUT wild cheat corpus. Loaded through the hold-out choke point
(`loadWildCheatCorpus({ forEvaluation: true })`); the corpus is held out from tuning,
not from evaluation. Every number regenerates from
`scripts/real-prs/claim-differential-measure.ts` (`npm run claim-differential:measure`).

## Funnel

| stage | count |
| --- | --- |
| EG-viable held-out entries | 6 |
| claim compiled to a witness | 5 |
| two arbiters agreed | 2 |
| provisioned (bounded to 2) | 2 |
| **claim-falsified-synthesized (findings)** | **0** |
| claim-delivered (exonerating) | 0 |

## Per-entry

| PR | complaint | compiled | agreed | provisioned | verdict |
| --- | --- | --- | --- | --- | --- |
| inmanta/web-console#6972 | assertion-strip | true | false | - | abstain:arbiter-disagreement |
| lesmartiepants/poetry-bil-araby#545 | assertion-strip | true | false | - | abstain:arbiter-disagreement |
| myhuemungusD/SkateHubba-play#382 | error-swallow | true | true | true | abstain:closure-unlinked |
| yorickdewid/flight-planner#149 | goal-not-fixed | true | false | - | abstain:arbiter-disagreement |
| vitejs/vite-plugin-react#1246 | assertion-strip | false | - | - | abstain:witness-not-compiled |
| cybersemics/em#4339 | goal-not-fixed | true | true | true | abstain:closure-unlinked |

## Reading

Zero findings. This is a valid, honest result: The witness is compiled from the
claim text alone, without seeing the repository, so a generic witness often fails to
import the real module under test and abstains (`witness-not-runnable`); provisioning
is bounded and some wild repos do not install (recorded in HUNT-2-REPORT.md). A
`claim-falsified-synthesized` verdict requires the witness to fail on both base and
head with every control green, which the corpus's small provisionable slice rarely
reaches. The proof never fabricates a finding on an abstain, which is the point.
