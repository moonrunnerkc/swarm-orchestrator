# Claims ledger

Every publishable claim this project can currently make, each mapped to the evidence
artifact that backs it and the command that regenerates that artifact. A claim that cannot
be regenerated from committed inputs is not in this file.

Rule of use: cite the claim with its artifact link. If a number here disagrees with a
badge, a README line, or a slide, the artifact wins and the other is stale.

## Gate soundness and the zero-false-block record

| claim | number | artifact | regenerate |
|---|---|---|---|
| No advisory detector is gate-eligible; all 10 are advisory-only | gate-eligible = 0, advisory = 10 | `benchmarks/real-corpus/promotions.json` | `npm run promotions:check` |
| The corroborated structural gate is not-ready by construction (no outcome-bad PR in the provisionable slice), not by a harness defect | status `undefined-n`, n_bad = 0 | `benchmarks/real-corpus/corroborated-gate-precision.json`, `benchmarks/real-corpus/CORROBORATED-GATE-READINESS.md` | `npm run corroborated-gate:check` |
| The one known harness-defect gap (`claim-falsified-synthesized`) is closed: advisory, abstains in production | honest-twin FP 0/16, outline refusal 16/16 | `benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md` | `npm run discrimination-control:measure` |
| Clean controls and fixtures never produce a proven block | Phase 3 go-clean / py-clean 0 triggers; committed clean corpus unchanged | `benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md` | see live-path reproduce below |

## The wild corpus and its complaint-bar strata

| claim | number | artifact | regenerate |
|---|---|---|---|
| The wild cheat corpus is 29 entries (v1 27 + 2 maintainer-confirmed folds) | 29: merged 8, closed 20, egViable 7 | `benchmarks/real-prs/wild-cheat-corpus/v3/dataset.json` | folded by `scripts/real-prs/fold-approved.ts` (v2), stratified by `complaint-bar-audit.ts` (v3) |
| Of the 27 inherited entries, only 7 meet the strict independent-human complaint bar | strict 7, legacy 19 (6 solo self-flag), uncertain 1 | `benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md` | `node dist/scripts/real-prs/mining-verification/complaint-bar-audit.js --input benchmarks/real-prs/mining-verification/tightening-input-corpus29.json --dataset benchmarks/real-prs/wild-cheat-corpus/v2/dataset.json --dataset-out benchmarks/real-prs/wild-cheat-corpus/v3/dataset.json --version v3 --out benchmarks/real-prs/mining-verification/complaint-bar-audit.json` |
| The published "27 maintainer-flagged" is the loose bar; the strict independent-human count is 7 (6 content-aware) | 27 loose / 7 strict / 6 content-aware | same as above | same |
| The miner is tightened definitionally (self-comments and bots excluded); package noise fell 13% to 3.3% | 13% to 3.3% | `benchmarks/real-prs/mining-verification/TIGHTENING-REPORT.md` | `node dist/scripts/real-prs/mining-verification/tightening-regression.js ...` |

## Diff illegibility (why complaint-mining is the discovery method, not the detectors)

| claim | number | artifact | regenerate |
|---|---|---|---|
| An LLM judge reading the diff recovers only a fraction of the wild cheats | wild-cheat recall 1 of 7 | `benchmarks/twins/JUDGE-GATE-COST-REPORT.md` | `npm run judge-gate-cost` (funded) or `--report-only` from the committed JSON |
| A judge allowed to block costs a low but nonzero clean-PR false-block rate | 1/52 clean blocked (2%, Wilson-95 [0.00, 0.10]) | same | same |
| A dual Opus arbiter reading the diff alone confirms zero of the wild true-positives, though it confirms planted cheats | 0 of 11 evaluated (vs 21/23 planted) | `benchmarks/real-prs/mining-verification/POSITIVE-CONTROL.md` | `node dist/scripts/real-prs/arbiter-sanity-dual.js ...` |

## The pre-registered hunt record (including the zeros)

