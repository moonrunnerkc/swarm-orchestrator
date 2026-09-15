# Replacement natural repository pilot report

This report records the completed replacement cohort and supplementary measurements. The natural pilot was evaluated against source `87d7ef0854e22de12042d190188578f606ae9aa7`, not the later release source. The six synthetic development demonstrations remain a separate evidence set.

## Frozen identity and schedule

- Cohort: generation 2 replacement of withdrawn `pilot-run-final-9`; no original observation is carried into this denominator.
- Frozen manifest: `sha256:ea431de331175e31750d347169b2131ea350e2e8ba5f42cdf2006c50c6caedd2`.
- Protocol: `sha256:9d82eb08b3782cd0426e16178291b554ef18cd38b779d6409435de0af01b9569`.
- Schedule: 24 natural goals across eight repositories, five arms, 120 initial slots. All 120 launched and settled. There were no outer retries and no unresolved slots.
- Campaign head: `sha256:038973c31e47200158597e502a2191b9ef524cb385a9360bbbb25bf2bd315225`, sequence 481, 482 records.
- Report JSON: `/Users/brad/.swarm/redesign-evidence/2026-09-13/replacement-final-report-1/report.json`, digest `sha256:9f523cf12587bcc8ce0c89fe8017e62809fd6ef8b214e6161bd44b2bda03b6ae`.
- Capture: `completion-replacement-final-report-2`, digest `sha256:b467182d8d72bf6b89c24e29530ab5ae2978add72ad0f91eceb874cc1349abf9`.

The source, model, limits, acceptance evaluator, arm identities, reference pins, goal pins and raw artifacts were checked before execution. Each arm launched exactly once per goal. The reporter verified every settled observation and bundle. One completed single arm launch has an empty planner directory without `ledger.jsonl`; the missing ledger is retained as unknown resource evidence and does not change the settled campaign outcome.

## Pilot outcome

| Arm | Launched/settled | Complete accepted | Unknown judgments | Observed incorrect acceptance | Status completed/crashed/cancelled | Known goal input tokens | Known goal output tokens | Unknown calls | Retries | Integration repairs | Qualified execution ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| single | 24/24 | 1 | 2 | 0 | 22/2/0 | 3,284,365 (2 unknown) | 33,066 (2 unknown) | 2 | 10 | 2 | 2061832 |
| frozen-parallel | 24/24 | 0 | 18 | 0 | 6/18/0 | 10,601,591 (1 unknown) | 103,756 (1 unknown) | 1 | 0 | 0 | 2939215 |
| adaptive | 24/24 | 0 | 7 | 0 | 17/3/4 | 8,360,119 (2 unknown) | 105,168 (2 unknown) | 2 | 15 | 1 | 4251159 |
| no-adaptation | 24/24 | 0 | 7 | 0 | 17/3/4 | 7,804,555 (2 unknown) | 83,562 (2 unknown) | 2 | 10 | 0 | 3086199 |
| no-peer | 24/24 | 0 | 5 | 0 | 19/3/2 | 8,424,680 (2 unknown) | 108,450 (2 unknown) | 2 | 14 | 2 | 3946692 |

Across the cohort, 81 slots had a completed execution status, 29 crashed, and 10 ended at the declared budget boundary. One slot was accepted by the independent held-back evaluator, with zero witnessed incorrect acceptance. Thirty-nine judgments are unknown. There were 49 retries, five integration repairs, zero recorded integration failures, and nine calls with unknown provider usage. The report records 40,181,779 input and 454,632 output tokens from available per-session model records. Campaign goal accounting independently reports 38,475,310 input and 434,002 output tokens across 111 slots. These are different accounting layers and must not be added. Provider cost is unavailable; the local model used owned weights, so no metered provider charge was incurred. Electricity, hardware cost, and unlogged human time were not measured. Recorded human intervention and repair-minute counters are zero, which does not imply zero preparation or operator time.

The accepted result is isolated to the single-worker arm. The other arms have no complete accepted goal. Pairwise comparisons are failure-censored with zero unobserved pairs, but 24 failure-censored pairs for each comparison and `pilotTargetObserved: false`; no arm superiority is established. This is a complete schedule with an ineligible confirmatory analysis, not evidence of a swarm advantage.

### Paired goal decisions

The table gives the declared D6 decision for each non-single arm against the single-worker arm. Retries and five arms on one goal are correlated. Unknown judgments, infrastructure outcomes, and missing usage do not become wins.