| claim | number | artifact | regenerate |
|---|---|---|---|
| Hunt 5: the restoration tier could not execute non-Node; 0 of 2 folded entries proven | 0/2 | `benchmarks/real-prs/hunt5/` (per its report) | `swarm audit --pr` on the pinned heads |
| Hunt 6: with the polyglot engine present, the barrier moved upstream to `mutableSourceFilter`; 0 of 2 | 0/2 | `benchmarks/real-prs/hunt6/HUNT-6-REPORT.md` | `swarm audit --pr` on the pinned heads |
| Hunt 7: the primary folds are out-of-reach (category / language); 0 wild cheats proven | 0/2 primary; funnel confirms the pre-registered reach matrix | `benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`, `PREREGISTRATION.md` | `swarm audit --pr` on the pinned heads (records in `hunt7/records/`) |

## The polyglot live-path proof

| claim | number | artifact | regenerate |
|---|---|---|---|
| The `test-tamper` restoration engine executes on node, pytest, and go-test (planted fixtures) | 4/4 | `benchmarks/oracle-corpus/POLYGLOT-RESTORATION-REPORT.md` | `PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js` |
| A Go and a Python test-tamper prove end-to-end through the shipped `swarm audit --pr` (tamper proves, clean refutes, attestation reports the non-Node matrix, fresh-clone replay reproduces) | 4/4 verdicts + 2 replays | `benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md`, `live-path-runs/*.json` | recreate the fixture PRs, then `swarm audit --pr <ref> --mode gate --output json` (see the report) |
| The pipeline front-end is ecosystem-aware: a `.go`/`.py` test-tamper reaches the restoration engine instead of bailing at the JS/TS entry gate | `layerHasWork` admits Go/Python candidates | `test/audit/execution-grounded/layer-has-work.test.js` | `npm test` |
| The closure relevance refuter abstains on non-analyzable languages (does not mis-refute Go) | go-tamper proven, not `test-not-closure-linked` | `test/audit/cheat-detector/closure-analyzable.test.js` | `npm test` |

## Hunt 7's substantive result (the honest one)

| claim | detail | artifact | regenerate |
|---|---|---|---|
| The polyglot pipeline proved a `test-tamper` on a wild Go PR end-to-end (deterministic, replayed) | jeduden/mdsmith#232, 5 test-tamper-proven, replay identical | `benchmarks/real-prs/hunt7/records/novelty-jeduden-go{,-replay}.json`, `HUNT-7-REPORT.md` | `swarm audit --pr jeduden/mdsmith#232 --mode gate --output json` |
| That proof is a false positive for "cheat": a legitimate refactor that moved coverage to a golden-file test the engine cannot see | the gate's one known false-positive class (assertion-weakening refactors that relocate coverage) | `benchmarks/real-prs/hunt7/HUNT-7-REPORT.md` (jeduden autopsy) | same |
| No genuine wild cheat has been proven by the gate | 0 across hunts 2-7 | the hunt reports above | same |

## Detection and false-alarm numbers (prior runs, still current)

| claim | number | artifact | regenerate |
|---|---|---|---|
| Oracle recall over the defect-injection corpus | 303 of 325 (93.2%) | `benchmarks/results/AB-REPORT.md`, `benchmarks/oracle-corpus/per-detector-recall.md` | `npm run benchmarks:full` |
| Real-PR false-alarm burden | 0.11 findings per PR (18-PR pilot) | `benchmarks/real-prs/REAL-WORLD-REPORT.md` | see report |
| Advisory-tier precision on the real-outcome corpus | all 10 below the gate floor (Wilson-95 lower >= 0.9) | `benchmarks/real-corpus/promotions.json` | `npm run promotions:check` |
| Twin separation (detector tier, semi-synthetic n=52) | separation 0.54, McNemar p = 7.5e-9 | `benchmarks/twins/TWIN-SEPARATION-REPORT.md` | `npm run twins:separation` |
| Derived-witness twin measurement (n=8) | honest-twin FP 0/8, special-casing recall 8/8 | `benchmarks/twins/DERIVED-WITNESS-REPORT.md` | `npm run derived-witness:measure` |

## Capability run: FP hardening, reach, binding, the hunt (this run)