| Goal | Groups | Frozen parallel | Adaptive | No adaptation | No peer |
| --- | --- | --- | --- | --- | --- |
| iamkun-dayjs-2948 | tiny, single-file | unknown-judgment | neither-accepted | neither-accepted | unknown-judgment |
| iamkun-dayjs-2330 | tiny, single-file | unknown-judgment | single-only-accepted | unknown-judgment | single-only-accepted |
| iamkun-dayjs-2640 | none | unknown-judgment | neither-accepted | neither-accepted | unknown-judgment |
| koajs-koa-1115 | none | unknown-judgment | unknown-judgment | neither-accepted | neither-accepted |
| koajs-koa-1828 | none | neither-accepted | neither-accepted | neither-accepted | neither-accepted |
| koajs-koa-1998 | tiny, single-file | unknown-judgment | unknown-judgment | unknown-judgment | unknown-judgment |
| tj-commander-js-1678 | coupled | neither-accepted | neither-accepted | unknown-judgment | neither-accepted |
| tj-commander-js-2006 | coupled | unknown-judgment | unknown-judgment | unknown-judgment | unknown-judgment |
| tj-commander-js-2339 | single-file | unknown-judgment | unknown-judgment | neither-accepted | neither-accepted |
| jhlywa-chess-js-554 | tiny, single-file | unknown-judgment | neither-accepted | unknown-judgment | neither-accepted |
| jhlywa-chess-js-451 | single-file | neither-accepted | neither-accepted | neither-accepted | neither-accepted |
| jhlywa-chess-js-501 | single-file | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| gvergnaud-ts-pattern-319 | none | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| gvergnaud-ts-pattern-253 | coupled | unknown-judgment | unknown-judgment | neither-accepted | neither-accepted |
| gvergnaud-ts-pattern-270 | none | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| python-attrs-attrs-4b5b295b | coupled | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| python-attrs-attrs-5aa76a44 | none | neither-accepted | unknown-judgment | unknown-judgment | neither-accepted |
| python-attrs-attrs-97f8d175 | tiny, single-file | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| pallets-click-271effb3 | tiny, single-file | unknown-judgment | neither-accepted | neither-accepted | neither-accepted |
| pallets-click-f58ca3e8 | tiny, single-file | unknown-judgment | unknown-judgment | neither-accepted | neither-accepted |
| pallets-click-a1d87858 | none | neither-accepted | unknown-judgment | neither-accepted | unknown-judgment |
| pallets-itsdangerous-9b7b635a | none | unknown-judgment | unknown-judgment | neither-accepted | unknown-judgment |
| pallets-itsdangerous-c30678d1 | tiny, single-file | unknown-judgment | neither-accepted | unknown-judgment | neither-accepted |
| pallets-itsdangerous-7f4dcf83 | tiny, single-file | neither-accepted | neither-accepted | unknown-judgment | unknown-judgment |

The D6 rubric has nine tiny goals, 12 single-file goals, and four explicitly coupled goals, with overlapping groups. The group results were: tiny, frozen parallel 1 neither and 8 unknown, adaptive 6 neither, 1 single-only accepted and 2 unknown, no adaptation 4 neither and 5 unknown, no peer 5 neither, 1 single-only accepted and 3 unknown; single-file, frozen parallel 2 neither and 10 unknown, adaptive 8 neither, 1 single-only accepted and 3 unknown, no adaptation 7 neither and 5 unknown, no peer 8 neither, 1 single-only accepted and 3 unknown; coupled, frozen parallel 1 neither and 3 unknown, adaptive 2 neither and 2 unknown, no adaptation 2 neither and 2 unknown, no peer 3 neither and 1 unknown. These exploratory results do not define a universal worker-count threshold.

## Ablations and execution conditions

The reporter audited all five role configurations and the actual worker prompts. Single and no-peer prompts contained no peer tools. Frozen parallel retained the historical layer controller. Adaptive exposed coordination and trail tools and permitted revisions. No adaptation recorded no graph revisions. No-peer removed coordination and trail tools and peer projection. Model and test concurrency declarations matched the frozen limits. The arms therefore represent distinct declared paths. The local model was `swarm-redesign-qwen36-32k:latest`, digest `1289b9ba3f4f06af094e6f09811c6c098af51dc315ebdc9dfd77582b999c89ee`, served at `http://127.0.0.1:11434/v1`, Node v24.15.0 on macOS arm64. No paid calls, model changes, mid-cohort concurrency changes, favorable stopping, or evaluator changes occurred.

Cancellations, crashes, budget exhaustion, unknown usage and missing records remain in the denominators. The elapsed values above are qualified execution times where available. The original cohort remains separately withdrawn because its source and final-verifier environment could not be faithfully resumed.

## Supplementary live contention profile

The live profile was frozen from source `ace0f359b90144029dc13eb81660f27d3980c129`, after the pilot had settled, with campaign head `sha256:038973c31e47200158597e502a2191b9ef524cb385a9360bbbb25bf2bd315225`. Its protocol digest is `sha256:02934bea907fe3da9500cb8f9690818fbdf4488b320b614b55f47e90c55932a0`. It used 24 model calls, eight test commands, eight worktree creations, and four mixed batches under concurrency order 1, 2, 2, 1. Every one of 16 batches completed all operations with no retries or failures. Total measured model and operation budget spent was 6,028 tokens, with 593,972 remaining.

| Batch | Kind | Concurrency | Operations | Duration ms | Completed |
| --- | --- | ---: | ---: | ---: | ---: |
| model-0 | model | 1 | 4 | 9,116 | 4/4 |
| model-1 | model | 2 | 4 | 3,932 | 4/4 |
| model-2 | model | 2 | 4 | 4,061 | 4/4 |
| model-3 | model | 1 | 4 | 4,803 | 4/4 |
| tests-0 | tests | 1 | 2 | 34,718 | 2/2 |
| tests-1 | tests | 2 | 2 | 22,220 | 2/2 |
| tests-2 | tests | 2 | 2 | 21,852 | 2/2 |
| tests-3 | tests | 1 | 2 | 31,496 | 2/2 |
| worktree-0 | worktree | 1 | 2 | 92 | 2/2 |
| worktree-1 | worktree | 2 | 2 | 62 | 2/2 |
| worktree-2 | worktree | 2 | 2 | 60 | 2/2 |
| worktree-3 | worktree | 1 | 2 | 90 | 2/2 |
| mixed-0 | mixed | 1 | 3 | 23,021 | 3/3 |
| mixed-1 | mixed | 2 | 3 | 21,104 | 3/3 |
| mixed-2 | mixed | 2 | 3 | 20,821 | 3/3 |
| mixed-3 | mixed | 1 | 3 | 22,999 | 3/3 |

The live profile result is recorded in `/Users/brad/.swarm/redesign-evidence/2026-09-13/profile-live-1/sessions/profile`, result digest `sha256:40389b36eb472cc7fa5a40230f89c9ec9603082b8c31a49ed087012850aaa3a9`, with capture `completion-profile-live-run-1`, digest `sha256:14f28f80c1feba83ce1b6e7b4c0b98ee1a60ce5e7d9414347d1e2783e7d9bae0`. Parent CPU excludes test children and containers. Test timing includes dependency-container startup and cleanup. Persistent local-server caches and two repetitions limit interpretation. The profile closes B2 and the live contention portion of G4 as descriptive measurements, without a universal scheduling threshold.

## Supplementary replay profile

The replay profile used source `bd6b481a65cccc2da08333a86eb27bfbede3cd31`, the same campaign head and protocol digest, seven repeated reads, and no model calls. It produced 1,430 measurements. The result JSON is `/Users/brad/.swarm/redesign-evidence/2026-09-13/profile-replay-2/result.json`, digest `sha256:554d6eeb3f9dd67aeacd1e6c09d76bb46750021d1703c2db15d6543d152f2b18`; capture `completion-profile-replay-2`, digest `sha256:d48b994b0339b91ef0330714794eb50f7b530fae4091056103d1b6cf6f4d53d7`.

| Measurement | Retained records | Timed samples | Unavailable |
| --- | ---: | ---: | ---: |
| natural-citation-index | 494 | 3458 | 0 |
| natural-controller-replay | 120 | 819 | 3 |
| natural-journal-cold-replay | 96 | 672 | 0 |
| natural-journal-polls | 96 | 672 | 0 |
| natural-journal-append-replay | 96 | 672 | 0 |
| natural-transcript-reconstruction | 288 | 2016 | 0 |
| natural-peer-projection | 120 | 840 | 0 |
| natural-gate-assembly | 120 | 840 | 0 |

Three controller replays are unavailable because their recorded graph content does not match its revision digest. Those exact errors remain in the result. Transcript reconstruction checks every retained prompt against its ledger digest. Journal cold, polling, append replay, peer projection and gate assembly measurements continue for available records. This closes the replay and retained-artifact portions of G4 while retaining malformed histories as unavailable.

## Status closure