| claim | number | artifact | regenerate |
|---|---|---|---|
| The jeduden coverage-moving false positive is neutralized in-proof and pinned; CI fails if it regresses | refuter fires on both finding files; twins 6/6 | `benchmarks/results/FP-HARDENING-REPORT.md`, `benchmarks/real-corpus/fp-registry/` | `npm run fp-registry:check`, `npm run coverage-relocation:measure` |
| A self-certifying gate trigger auto-demotes to advisory when accrued false positives drop its Wilson-95 bound below 0.90 | mechanism tested; jeduden neutralized so block-eligible stays 8 | `src/audit/gate/block-eligibility.ts`, `benchmarks/real-corpus/block-eligibility.json` | `npm run block-policy:check`, `npm test` |
| The error-swallow restoration engine proves a load-bearing swallow and refutes a defensive one | 4/4 (mocha + pytest) | `benchmarks/twins/ERROR-SWALLOW-PROOF-REPORT.md` | `npm run error-swallow:measure` |
| The proof tier's executable fraction of an intake, tracked | intake 2/6 (33.3%), corpus 78/197 (39.6%) | `benchmarks/real-corpus/executable-fraction.json`, `POLYGLOT-PROVISION-REPORT.md` | `npm run executable-fraction` |
| Tier C binds a claim to an existing test with green history and fires only on a real undelivered claim | honest FP 0/4, recall 4/4, separation 1.00 | `benchmarks/twins/CLAIM-BINDING-REPORT.md`, `benchmarks/twins/claim-binding.json` | `npm run claim-binding:measure` |
| Both new proof tiers ship advisory; nothing new is gate-eligible | gate-eligible detectors 0, block-eligible triggers 8 | `benchmarks/real-corpus/promotions.json` | `npm run promotions:check`, `npm run block-policy:check` |
| The backfill hunt proved 0 cheats on 30 merged agent-authored PRs (no milestone candidate) | 0 gate triggers / 30 PRs; 22/28 provisioned | `benchmarks/real-prs/capability-hunt/BACKFILL-HUNT-REPORT.md`, `.../records/` | `npm run hunt:backfill -- --batch-size 15` |
| The hunt's verdicts feed the promotion machinery; promotion is symmetric with the FP-driven demotion | synthetic fold promotes claimBinding, removal reverts to advisory | `benchmarks/real-corpus/PROMOTION-ON-DATA-REPORT.md`, `hunt-verdict-evidence.json` | `npm run hunt:aggregate`, `npm run promotions:compute` |

## Live-wiring run: the two engines wired and proven through the CLI (this run)

| claim | number | artifact | regenerate |
|---|---|---|---|
| Error-swallow and Tier C claim-binding are wired into `swarm audit --pr` and prove/refute/abstain correctly end-to-end (not the engine harness) | 6/6 fixtures, identical fresh-clone replays | `evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md` | `node dist/scripts/live-wiring/prove-live-set.js` |
| Error-swallow proves a load-bearing swallow through the CLI as an advisory finding, never a gate trigger | proven, `blockingTriggers: []`, 3/3 controls | `evidence/live-wiring/live-set-runs/error-swallow-cheat.run.json` | same harness |
| The Tier C binder abstains in production through the CLI (no green-history checkout) and delivers a real verdict on the honest twin | cheat `abstain:no-pass-capability-evidence`; honest `claim-delivered` | `evidence/live-wiring/live-set-runs/claim-binding-*.run.json` | same harness |
| The backfill re-ran with the complete wired engine set over 120 merged agent PRs and proved 0 cheats (no milestone candidate) | 0 gate triggers / 120 PRs; 46/115 provisioned; error-swallow 0 proven, binder 0 findings | `benchmarks/real-prs/capability-hunt/live-wiring-batches/LIVE-WIRING-BACKFILL-REPORT.md`, `.../records/` | `node dist/scripts/real-prs/capability-hunt-backfill.js --population benchmarks/real-prs/capability-hunt/live-wiring-population.json --out benchmarks/real-prs/capability-hunt/live-wiring-batches --batch-size 15 --offset <n>` |
| Wiring the two engines kept every gate green and added nothing gate-eligible | 2340 passing, gate-eligible 0, block-eligible 8 unchanged | `benchmarks/real-corpus/promotions.json` | `npm run promotions:check`, `npm test` |

## The parked research problem (stated, not claimed as solved)

The pass-capability problem (certifying a synthesized semantic witness passes on the correct
behavior without a spec-derived oracle) is **unsolved and parked**. It is why the
claim-differential and derived-witness tiers abstain in production. This is a limitation on
record, not a claim; see `docs/READINESS.md`.