- B2: measured and closed by the live profile. Model, test, worktree and mixed contention are separately instrumented; provider latency, test subprocesses, worktree filesystem pressure and controller accounting remain distinct.
- D6: measured and closed as exploratory crossover evidence. The paired rubric reports tiny, single-file and coupled outcomes. No universal threshold is inferred.
- G1: validated. CLI, session and parallel composition checks, packaged command checks and clean-source CI evidence are retained in the implementation record.
- G4: measured and closed for the declared journal, polling, transcript, peer, gate and live contention profiles. Three malformed controller histories are explicitly unavailable.
- V2: closed. The replacement protocol froze 24 goals across eight repositories and completed all 120 slots.
- V3: closed for the five declared internal arms. The external Loom canary remains an unavailable observation and no competitor comparison is claimed.
- V4: closed. Adaptation and peer ablations reached the execution path and were audited; natural and synthetic denominators remain separate.
- V5: closed descriptively. Wall time, completion, incorrect acceptance, usage, retries, repairs, cancellations, budget outcomes, missing records and recorded human counters are reported; provider cost and unlogged human burden remain unknown.
- V6: closed. The authorized owned local model completed the schedule without paid calls or configuration substitution.
- V7: validated. The measured replacement source and supplementary profiles pass their declared local checks. The merged release source passed Ubuntu and macOS CI, build, packaged CLI, fuzz, registry integrity and fresh registry installation checks. The exact captures and source relationship are recorded below.
- H2: conditional. No approved supported external CLI with usable local or already-authorized execution is available, and the external-driver pilot bar is not met. No driver was implemented or claimed.

## Limitations

This is an internal five-arm comparison on one natural goal per arm and one attempt per goal, with many failed or unknown outcomes. It does not establish statistical confidence, external competitor performance, universal correctness, or a general worker-selection rule. The pilot source is earlier than the release source, so release applicability depends on final source validation and is not relabeled as pilot evidence. A complete schedule can still be inconclusive.

## Integration and registry release

The completed implementation was merged through [PR #73](https://github.com/moonrunnerkc/swarm-orchestrator/pull/73)
into `v13-main` at `caf960bc787e12bbba47d4f3e9720ebd8a8d4b4d`. The exact merged tree passed the
Ubuntu, macOS and packaged jobs in PR run
[34916224868](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916224868) and
push run [34916219577](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916219577).
Merged-tree local gates, build, packaged command, fuzz and npm pack captures are retained in the
implementation record. Documentation-only evidence commits, including
`daffefb6dbbf22b54996b5dd1fac700ada2fe01d`, are on `origin/v13-main`; the pilot source remains
`87d7ef085` and is not relabeled as the release source.
The preceding documentation-only push had packaged and Ubuntu success but one macOS
adaptive-repair call-order assertion failed in run
[34918247401](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34918247401). The
final push at `12fc15eb341893534e9996b0697f2af4d4f1f052` reran the complete matrix in run
[34918984560](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34918984560),
with packaged, Ubuntu and macOS jobs all successful; no evaluated source behavior changed.

Tag `v14.1.0` points to the merged source. Release workflow
[34916998130](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916998130) published
`swarm-orchestrator@14.1.0` with provenance. Registry metadata reports gitHead
`caf960bc787e12bbba47d4f3e9720ebd8a8d4b4d`, shasum
`9dd37a74fd5cfc6c412b851b6cb03e420a63663b`, and integrity
`sha512-o7dNkJBfIlc7duMMGRGfUcKHIpE3qWI6QM3f89dhpU5clh+lUCJAgPW0LY8RSvPZ3Rqo8Ggek6OxAKAzWGtJhQ==`.
The fetched registry tarball matched that integrity, capture `completion-registry-integrity-14.1.0`,
evidence `sha256:91fb7dbdd796fbc7b68b3f4c26297b205d5a63e7226097044f28a18588aa461a`. A fresh
temporary consumer installed version 14.1.0 from the registry and exercised the installed public
CLI, capture `completion-registry-install-14.1.0`, evidence
`sha256:a5eb8c03da54a0026f781faf66553c1a9835c2eeab161f809b808a70a45ede97`.

GitHub release [v14.1.0](https://github.com/moonrunnerkc/swarm-orchestrator/releases/tag/v14.1.0)
retains this report, the evidence manifest, profiles and split campaign archive. The remote
archive parts were reassembled and matched the retained local archive byte-for-byte, verification
capture `completion-release-assets-verify-2`, evidence
`sha256:e24e0a52183429ae1ba6f2cdfdf06330c2a7268d2390bbf2b087a11904993bc8`.

H2 remains conditional. No approved supported external CLI with usable local or already-authorized
execution is available, and the adaptive pilot bar is not met. No external driver is implemented
or claimed.
