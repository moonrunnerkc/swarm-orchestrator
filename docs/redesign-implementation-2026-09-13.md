# Adaptive goal controller implementation, September 13, 2026

Status: implementation and evidence are integrated into the verified `origin/v13-main` branch.
Complete-goal behavior is established by development and integration evidence; no performance
advantage or universal correctness is claimed. September 15 completion: replacement cohort 2
completed all 120 scheduled slots from `87d7ef085`; the original cohort is withdrawn and
preserved. The merged release source, supported-platform checks, package publication and registry
installation are verified below.
This record tracks the entire approved redesign, including empirical work that code alone
cannot complete. The September 11 audit record remains historical evidence.

## Baseline and authorization

Source: `a950d1bd51474ec24ec647c3fd9ed3c003dc93b8`, initially clean `v13-main`, origin
`https://github.com/moonrunnerkc/swarm-orchestrator`. Implementation branch:
`redesign/adaptive-goal-controller`. Node v24.15.0, npm 11.12.1, macOS. `v12-final` is present.
The initial September 13 scope did not authorize historical resets, unrelated edits, paid calls,
pushes or publication. The September 14 completion instruction explicitly authorizes the finite
evaluation, normal pushes and integration into `v13-main`, and the validated npm release. Actual
access controls remain binding. A subsequent September 14 instruction permits the existing
administrator exemption for normal pushes and merges; force pushes remain unauthorized.
The complete user-supplied September 13 appendix is the controlling specification.

All root instruction variants were inspected (case aliases on this filesystem); no ancestor
or nested instruction file was found. Full build guide, ADRs 0001 through 0008, README, usage,
CLI reference, audit record and required CI workflows were read before structural edits.
[ADR 0009](adr/0009-adaptive-goal-controller.md) records the exact approved policy revisions.
Both instruction files remain synchronized by `scripts/check-invariant-drift.mjs`.

Local command captures and append-only, hash-chained implementation records live outside the
workspace at `/Users/brad/.swarm/redesign-evidence/2026-09-13/`. Scope declarations precede
edits in its `implementation/ledger.jsonl`. These machine-specific paths are not published
results. Final evidence must name the tested commit and retained command bytes.

## Requirement and evidence map

Each row remains open until its runtime consumer and meaningful validation are established.
A runner alone does not complete an empirical requirement.

| ID | Binding requirement | Implementation and validation | Status |
| --- | --- | --- | --- |
| M0.1 | Current source, clean branch, history, commands and instruction reconciliation | Baseline above; historical tag present | observed |
| M0.2 | Unavailable network enumeration reports unknown, required policy decides | Two regressions failed before the fix; all 16 focused tests pass afterward | validated |
| M0.3 | Full gates, corpus prerequisite, existing attacks and compatibility baseline | Baseline: 282 files, 2846 tests passed. M0: 283 files, 2850 tests passed; full gates exit 0 | validated |
| A1 | Effective objective, dependencies, authorized/immutable paths, tools, checks, execution and budget | graph and legacy workspace contracts reach tools, execution admission, budget and assessment; public dispatch tests | validated |
| A2 | Worker declarations cannot enlarge controller scope; normalized paths | normalized exact graph scope, denied amendment and shell post-check regressions | validated |
| A3 | Required checks run and affect acceptance; unsupported restrictions refuse dispatch | required advisory and undefined checks plus unsupported host network tests | validated |
| B1 | Run context before planning; all activities share cancellation and budget | context precedes CLI planning and wraps provider calls, tests and final verification; original deadline and budget resume tests | validated |
| B2 | Separate worktree, model-call and test-process limits | separate worktree cap and FIFO model/test permits, cancellation tests; live model, test, worktree and mixed contention profile recorded below | validated |
| B3 | In-flight input/output reservation, measured settlement, failed and unknown usage | reservation races, settlement, failed/unknown usage and original deadline restart tests | validated |
| B4 | Stop dispatch, separately bounded cleanup, durable parallel lifecycle | durable planning/dispatch/integration lifecycle and separate cleanup deadline; recovery and CLI abort tests | validated |
| C1 | Failed integrated checks, conflicts and relevant ratchet failures start bounded repair | three real-worktree synthetic repair cases pass through the public runner | validated |
| C2 | Retain rejected attempts and reachable commits; reuse failure context | rejected Git refs retained; accepted peer executes once in repair tests | validated |
| C3 | Revalidate repair and combined tree, one final task outcome | repair and integration checks followed by exact-tree independent goal checks; final outcome tests | validated |
| C4 | Repeated failure fingerprints and limits, exact blocker and partial work | repeated patch/base/reason fingerprint and attempt cap; blocker test passes | validated |
| D1 | Readiness scheduling, one integration writer, actual integration base | real Git readiness fixture starts a dependent while an unrelated provider remains active; one integration writer | validated |
| D2 | Versioned bounded revisions: prerequisite, split, combine, reroute | Bounded prerequisite, split, combine, reroute and scope-allocation revisions; deterministic invalidation tests and the caa20 public dependency repeat | validated |
| D3 | Preserve requirements/history, invalidate affected acceptance | original obligation membership survives split/combine; downstream acceptance invalidated and independently re-derived | validated |
| D4 | Base/revision identity and stale candidate refusal | late candidate after dependency revision is retained, refused and repaired from current integration base | validated |
| D5 | Typed bounded proposals, relevant deltas, provenance, independent alternatives | bounded typed proposals and tool provenance; same-task alternatives receive no peer tools; exported reader tests | validated |
| D6 | Prefer one worker for tiny/coupled work | Planner guidance and collapse are implemented. Exploratory crossover conditions are measured in the replacement pilot report; no universal threshold is claimed. | validated |
| E1 | Independent final acceptance at exact integrated tree | fresh independent checkout with exact Git tree check; locally green omission refused | validated |
| E2 | One authoritative CLI/exit/TUI/export assessment, distinct trust dimensions | One controller projection drives plain, Ink, JSON, CLI exit and bundle outcome; stale/cancelled assessments and recovery fixtures pass | validated |
| E3 | User checks and recorded candidate checks protected from worker writes | User and planner-authored artifacts are pinned outside producer writes; authorship, whole-checkout restoration and bootstrap regressions pass | validated |
| E4 | Preserve strict reference/control package and human judgment gaps | strict reference/control path and existing corpus remain green; uncovered requirements unjudged | validated |
| E5 | Explicit empty-repository bootstrap before acceptance pinning and implementation | Explicit Node 24 bootstrap pins its harness before planning; positive/negative controls, both Git object formats and public restart fixtures pass | validated |
| E6 | All obligations eligible before goal ranking, declared objective; legacy comparator retained | complete-goal alternatives checked independently before objective ranking; omission with twelve extra tests is ineligible; legacy comparator retained | validated |
| F1 | Journal replay and reconciliation of attempts, usage, candidates, trees, integration, resources | validated controller replay, resource and Git reconciliation; injected boundaries plus real SIGKILL after recorded landing | validated |
| F2 | Original remaining budget/policy, no duplicate landing or ambiguous replay | original pinned launch/configuration, retained unknown usage and token ceiling; accepted producer not called on resume | validated |
| F3 | Intent before effect, completion after; preserve torn/altered history | intent/completion windows distinguished; checksum/torn history and missing candidate evidence refuse reconciliation | validated |
| F4 | Verify ownership before cleanup, retain user and other-session resources | writer lease and container labels checked; dirty worktrees, changed refs, live/unknown owners and other resources preserved | validated |
| G1 | Extract CLI/session/parallel composition and common settings/outcome | focused handlers and shared settings, ledger-derived output; audited composition checks and clean-source Ubuntu/macOS/package CI below | validated |
| G2 | Shared immutable verification setup, independent trust and known-answer tests | Controller verification shares immutable setup; fresh checkouts and independent hash/signature/verdict known-answer tests remain separate | validated |
| G3 | Harness routine claims, smaller optional vocabulary; compare before default change | Harness receipts and optional small claim vocabulary; six exposed prompt-comparison launches were inconclusive, so the default remains unchanged | validated |
| G4 | Profile journal, polling, transcripts, peers, checks and contention first | Fixed and live profiles cover journal, polling, transcript, peer, gate and contention paths; malformed histories remain explicitly unavailable | validated |
| G5 | Warranted incremental processing, exact reconstruction, cross-process visibility | Measured incremental journal parsing retains full-byte hashing and cross-process visibility; corruption and exact transcript tests pass | validated |
| G6 | Immutable check reuse, observations rerun after relevant changes; unknown disables cache | Immutable gate definitions reused; all final observations rerun. Fixed-fixture transcript/peer/check timings did not justify observation caches | validated |
| G7 | Final blocking checks mandatory, remove duplicate workflow calls, explicit corpus setup | gates workflow retains Linux/macOS and fuzz, packaged job; duplicate invocations removed and v12-final prerequisite checked in M0 | validated |
| G8 | Consolidate policy and archive narrative losslessly, meaningful weight gate | Canonical generated policy, lossless historical archive and 18 transcript offloads; byte restoration, drift and cited-bundle gates pass | validated |
| G9 | Goal/blocker/resource/acceptance/branch output, detailed features accessible | Goal, blockers, resources, acceptance and branch views share a projection; all 19 legacy commands passed the packaged composition check | validated |
| G10 | Learned routing stays experimental pending matching evaluation | Learned routing remains opt-in and experimental; no pilot claim or default promotion | validated |
| H1 | External transcript/patch import and honest unavailable provenance | existing importer, historical bundle, signer and tamper fixtures remain in full gates through goal-selection milestone | validated |
| H2 | Concrete external CLI driver only after pilot bar and supported CLI availability | conditional prerequisites, no driver claim before both hold | conditional |
| V1 | Six development goal classes, valid fixes and omissions | Six frozen synthetic development goals accepted with offline-verifying bundles; one exposed repeat also exercised a valid dependency revision | validated |
| V2 | Freeze 24 goals, at least eight repositories, JS/TS and Python, multiple categories | Replacement cohort 2 completed 120 independent slots on `87d7ef085`; original observations remain withdrawn and separate. | validated |
| V3 | Single with repair, frozen old parallel, adaptive, feasible competitor | Five internal arms completed their 24 paired slots. The local Loom canary remains unavailable; no external comparison is claimed. | validated |
| V4 | Adaptation and peer ablations, repeats correlated, natural/synthetic distinct | Adaptation and peer-information paths were audited in all five arms; synthetic development cases and withdrawn observations remain separate. | validated |
| V5 | Wall/tokens/cost/completion/incorrect acceptance/human burden/retries/recovery | Final report records wall time, acceptance, incorrect acceptance, usage layers, retries, repairs, cancellations, budgets, missing ledgers and recorded human counters; provider cost and unlogged burden remain unknown. | validated |
| V6 | Available authorized local models, no new paid commitment | Owned local Qwen weights executed all five arms and the six separate development cases. No paid calls or model substitutions occurred. | validated |
| V7 | Full gates, build, packaged CLI, fuzz, evidence and supported platforms | Replacement and supplementary local evidence plus merged-source Ubuntu/macOS CI, build, package, fuzz, registry integrity and fresh installation checks are retained below. | validated |
| R1 | README, usage, CLI, build guide, ADRs, instructions, changelog, examples | README, usage, CLI, build guide, ADR 0009, synchronized instructions, changelog and implementation examples describe complete-goal and adaptive recovery behavior. | validated |
| R2 | Tested coherent commits, installable release candidate, exact push/CI/release status | Small validated commits are integrated into `origin/v13-main`; version 14.1.0 is published and independently installed from the registry. | validated |
| R3 | Final audit against entire appendix, explicit remaining blockers | Final audit preserves the pilot, supplementary profiles, CI, integration, package and registry evidence; H2 remains conditional for its stated unmet prerequisites. | validated |

## Source findings verified

At the baseline, `contractsFromGraph` records `network: denied` and empty required checks;
`runOneWorker` receives no contract and constructs its own file registry. `TaskNode.acceptance`
is not consumed by worker acceptance. `runMergeQueue` records rejection but no caller starts
repair. `runInParallel` waits on entire scheduled layers and sweeps worker branches afterward.
`networkInterfaces()` is outside the controlled network probe's exception handling.

## M0 command evidence

`baseline-final` ran pristine `a950d1bd5`: full gates exit 0, 282 files and 2846 tests
passed, 97.82 seconds. M0 full gates also exit 0: 283 files and 2850 tests passed,
83.72 seconds. Both include 22 Biome warnings and one informational diagnostic; neither
suite reports skipped tests on this Mac. These concurrent runs are not performance comparisons.
The network exception was reproduced by injected interface-enumeration failure, then fixed;
unknown reachability now remains unknown in the execution envelope and approval policy.

Full logs: `baseline-final.log`, `network-regression-before.log`,
`network-regression-after.log`, and `m0-gates.log` under the external capture directory.
The command captures bind source commit and working diff; final release validation will bind
a committed tree. The initial capture helper lost one completion to the ledger's stale-writer
refusal during overlapping captures. Its history was preserved; separate command sessions now
avoid shared writers. The authoritative baseline is the later `baseline-final` exit record,
not an invented combination of incomplete launches.

## Enforced contracts

The shared contract schema now lives in `src/evidence/task-contract.ts`; the old worker import
continues to export its API. Version-one contracts remain readable. Version two records token
allocation and required execution mode. The worker receives that contract, restricts declaration
and amendment, offers its permitted tools, caps its own budget, admits the observed execution
policy, and checks every required gate in the final assessment. Unsupported or undefined
requirements cannot silently disappear. Graph acceptance ids now feed required checks.

`src/workers/contract-enforcement.test.ts` exercises the real dispatch path, including shell
effects caught by the final file-set gate, denied scope amendments, required advisory failure,
undefined checks, unsupported host network requirements and tool availability. A legitimate
refused outcome exports and verifies; a newly signed forged assessment that drops its required
check is refused. The host path remains lexical policy plus post-execution checking, not
containment. The existing graph fixture needed the repository's deadline-aware test clock once
contracts actually enforced deadlines; its original assertions remain intact.

Full `m1-gates-formatted` command: exit 0, 285 files and 2866 tests passed, 71.15 seconds.
Biome retains the baseline 22 warnings and one info diagnostic. The first full attempt stopped
on formatting in the modified independent verifier; its log remains beside the corrected run.
CLI lifecycle extraction, shared accounting and ordinary goal acceptance are implemented in the next milestone below. Durable scheduling recovery remains open.


## First complete repair loop

The controller now keeps rejected candidates reachable, dispatches a bounded repair against the
current integration commit, includes the prior patch and failure observation, reruns worker and
integration gates, and derives one final outcome per task. Historical failures remain on the
chain. `src/workers/adaptive-repair.test.ts` exercises missing prerequisites, a clean textual merge
that fails behaviorally, a textual conflict, omission despite locally green workers, successful
final acceptance and a forged exported obligation. These are synthetic development fixtures,
not natural tasks or evidence of a swarm advantage.

`src/workers/run-context.ts` owns model reservations, measured settlement, unknown usage,
original deadline and separate model/test permits. Planning and workers share it. Failed or
interrupted provider calls retain their reservation and refuse automatic restart until usage is
reconciled. The input allowance is a conservative UTF-8 byte and framing estimate, not a billing
guarantee. Provider cancellation does not guarantee zero monetary overrun. Durable dispatch and
integration reconciliation are still M3 work.

Ordinary goal contracts pin observable requirements, executable check bytes, authorship and
exposure. The existing independent verifier runs them in a fresh checkout matching the final
Git tree. Uncovered requirements remain unjudged. Model-authored checks remain candidate
instruments, not independent ground truth. The strict reference/control policy remains separate.
The embedded verifier re-derives the ordinary goal and controller assessments. Version-three
task contracts preserve the legacy flat-task workspace authorization explicitly; graph tasks
remain restricted to controller-named files. Immutable goal artifacts cannot enter worker patches.

`src/cli-parallel.ts` now owns parallel composition, and `src/cli-run-settings.ts` centralizes
settings resolution. Planning precedes implementation inside the shared context. New parallel
options are `--goal-checks`, `--max-tokens`, `--repair-attempts`, `--model-concurrency` and
`--test-concurrency`. Default worker prompt bytes are unchanged: 6505 characters, SHA-256
`381b33f6ddcf544a1aa5bb2697b8bf78faefc864b1dcb274bd750467adedf453` on both the frozen baseline
and current code (`m2-prompt-preservation.log`). This is preservation evidence, not a token or
performance improvement. `m2-focused.log` records 26 files and 289 passing tests. Later full
milestone validation must cover changes after that capture.


Full `m2-gates`: exit 0, 290 test files and 2890 tests passed, 89.00 seconds. Biome checked
597 files and retained 22 baseline warnings and one info diagnostic. No skipped tests were
reported. The AI SDK seed warning is the existing unsupported-feature fixture. This validates
the first complete repair loop, not M3 scheduler recovery or the held-out pilot.


### M3 scheduling and revision integration, September 13

The controller now dispatches ready tasks as their own prerequisites land, with one integration writer. Real Git fixtures exercise a dependent starting while an unrelated provider request remains active, a typed dependency request invalidating its stale candidate, a replacement attempt on the accepted prerequisite, and a coupled-task collapse producing one accepted worker for two preserved original obligations. A split cannot erase the final goal checks. Controller outcome v2 reads the current revision and every member responsible for each original obligation. The legacy graph outcome remains an account of the original node executions.

Dispatch intent, candidate snapshots, integration intent/completion, and worktree cleanup intent/completion are journal records. Transitions are checked before effects, and replay refuses duplicate dispatches, stale integration, missing merge observations, and model-authored authority. An independent dependency-free controller reader is embedded in the standalone bundle verifier. Full process reconciliation and the durable CLI resume path remain unfinished in M3; these event records alone do not establish resumable swarm execution.

The repeated-failure fingerprint now uses `failureDigest`. The earlier field name `failureKey` was correctly scrubbed by credential-name detection and could not support replay comparisons. Historical records remain readable, the scrubber is unchanged, and new recorded digests are exercised by the repair regression. Reading captured merge feedback now uses the ledger's `detail` field. Comparing the retained patch stops an unchanged failed repair before another provider launch. No performance claim is made from that regression.

The earlier M3 readiness check exposed three behavior/expectation issues and was recorded as failed in `m3-readiness-journal`. Subsequent focused checks found a non-serializable coordination tool schema, which was corrected and given a transport-schema regression. The first full gate run then exposed two packaging defects in the standalone verifier assembly and asset catalogue. After fixing them, `m3-scheduling-gates-corrected` exited 0: 294 test files and 2918 tests passed in 95.49 seconds, with no skips. Biome retained the baseline 22 warnings and one informational diagnostic. The tested diff was committed as `080aec872d39279f81987754fde28b8d3c5c29a2`. Evidence digest: `sha256:1f4bfadaff292c03b725033cbf97f8062a202a3977a75697127a4d1bfd45b7c6`.


### M3 recovery integration, September 13

Controller launch inputs now precede planning and pin the base commit, goal/check bytes, model endpoint, resource limits, budget, and container image content identity. `list-runs`, `inspect`, `abort`, `repair`, and `resume` distinguish controller sessions from the existing single-task path. Administrative token state projects controller reservations and reported settlement. Unknown usage retains its allowance and refuses new dispatch. Resume neither changes the original deadline nor increases the token ceiling.

The recovery path checks writer ownership, validates the ledger and candidate chain heads, reconciles dispatches and integration effects, and retains interrupted work as an unaccepted candidate for bounded revalidation. A captured accepted landing is reused once. A merge commit without an acceptance observation is retained under an owned recovery ref before returning to the recorded base and rerunning checks. Dirty or moved worktrees, missing histories, live or unobservable process owners, and ambiguous tool effects require explicit reconciliation. No user process is killed by PID inference. Runtime cleanup checks session labels and includes creation intent; cleanup has a separate 60-second cooperative deadline. Worktree removal refuses uncommitted files.

New focused coverage includes injected crashes around creation, dispatch, candidate recording, landing and cleanup; a real child process killed immediately after journaling an accepted landing; CLI planning cancellation and durable accounting; missing and torn history; preservation of unrelated integration edits; original budgets; and competing owner refusal. The first real process-death fixture failed before its intended crash boundary because it serialized a test-transformed function. Replacing that fixture transport with explicit child code reached the SIGKILL boundary and passed recovery. That earlier failure is not counted as a successful crash test.

The first full recovery gate run, `m3-recovery-gates`, exited 1: 299 files and 2943 tests passed, and one compatibility assertion still expected the old record-kind catalogue. It was updated to include the new pinned controller-configuration record while retaining every legacy record assertion. The corrected full run, `m3-recovery-gates-corrected`, exited 0: 300 files and 2944 tests passed in 104.14 seconds, with no skips and the unchanged 22 Biome warnings and one informational diagnostic. Its evidence digest is `sha256:a6c1ebf0c218fc3bec38b1817f9bc383292c263200af5a9ab8e321724859a4e5`. The tested diff was committed as `0c5305eb9749881794cd9a04f22a1c8bae9fc040`. This source work does not establish M4 performance improvements, completion of bootstrap and goal-oriented candidate selection, or the paired pilot.


### Complete-goal alternatives

With an ordinary goal contract, redundancy now means independent attempts at the complete goal. The controller records a combine revision before dispatch, retaining every original obligation and required check. The cooperative default remains one attempt per task. Complete-goal alternatives receive no peer tools. Every locally green alternative is independently checked against all pinned requirements before ranking. The declared objective is stable attempt order, change size, or reported model tokens; token counts are not monetary cost. Missing provider usage remains unknown. The historical discipline comparator remains unchanged for runs without a goal contract.

A real-worktree regression creates a locally green alternative with twelve unrelated tests and a missing required behavior. It is ineligible even though its test count is larger. When both alternatives omit the behavior, one bounded repair receives the acceptance failures and establishes both requirements. The final integrated verifier still runs. An independent bundle reader checks candidate identity, captured acceptance, usage, eligibility and the declared ordering. Known-answer tests forge omissions, usage, bases, citations and winners. These are synthetic behavioral checks, not evidence of a model or swarm advantage.

Ordinary acceptance now handles an empty patch and records a check that deletes its own pinned artifact as rejected instead of throwing an incidental missing-file exception. Both regressions failed before the fix. Required advisory integration failures already triggered the existing numeric ratchet; the added repair regression confirms that preservation rather than claiming a missing enforcement path. The first full gate run, `goal-selection-gates`, retained 302 passing files and 2962 passing tests, with one failing malformed-patch compatibility test. Git's unconditional `--allow-empty` also accepted arbitrary non-patch text. The flag is now used only when the submitted patch contains no non-whitespace content; malformed imports still refuse. Corrected `goal-selection-gates-corrected` exited 0: 303 files and 2963 tests passed in 105.55 seconds, no skips, with the unchanged baseline Biome diagnostics. Evidence digest: `sha256:e8970434d15d67d3aadad684e488e00ada83bc50e21676554b14f247862beee9`. The tested diff is commit `27ddb08b401e501441a26d7a9486652775e97e67`.

### Missing prerequisites and explicit scope allocation

Graph version two pins the controller's user-authorized scope separately from each worker contract. New ordinary CLI goals permit controller allocation within the workspace; a supplied task graph keeps its declared file ceiling. Programmatic callers must explicitly supply a controller scope. Version-one launch/configuration/graph histories remain readable and acquire no amendment authority on resume. Required acceptance artifacts and immutable paths remain protected, and every existing lexical guard and execution admission still applies. This is permission allocation, not containment or a semantic proof that a proposed file is relevant to the goal.

A missing-prerequisite proposal can name a bounded instruction and file list. The controller preflights a scope amendment, when needed, and insertion as separate append-only revisions before dispatch. The new task inherits the requesting task's obligations, checks, tools, execution policy and per-attempt limits. The original consumer becomes stale and must run again against the accepted prerequisite. Human-only scope authority cannot be delegated by a replacement task. Unknown references, cycles, immutable paths, out-of-ceiling files and budget increases remain refused. The independent bundle reader re-derives both operations. Focused integration validation includes refusal outside the pinned file ceiling and version-two resume. `graph-discovery-gates` exited 0: 304 files and 2970 tests passed in 109.15 seconds, no skips and unchanged baseline Biome diagnostics. Evidence digest: `sha256:69669ef164e3b6a97dc8049c51d8f1834ebd22e2a094cf1e920f85e0e5041eb0`. The tested diff is commit `47c17c867e77479e039d993bb57ace600f9dbe27`.

### Final acceptance drives repair

A rejected executable goal check can now create a bounded diagnostic/repair job against the already integrated commit. The controller preserves original obligations in a combine or reroute revision, retains failed acceptance observations and reruns the fresh verifier after repair. It does not relaunch the accepted producers. Unjudged requirements are not turned into passes, and unchanged failure trees, revision limits, attempt caps and the original shared budget stop further work. An intent carries the authorized revision so resume can complete a crash between the intent and its graph append.

Candidate and final verification now share immutable configuration assembly in `src/workers/controller-verification.ts`; each call still creates and measures a fresh independent checkout. No producer observation is reused as verifier evidence. The existing independent hash/signature/verdict implementations and known-answer tests remain separate. This is a composition simplification, not a measured speed claim.

Repair feedback is recorded with tool-output provenance and seeded into the existing execution derivation heuristic. Previously it was labeled untrusted in the prompt but missing from that window. A public worker-path regression submits a shell command copied from diagnostic output and observes denial before the command writes its file. The heuristic remains bounded and fallible; it is not an information-flow guarantee. The ordinary default prompt is unchanged. The initial final-goal fixture incorrectly indexed a task-sorted result array as completion order; it now looks up the recorded worker identity. That failed focused run is retained as `final-goal-repair-focused`. The next focused run passed 53 tests and exposed one remaining fixture assumption about concurrent model-factory order; the assertion now checks independent starts without ordering them and still requires the repair afterward. Full `final-goal-repair-gates` then passed 303 files and 2972 tests, with one old legacy-selection assertion assuming task two always reached integration second. Its replacement binds the unverified claim to the captured rejected landing and retains both expected selected winners. A crash after final-goal repair intent but before graph append is covered by recovery; accepted producers are not called again and the original attempt is used once. The first correction additionally asserted the two initial winners without accounting for the later repair selection with no eligible winner. That assertion now distinguishes actual choices from an explicit null choice; it still rejects any unexpected selected worker. Both full failed runs are retained. Corrected `final-goal-repair-gates-final` exited 0: 304 files and 2973 tests passed in 112.75 seconds, no skips, with unchanged baseline Biome diagnostics. Evidence digest: `sha256:8dbec2fb09b4ae08ee5bd9e26cb1ccb137fde45a06347aba35157b8c5fc4fb72`. The tested diff is commit `0b289051107d36a0a8395012eb5545f6c57ea6f8`.


### Explicit empty-project bootstrap

`parallel --goal ... --bootstrap node` requires a clean, empty Git base and establishes Node 24 ESM plus the standard-library test harness before planning. A version-three launch pins the explicit stage. Version-one and version-two launches retain their original semantics. Setup commits use deterministic Git object bytes under a retained `refs/swarm-bootstrap/<run>` reference; the user branch, index and working files are unchanged. The ledger records actual event times separately from the setup commit's canonical timestamp. The initial manifest and ignore file become immutable acceptance infrastructure before implementation. Other toolchains and projects needing dependency setup use the existing initialized-project path.

The stage shares the original wall deadline, test permits, cancellation and selected execution backend. It observes Node's version, one passing test control and one failing test control. A runner that ignores the failing file, a missing backend, truncated output, timeout or cancellation cannot admit implementation. Those controls establish an instrument, not a completed feature. Final regression and pinned goal acceptance remain mandatory. Interrupted setup recreates only recorded exact files and object identities, with three bounded check invocations per control; moved references or altered files require reconciliation. Cleanup has its separate allowance, validates ownership and retains unexpected files. The independent bundle reader reconstructs setup Git identities and re-derives all three observations with its own rule.

`bootstrap-public-path` exited 0 with 2 files and 77 tests in 11.69 seconds. `bootstrap-recovery-focused` exited 0 with 6 files and 110 tests in 12.08 seconds, including both Git object formats, a public complete-goal execution/resume, ignored negative control, unknown backend, queued cancellation, interrupted intent, altered cleanup files and forged observations. These deterministic results are development validation, not a live-model pilot. Full `bootstrap-gates` exited 0: 305 files and 2982 tests passed in 111.13 seconds, no skips and unchanged baseline Biome diagnostics. Evidence digest: `sha256:a84a7b2a3601af48ae296327a1962e9ca0f5a7834a3f77bf84ee36c30a090cb1`. The tested diff is commit `d7e13cb81ff9c3ba604b7c023b483cc3972298d9`.


### M4 measured journal replay

`scripts/redesign/profile.mjs` measures fixed journal, growing transcript, reconstruction, citation-index, peer-projection, immutable-check assembly and synthetic resource-permit fixtures. Raw samples, fixture digests, script digest, source identity and platform are captured outside the workspace. The first profile preceded optimization. The repeated comparison uses the same corrected script on the changed source and a detached `d7e13cb81ff9c3ba604b7c023b483cc3972298d9` checkout. The correction places the peer exit code at the actual gate-record field and asserts twelve folded failures; the original profile is retained, not silently replaced.

| Fixed fixture, seven repetitions | Baseline median ms | Changed median ms |
| --- | ---: | ---: |
| Cold replay, 12,000 entries / 7,667,836 bytes | 30.825 | 34.440 |
| 200 unchanged administrative reads | 757.695 | 508.270 |
| 50 reads after independently appended deltas | 1530.164 | 247.253 |
| 30 own updates with fsync | 517.636 | 447.008 |
| Record 180 growing transcript prompts | 911.215 | 910.214 |
| Reconstruct 180 messages fifty times | 80.413 | 82.184 |
| Rebuild 12,000-record citation index 100 times | 162.017 | 159.783 |
| Project three 12,000-record peer chains 100 times | 102.386 | 101.806 |
| Assemble immutable check definitions 10,000 times | 16.641 | 16.477 |

The journal replays only new links after re-hashing the entire observed file and its previously verified prefix. It still reads actual bytes on every poll, detects same-size/mtime alteration, refuses removed history and preserves torn or changed files. A new regression reproduced an existing cache-poisoning defect: an unexpected write between validation and append was cached as trusted content. Appends now compare the complete observed file with the expected prefix plus their exact new line before updating the cache. Raw-byte digests avoid decoding malformed UTF-8 into a replacement character. The single worker retains one administrative store handle across polling, tools and lifecycle recording.

The measured reduction is 83.8% for the external-append fixture and 32.9% for unchanged reads, with an 11.7% cold-replay increase (3.6 ms). These repeated synthetic measurements on one shared machine are not independent repository observations or whole-run speed estimates. No transcript, citation, peer or check-result cache was introduced: their measured costs did not justify extra state. Exact transcript reconstruction and all final checks remain mandatory. The separate-resource fixture observes about 242 ms versus 428 ms with one shared permit for sixteen fixed 25 ms activities. This demonstrates scheduling overlap only; actual model-server contention remains part of the live development/pilot work.

`journal-append-corruption-before` failed the new corruption assertion, preserving that reproduction. `journal-preservation-focused` exited 0 with 6 files and 66 tests in 24.67 seconds, including a real second-process abort and removal of a verified budget event. Profile captures are `m4-profile-before`, `m4-profile-after` and `m4-profile-control`; the corrected control digest is `sha256:d0e27dfb1c2dcc0cf18cc100220c02d858bd8fc253c21ee341f1a668ff5fd99a`. Full `journal-optimization-gates` exited 0: 305 files and 2987 tests passed in 110.77 seconds, no skips and unchanged baseline Biome diagnostics. Evidence digest: `sha256:52389901d7ac0cd11f4b37dd2518acce520e79a33813a222c4d7af80df26f8bb`. The tested diff is commit `64d9ec24158580897631bbc983250e82a3d7d554`.


### Controller presentation

Plain output, the terminal screen and structured JSON project the same coordinator ledger.
Worker completion does not supply a goal verdict; a later verification or graph change withdraws
a previously displayed assessment. The ordinary view leads with requirements, blockers,
resources and the resulting branch. Detailed assurance and worker events remain available with
`--details`. The terminal loads only when selected; JSON and plain controller output do not load
its renderer. No default worker prompt changed.

`controller-presentation-focused` exited 0 with 4 files and 84 tests in 11.77 seconds. The actual
CLI execution path observes all jobs accepted while goal checks remain pending, then emits the
recorded assessment and matching exit code. Additional checks cover model-authored verdict
refusal, unknown usage reservations, repeated settlements, terminal control sanitization and
idempotent screen cleanup. Full `controller-presentation-gates` exited 0: 307 files and 2994 tests passed in 110.90 seconds, no skips and unchanged baseline Biome diagnostics. The tested diff is commit `c17328b02f7593eb923abfcb20192e3433fe9050`; evidence digest `sha256:d3cad1304b24a578242d8eb75d54510827c88bdab1ce82b9ab06320382d18d81`.


### CLI composition preservation

Session execution, calibration, initialization, terminal setup, pricing/reward recording,
bundle export and gate reporting now have focused composition modules. Settings still resolve
through one shared function. The root dispatches optional session, calibration, parallel and
independent-CI handlers when selected; terminal setup loads the session renderer when invoked.
Existing single-task execution, predicate support, bundle formats and command options remain.
This is a maintainability change, with no claimed runtime speed ratio.

`cli-composition-focused` exited 0: 4 files and 91 tests passed in 887 ms. It includes actual child
processes that reject inactive calibration/Ink loading during help, preserve two buffered piped
tasks through EOF, and refuse tampered bundles and unknown signers through the CLI. Full `cli-composition-gates` exited 0: 308 files and 2996 tests passed in 111.47 seconds, no skips and unchanged baseline Biome diagnostics. `cli-composition-package` exited 0, building and installing the tarball and checking all 19 documented commands against their behavioral contracts. The tested diff is commit `e86fb82250c5a8f7f9c5bb3a4c05cf6f1ff7f234`. Gate evidence: `sha256:777a9e12ad94e2fafdb81d52db907d953a91d39a30ed3cbe4d89164183046f2e`; package evidence: `sha256:57d1f82465db5e5c959873b20105f2988ac261b7223b760265432888e490db90`.


### Acceptance check isolation correction

Two new public verifier regressions failed against the prior source: ignored output from one
check contaminated the next, and staging a source mutation hid it from a worktree-to-index diff.
`goal-check-contamination-before` retained both failures. Checks now compare tracked content
against the exact integrated tree and restore a verifier-owned snapshot between observations.
The snapshot preserves installed dependencies and setup outputs without reusing a check result.
It copies symbolic links without traversing them, honors cancellation while preparing the copy,
and restores the owned checkout during cleanup. This adds copying work; no speed benefit is
claimed. Acceptance artifact reads reject replaced links and cleanup removes the owned checkout
entries rather than following an artifact path whose parent a check could replace.

`goal-check-isolation-focused` passed 2 files and 11 tests in 12.13 seconds. The next focused run
passed seven cases and failed one expected diagnostic: the existing path guard already refused
a candidate's link outside the verifier. The assertion now names that actual guard boundary;
the outside-file preservation assertion remains. Expanded checks cover preserved setup files,
source staging, ignored artifacts and a replaced artifact directory. Full `goal-check-isolation-gates` exited 0: 308 files and 3000 tests passed in 111.18 seconds, no skips and unchanged baseline diagnostics. The tested diff is commit `b5f32aaafe7cb4b88e6be288f9cb0bbed565f04d`; evidence digest `sha256:6040cbe95f8f53bac653db7df1d1f724e91312063f73c1540b93309ccad18f54`.


### Canonical engineering instructions

`docs/engineering-policy.md` is now the sole editable source for both generated agent files.
The drift check retains the legacy numbered-invariant comparison and additionally compares
all generated bytes, including code style and completion requirements. The detailed prior
25,878-byte instruction file is preserved through the existing lossless offline archive
mechanism, with its source commit and per-file digest. Restoration was compared byte-for-byte
before replacing the duplicate narrative with an archive reference. The policy preserves all
16 invariants and their linked detailed mechanics. The only substantive product changes remain
the approved M0 revisions; the current architecture map now names the implemented controller
and extracted CLI handlers. `.ignore` keeps bulk recorded artifacts out of ordinary code
searches without removing them from Git or verification.

`canonical-policy-focused` exited 0: 2 files and 8 tests in 230 ms. Tests preserve custom two-file
drift checks, detect drift outside the numbered block and refuse missing/reordered invariants.
Full `canonical-policy-gates` exited 0: 309 files and 3002 tests passed in 111.47 seconds, no skips and unchanged baseline diagnostics. Tested commit `3f59d62ec38104e2dd0e5fabd2fcd6d7a6727960`; evidence digest `sha256:d4610b8ec605095953d8568ec46d935009ddecd882cfcc17210c4144bbca6aa3`.

### Live evaluation preparation

Two local transport canaries used the production provider adapter and recorded shared
reservations: Qwen 3.6 35b-a3b returned two usable calls in 5306 ms using 1752 reported tokens;
Mistral Small 3.2 24b returned two in 6659 ms using another 1074 tokens. No usage was unknown.
These include model loading and establish transport readiness only, not task quality or a
comparative advantage. The source, model digests, requests and responses are in the external
`local-transport-probe` capture and its transport session.

Eight public repositories were fetched for admission preparation: dayjs, koa, commander.js,
chess.js, ts-pattern, click, attrs and itsdangerous. No 24-goal protocol has yet been frozen or
scored. `pilot-repository-fetch` records their fetched source identities. No paid service was
used, and no external production worker driver has been activated.


### Prompt comparison and first live development observation

The first actual CLI pagination goal at `3f59d62` stopped when its next input/output reservation
would exceed the shared ceiling. Reported usage was 183,455 of 250,000 tokens, with no unknown
calls. The 66,545 remaining tokens were insufficient for the next conservatively reserved
request. No task landed and the goal remained unjudged. The planner split a small four-file
fixture into six jobs, separated tests from implementation, and invented interfaces. A worker
tried to add a test outside its authorized scope; both the write and self-amendment were refused.
The retained candidate and cancelled test-process observation are failures, not a completed
repair demonstration. Capture `pagination-development-live` exited 130, digest
`sha256:7844395ea75ccf539773128f2f37055e2d58b51a6387984448d558754878f35e`.

Planner guidance now preserves actual interfaces, keeps maintained tests with implementation,
and favors one worker for tiny or coupled goals, including when the user supplies final checks.
It no longer incorrectly says final executable goal checking is absent. This is guidance, not
a semantic proof that a decomposition is suitable.

A separately selectable concise worker profile removes routine predicate enumeration, retaining
the general claim tool and a chokepoint-mediated full reference tool. Harness receipts record
observed gate statuses, lifecycle and usage; a receipt for a failure does not accept the task.
The historical default is unchanged and its exact digest has a regression check. The comparison
runner freezes three synthetic development goals, both prompt bytes, local model identity,
check artifacts, counterbalanced order and identical limits before launch. It includes worker
repair and independent final verification. It is a worker prompt comparison, not a swarm pilot.
No default change or empirical benefit is claimed before those observations exist.

`prompt-profiles-focused` exited 0: 5 files and 43 tests passed in 23.09 seconds, including a
public worker that reads the full reference, falsely narrates success, and remains rejected by
the real check. Digest collisions retain unverified status and model-authored records generate
no harness receipts. Evidence digest: `sha256:21ca7331906643912bf19ca8e265b6562a58e9bfd6d0ebad3bf17d8a02ced6e5`.

Full `prompt-profiles-corrected-gates` exited 0: 311 files and 3005 tests passed in 111.12 seconds,
no skips and unchanged baseline diagnostics. The first full invocation stopped at a TypeScript
narrowing error in the new test; that failure remains in `prompt-profiles-gates`. Tested source
commit: `e0a4602b23c219b8851a30360d1bd12dcfdb5a10`. Passing evidence digest:
`sha256:b5a0a0e01f0c931ba34a116cabde240ab57e93252115895fe6c5a7368e77195a`.

The first fixed prompt comparison launched all six scheduled workers using local Qwen 3.6
35b-a3b, context configuration 32768, thinking disabled, one model slot and one test slot.
Five were locally green; all six failed independent admission because they modified
`base.test.js`, which the comparison driver marked immutable only at verification. This is a
driver defect, not evidence that either prompt completes these goals. The driver now passes
the same effective contract into worker execution. Worker and repair briefs display enforced
scope, immutable paths, required checks and resource limits before the model needs to discover
a refusal. The original single-worker task bytes stay unchanged where no contract is supplied.
The first comparison remains preserved as development evidence and will not be relabeled.

| Synthetic development goal | Legacy time / reported tokens | Concise time / reported tokens | Final acceptance |
| --- | --- | --- | --- |
| Cursor pagination | 70,244 ms / 212,529 | 48,398 ms / 135,365 | both refused |
| Cache invalidation | 19,038 ms / 45,437 | 32,333 ms / 57,273 | both refused |
| Interface result | 31,935 ms / 75,050 | 21,505 ms / 37,271 | both refused |

These are correlated development cases with a defective admission setup. No prompt benefit,
complete-goal advantage or default change follows from them. `prompt-comparison-live` exited 0
because the fixed schedule completed, with zero accepted goals; digest
`sha256:f10b529e236bf53c43436c0352d02137d71b1b528cfb2dcbb36cdeb699f1110c`.
Raw protocol, observations, retained commits and session evidence are under the external
`redesign-development/prompt-comparison-1` directory.

### Goal-level pilot protocol and recovery

Version two extends the existing frozen campaign machinery for goals clustered by repository.
The pilot seal requires at least 24 goals, eight repositories, Python and JavaScript/TypeScript,
all three native comparison roles and both ablations. It fixes requirement identities, source
and check digests, model/backend settings, limits, arm rotation and the comparison subset.
Previously exposed tasks cannot be relabeled fresh held-out tasks. Version-one independent
repository protocols and their arithmetic remain supported.

The report keeps all scheduled work, observed wall time, unknown accounting, incomplete branches,
missed checks, retries, integration repairs and human burden. Failed goals are charged the fixed
deadline in the declared time-to-success comparison; actual elapsed time remains separate.
Descriptive intervals resample whole repositories, preserving goals and correlated repeats.
The legacy independent-repository interval is not applied to version two. The numerical pilot
threshold remains a development decision, never a population non-inferiority claim.

Campaign replay validates the pinned protocol and event identities. An unsettled launch requires
explicit effect/usage reconciliation; an accepted execution is never launched again. Unavailable
pre-launch observations record the reason for every unlaunched scheduled entry. The ordinary
controller display now retains the actual shared-budget stop reason after its final assessment,
including a refusal to reserve a request when some tokens remain.

`goal-pilot-protocol-focused` exited 0 with 8 files and 26 tests in 9.82 seconds. It exercises
requirement omission, repository clustering, all-schedule denominators, unavailable admission,
changed history, budget display and public worker scope exposure. Evidence digest:
`sha256:815ccba7bc619a1c9af93f743629af15fc3c8c8e8f3e731e41a1f044f2803996`.
The real 24-goal pilot has not yet been frozen or launched.

### Historical transcript weight

The existing lossless archive format now holds 18 September 4 transcripts: 1,346,516 source
bytes in a 55,986-byte compressed file, plus its manifest and per-file inventory. Every restored
file was compared byte-for-byte before removing duplicate raw files. Original relative paths,
source commit and SHA-256 digests are preserved; historical ledgers, checks, patches, verdicts
and cited bundles were not changed. Restoration instructions are in that campaign's README.
`archive-historical-transcripts` exited 0 with all 18 byte comparisons equal, digest
`sha256:655a97f96476ea65381e386e752289a09fd77de695ba4f8ec88ac511744a789a`.
The repository weight ceiling remains 100 MB.

Full `goal-pilot-preparation-corrected-gates` exited 0: 314 test files and 3015 tests passed
in 122.95 seconds, with no skips. The prior invocation had eight failures in the scripted
worker acceptance fixture because its exact first-message lookup did not recognize the new
contract briefing. The fixture now separates that briefing from its script identity; acceptance,
landing and claim assertions are unchanged. Both invocations remain in the implementation ledger.
Passing evidence: `sha256:0b74ee78698303c2c8c0637efd5bf783e75b06394d7387c2563a54bef65e8d64`,
bound to parent `e0a4602b23c219b8851a30360d1bd12dcfdb5a10` and the captured source diff.

### Explicit dependency setup across the controller

`parallel --install` now carries opt-in lockfile setup through the native worker, each integration
measurement and the fresh independent verifier. The launch uses version four and controller
configuration version three; older launches keep their original defaults and remain readable.
Bootstrap and lockfile setup are distinct stages. Commands use the selected execution backend,
built child environment, cancellation and test-process pool, with no fresh timeout allowance.
The supported npm/pnpm/Yarn lockfile invocations disable lifecycle scripts. This is not a claim
that package managers execute no project-controlled code or that host execution is containment.

Setup records intent, source/lockfile identities, process observation and completion. An installer
that changes tracked or visible source is refused; ignored dependency directories remain runtime
material. A failed install cannot turn into accepted independent verification. An unanswered
setup intent requires reconciliation rather than a fresh installation, including worker recovery.
The bundled verifier separately derives setup status from process and source observations.

`dependency-setup-corrected-focused` exited 0 with 8 files and 146 tests in 43.56 seconds,
digest `sha256:a3420e57b15918abc5ecd75ddf6f5d41a6bb48d958ee88975f76acbf0eec3978`.
The prior focused invocation retained two failures from an unsupported conjunction in a new
predicate example; the example now uses the existing predicate grammar. Full `dependency-setup-gates`
exited 0 with 316 files and 3024 tests in 122.32 seconds, no skips, digest
`sha256:f2113d3d47caf40f97742b31a9276d050a50c39efc198d2ddd25ea692533dfd1`.
It exercises real npm setup without registry dependencies, suppressed lifecycle execution,
source mutation refusal, public worker/integration/final verification, post-intent crash recovery
and independently rejected forged setup status. The capture binds parent
`3b5d730bd9dab0e9c44abed2547cd854dd4b303a` and the tested diff.

The corrected six-launch prompt comparison at that parent accepted three executable behavior
checks out of six scheduled runs: legacy accepted one of three, concise two of three. Pagination
was locally green under legacy but failed the final behavior check. Concise pagination exhausted
its next reservation; legacy cache work returned incomplete provider usage (one call remained
reserved at 56,554 tokens), so verification stopped for reconciliation. These development cases
are exposed and correlated, and their checks do not establish every prose instruction such as
maintained-test quality. Default prompts remain unchanged; no speed or completion advantage is
claimed. Protocol, all observations and candidates remain under `redesign-development/prompt-comparison-2`.
Capture `prompt-comparison-corrected-live` exited 0 because all six launches settled, digest
`sha256:bd02672248549c6b148af53e98b0a5d3516636122c11ef7b9074097a4b5e6ed7`.

### Six local controller development goals

The fixed development driver uses the real native worker and controller with local weights,
protected final behavior checks, retained candidate commits and combined offline-verifiable
bundles. Its six cases cover missing prerequisites, incompatible integrated behavior, textual
conflicts, mismatched interface proposals, a declared post-landing crash and over-decomposition.
These are synthetic development cases with deliberately flawed starting assignments. They do
not count toward the natural 24-goal pilot. No source patch is applied manually between attempts.
The interruption is an in-process fault after durable completion; separate recovery tests kill
an actual process. All cases share the frozen limits: 600,000 tokens, ten minutes, 16 steps,
one worker gate repair, two controller repairs, four revisions, two worktrees and one model/test
slot each. The supplied decompositions mean planning cost is absent from this development run.

The development control test establishes that all six base suites pass and all six final checks
refuse their base. `development-controls` passed in 534 ms, digest
`sha256:546a1d0ad0ee5cb1990f267c4fdd596830769d03524c0a87d786be46fd7869d3`.
The first full invocation caught a reporter-format assumption in that new control test. It now
requests TAP explicitly before interpreting TAP output. Full `controller-development-corrected-gates`
exited 0: 317 files and 3025 tests passed in 122.16 seconds, no skips. Passing digest:
`sha256:0df8ac57a11b0046acb750ae5ba8c87f9af79bf6a1cd94deb1d23047009f4c46`,
bound to parent `8646cbfac4961764243f34ad1aac5e8da536f51e` and the captured diff.
The frozen live run at `07298dcea0092d727f0b4e4658b87de869270986` accepted all six
executable development goals. Each combined bundle independently verified with exit 0.
Evidence: `redesign-development/controller-six-1/observations.json` and per-case sessions,
branches and bundles; capture `controller-development-live`, digest
`sha256:b5186e256611b79fa95c79ed7d5ff0774b264bb3794a47a4a651846e2b086410`.

| Development goal | Total ms | Reported tokens | Observed recovery |
| --- | ---: | ---: | --- |
| Missing prerequisite | 99,072 | 282,396 | Failed consumer retried after beta landed; beta was not restarted |
| Clean merge, behavioral failure | 56,832 | 142,172 | Integrated tests rejected worker 2; its repair landed on worker 1 |
| Textual conflict | 51,257 | 129,713 | Rejected conflicting candidate retained; repair preserved both flags |
| Interface mismatch | 97,594 | 285,504 | Final goal refusal triggered revision 1 and a combined repair |
| Interrupted run | 25,494 | 82,930 | Resumed after worker 1 landing; each worker landed exactly once |
| Over-decomposition | 97,787 | 313,762 | Three landed modules omitted wiring; revision 1 combined their obligations |

All six settled with zero unknown calls and zero outstanding token reservations. The clean-merge
repair produced commit `e0ced76c03bd6b7a56358e2e196e2a9addcdaba6`; the conflict repair produced
`da080fca5d90cf9344f7968f7183863264a5fc5e`. Model-authored behavior checks are development
instruments, not independent ground truth or proof of maintained-test quality. These supplied
small decompositions do not establish planner quality or a swarm advantage.

The missing-prerequisite case repeatedly submitted empty coordination arguments. Its successful
ordinary retry did not establish a valid dependency proposal or graph revision. Two recorded local
schema diagnostics retained all responses. The first produced invalid arguments for both the old
union and an experimental flat schema. With explicit kind-specific tool guidance, the original
strict union produced a valid dependency request while the flat schema still added an invalid
field. The flat schema was discarded. Diagnostic digests are
`sha256:9613d146ac69477b173b76c8e91e8ff8891d6367786d29224fe9655b38a08cb5` and
`sha256:a32e4491ca38afdb9d347ad7e5729f97417eb2f68e57441701c3aca9e29c31cd`.
These single-call diagnostics explain the retained smaller change; they are not a reliability
estimate. Peer projection also now resolves the original graph task name alongside its controller
id while keeping same-task alternatives hidden. Its focused regression passed six tests in 314 ms,
digest `sha256:1e555a68a92260bf2f76fca772ba8cc4404fdd59fefc5ff560358fd90ab7c370`.

Full `coordination-guidance-gates` exited 0: 317 files and 3026 tests passed, no skips,
126.28 seconds, digest `sha256:14653a46b9a792cd1c308cb38b65d63c04930f6d2bb6ad0139dd70f97e6ce67e`.
The capture binds parent `07298dcea0092d727f0b4e4658b87de869270986` and its tested diff.

### Python checks and ambiguous verifier setup

Legacy `setup.cfg` and `setup.py` now identify Python projects without executing setup code.
Configured mypy `files` remain authoritative: passing `.` previously replaced those targets
with unrelated untyped tests. Explicit TOML/INI targets now use `mypy`; projects without targets
retain `mypy .`. No blocking check becomes advisory. Ruff lint explicitly uses `--no-fix`, since
project configuration can otherwise make a purported check edit its subject. A real Ruff 0.15.9
canary with `fix = true` demonstrated the defect: the old invocation removed the unused import
and exited 0; the corrected invocation preserved it and exited 1. Capture digest:
`sha256:a60d5d129c853fc0839a51a8a6cfd229ba0c29f1838d27f1f45805570685d5b1`.

Independent verification now retains its checkout when dependency setup has no completion
observation, and names the path in its reconciliation error. A regression injects a lost installer
observation after a filesystem effect and checks that both the effect and checkout survive.
`python-configured-checks-focused` passed 26 tests in two files, 593 ms, digest
`sha256:1f4bbec482db437246015cefbae65b78c09ef9a827a13e961ffdbb81c043043b`.
The preceding public-contract focused run passed 34 tests in three files in 12.61 seconds,
digest `sha256:f79d5b1d61456fce918dc328635fc3949548ac88fcde21cdd100bd9c682a463c`.

The separate one-case live repeat at `caa20f0994c74c778b4534fc84b2e7cc6ab02be0` submitted
a valid missing-prerequisite proposal. The controller appended revision 1, preserved the goal
and both obligations, waited for beta, and repaired the consumer against beta's accepted commit.
Final commit `71f886cf2e32e1fa56b0530c50f25421a0183d75` passed goal acceptance and its bundle
verified offline. Reported usage was 319,121 tokens with no unknown or reserved remainder.
This exposed repeat is additional development evidence, not another independent pilot goal.
Capture `coordination-public-live`, digest
`sha256:7227699b4b64e3acb9329a4fa79b1fa7bf0f56538aec754cbe865281ea5a726b`.

Initial pilot fixture preparation preceded the corrected freeze. All 15 JavaScript/
TypeScript bases installed; twelve initially passed their declared checks on Node 24.15.0. Three Day.js
bases exposed timezone and historical webpack/OpenSSL incompatibility. Python preparation caught
installed `attrs` shadowing source, missing package metadata/dependencies and incorrect mypy
scope. Those unusable measurements remain preserved as
`pilot-node-base-admission-started` (`sha256:bace6f21ac41ea363263e0ca1d628056ff0bdec144d2d63f0d014648639e5871`)
and `pilot-python-base-admission` (`sha256:ef6d32d65626ad71a72b78073b92e2fb6e74ec58c3908f050cf6405dc22aac26`).
The corrected runtime and source-identity observations are recorded below; these earlier unusable measurements remain preserved.

Full `python-project-checks-gates` exited 0: 317 files and 3029 tests passed, no skips,
134.79 seconds. Digest `sha256:498c6bdfe23e6d66945537e46a5f8a26873fa2a989da0236dfd02b6933b2c4dd`
binds parent `caa20f0994c74c778b4534fc84b2e7cc6ab02be0` and its tested diff. A real Python
canary established mounted-source imports for attrs and Click and successful configured mypy
checking of Click's 28 declared source files, digest
`sha256:4580682f9c788ab4cdd37e4870770bc3d9de53da50ca847bbaeffc36ea2e8618`.

### Pilot runtime and instrument admission

All 24 selected public-history bases now have runnable declared checks. Day.js uses its historical
Node 16.20.2 image while the Swarm harness remains on Node 24.15.0. Its three complete build,
test and lint runs passed without changing assertions or adding OpenSSL loading flags. Capture
`dayjs-container-installed-checks`, digest
`sha256:60480a898d19c85308e028bb51ba201ee166fd312d397ca4c2c6b08630ee2263`.

Python images install metadata from the pinned base and import the mounted candidate source,
not an installed reference implementation. Corrected attrs and itsdangerous checks and all
source-identity observations are in `pilot-python-corrected-admission`, digest
`sha256:4301da63c83a795f329c123c0fc9b15a7f0924acfc7ba1f829a13bf8e9817e60`.
Click additionally needs the declared `less` utility. Its fake pager fixtures cannot execute on
the container's noexec temporary mount, so pytest uses its ignored workspace cache and the same
filesystem for temporary capability detection. The noexec mount, unprivileged user, dropped
capabilities, read-only root and denied network remain. All three corrected Click suites passed;
existing platform skips, expected failures and the project's 31,000 stress-case deselections are
reported, not promoted to passes. Capture `click-complete-admissions`, digest
`sha256:edf08c28bedef84d020b74e3fec6f5a5d572860a5b4ff7084b7394234bbf7a99`.

The first nine Python acceptance pairs each rejected the original source and accepted the
normalized historical fix. These maintainer model-authored checks share reasoning across their
input variants, so agreement is not independent ground truth. Capture
`pilot-python-instruments-1`, digest
`sha256:de4bc652aa2e9d282a8771dadd314fdfb791673ed2ef5fd7b2f5cbff4d05150a`.
The first JavaScript/TypeScript instrument pass admitted 10 of 15 cases. Three unchanged Day.js
candidates exposed Git 2.30's lack of `git apply --allow-empty`; two chess cases needed their
project-declared generated parser. Both faults are preparation defects, not agent failures.
Their failed observations remain in `pilot-node-instruments-1`, digest
`sha256:6490adaa2dc6ed124c5382283d8512095820c447168ff13f832112860c004f27`.

Unchanged candidate verification now measures a clean Git diff instead of asking Git to apply
an empty patch. Nonempty patch failures retain their actual diagnostic. The focused independent
verifier suite passed 36 tests in 17.85 seconds, digest
`sha256:3dae51cbbd780452f0e7bd52b9ad58cd7caa2d688e6bc90e1755570cbabb749d`.
Chess acceptance explicitly runs its pinned parser generation. Additional Python checks cover
hook exceptions and public typing. The corrected instrument admission is complete: all 15
JavaScript/TypeScript and all nine Python cases have `admitted: true`. The corrected Python
admission capture is `pilot-python-admission-corrected-only`
(`sha256:d4555b064c61c8c0fd290d4eabd88dcb40d76f97e3ff801a8aa40d76158869ac`). The corrected Node
wrapper completed all 15 admissions, but its final wrapper status was 1 because it was pointed at
a missing Python runtime directory after the completed work. That retained observation is
`sha256:649880b5...` and is not used as a passing total.

The native pilot executors include a strong single worker with repair, the unmodified review
controller with an external accounting/setup wrapper, the adaptive controller and both ablations.
They use the same independent final acceptance path and retain all attempted launches. Separate
held-back verification has its own declared evidence chain, linked by the coordinator before
bundle export. A six-test driver suite exercised real checkouts and both a valid change and a
locally green omission; both bundles verified offline. Capture `pilot-driver-linked-evidence`,
digest `sha256:4d4a0f59eacb509d4abc7f3a0f4be94becc7eb9880f42192c91ba4887a20ad36`.
Earlier driver failures from mixing goal declarations and omitting chain links remain recorded.
Earlier driver failures from mixing goal declarations, shallow base reachability, Docker volume
path separators, and shared reservation sizing remain retained. The frozen pilot protocol is 24 goals, eight repositories, five arms and 120 scheduled launches. The
cleanest completed freeze is `pilot-freeze-final-9`, source `f971b53594b6ef63d747074a739655ff0e765414`,
protocol digest `sha256:bc4890f4110d7eea1691e419154faf69a70d6b17c83050afa7d1a32d97c8831c`. The run was
stopped after four serialized launches when the fourth historical checkout exceeded the available
execution window. The retained observations are: single completed with no accepted goal, frozen
parallel crashed at shared-budget admission, adaptive completed with no accepted goal, and
no-adaptation cancelled at the same admission boundary. No-peer and the remaining launches were
not started. These are descriptive partial observations, not a complete pilot result or speed
advantage claim. The exact unfinished requirement is the complete 24-goal paired pilot with all
five arms, its adaptation and peer-information ablation totals, and any feasible competing-arm
comparison.


### Final validation and delivery

The implementation tree for this final validation sequence was `b56761e63b5f6e9dd3499f6cb6693c1aab132b9f` on
`redesign/adaptive-goal-controller`. `redesign-gates-final-5` exited 0 with 318 test files and
3036 tests passed, no skips, in 130.55 seconds. Biome retained the baseline 22 warnings and one
informational diagnostic. The capture digest is
`sha256:13291c81a67e32dadc90ec93563be936138788777cc7452d9f63b8e9747c0fdd`.

The committed-tree build exited 0 and copied nine assets, digest
`sha256:29752d4d95d064a743147123e871a4e716bf34c87a9a3baae3ee09d4f4ef625d`. Packaged command
contracts exited 0 for all 19 documented commands, digest
`sha256:1730a636ac237de0dec5b26d8793ae1c571c60c18671de0a77f20c20b2295f65`. Fuzz smoke exited 0
with eight adapters and the declared seed counts, digest
`sha256:099418576bab30ebd082921f7f72b07ddc9954df3feced9d8ed66c78646e57a6`. A local release
candidate tarball was generated with `npm pack --pack-destination /tmp/swarm-orchestrator-rc`; the
package is version 14.0.2, 641 files, 812.2 kB compressed and 3.4 MB unpacked. The dry-run capture
is `sha256:022d71b6621f1a114e56c182a42eca99cbd809214bc56cd241f5e1afb16c7159`, and the materialized
tarball capture is `sha256:bb8e31ccb725b4e081b19ada448cc94c34741df4793fa239e6b3d31c548720e1`. The tarball SHA-256 is
`b451c4746071e3e6056aaea176db636710e448b158c51fd89713a70f4a542e91`; it was not published. Linux, macOS CI
replay, registry publication and push were not performed because no external authorization or CI
runner was available.

The final pilot capture retains four launch directories under
`/Users/brad/.cache/swarm-redesign-pilot/frozen-pilot-final-9/`, including the cancelled fourth
observation. Its capture ledger is under
`/Users/brad/.swarm/redesign-evidence/2026-09-13/pilot-run-final-9/`. The pilot report is not
used to claim a comparative result. The external Loom canary was also retained as an unavailable
competitor observation: the locally configured run timed out without a completed goal and remote
Claude credentials were absent.

The remaining empirical work is therefore precise: finish the 120-launch natural-repository pilot
with all five arms and ablations, run any authorized supported-platform gates, and add a feasible
competitor only if its supported local or already-authorized provider completes the same protocol.
No swarm advantage, independence claim, or universal correctness claim follows from the partial
observations.


### Completion execution audit, September 14

The owner authorized the finite pilot, validation, branch delivery and npm publication in the
September 14 completion instruction. This supersedes the earlier authorization limits without
changing access controls. The clean starting review commit was
`88c5064d3cde1fa8d54ac96d62863184e559c1d0`. Origin's literal default remains `v13-main`, at
`a950d1bd51474ec24ec647c3fd9ed3c003dc93b8`; no open review PR existed at inspection.
The repository permits merge commits. Its active ruleset restricts branch creation, updates,
non-fast-forward updates and deletion, with the existing administrator role authorized. No
required reviewer or status-check rule was returned. No rule was changed.

The original frozen source resolves to `f971b53594b6ef63d747047a739655ff0e765414`.
The earlier full SHA above transposed `047` to `074`; the original manifest was unchanged.
`sha256:bc4890f4110d7eea1691e419154faf69a70d6b17c83050afa7d1a32d97c8831c` identifies the full
frozen inputs, while the actual protocol digest is
`sha256:a083e15d54f31f318f3b9e243948470165d2bcbbe52119f5d64bf1b896f0b7cb`.
The checked manifest, campaign chain, 24 repository pins, sealed and held-back check digests,
reference patches, image identities and five launch chains are retained in `completion-audit.json`
under the existing external evidence root. Digest:
`sha256:a72f7158efc7dde31b3b28f242218bff08b4733bb0c2da0ca72b6a5dac91bbe7`.

The four settled observations match their raw files. Three bundles verify with exit 0. The
frozen-parallel bundle retains its original exit 1 because the admission crash left required
final gates missing; that failure is not an artifact-integrity success or an accepted goal.
A fifth no-peer launch was present despite the earlier narrative: it stopped during a test,
leaving 35 completed model calls, 311,368 reported input tokens and 4,039 output tokens, with
no pending model reservation. Its candidate edits and patch are preserved. A current process
inspection found no pilot process and Docker confirmed every named container absent. Append-only
reconciliation records an infrastructure outcome with unknown final acceptance and unknown
execution wall time. Its campaign latency is explicitly elapsed calendar time to reconciliation,
including offline time, and must not enter execution-time totals. Reconciliation evidence:
`sha256:f990b3def2a3a82943cb8735149e09f9a8063b42972ac90463efc4c0bfafea31`.

The selected path resumes this original cohort from the clean detached
`/Users/brad/projects/swarm-redesign-pilot-resume` checkout. There are 115 unstarted slots,
not 116. No outer retry is scheduled. The remaining ceiling is 69,000,000 tokens and 103,500,000 ms
of execution, plus 6,900,000 ms of cleanup allowances. Each slot keeps 600,000 tokens, 900,000 ms,
24 worker/planner steps, one worker gate retry, two controller repairs, four graph revisions,
one model permit, one test permit and two worktree slots. The owned Qwen model digest remains
`1289b9ba3f4f06af094e6f09811c6c098af51dc315ebdc9dfd77582b999c89ee`.
No paid provider or additional infrastructure is used. No synthetic development goal joins this
natural schedule. Frozen parallel retains the historical planner and layer controller;
no-adaptation uses the current readiness controller and bounded ordinary repairs while refusing
graph revisions and final-goal revisions. No-peer removes both coordination and trail tools and
peer projection. All five paths retain independent final acceptance.

Current completion checklist:

- Original-cohort audit and interrupted-launch reconciliation: measured; historical records retained.
- B2, D6, G4 and V2 through V6: execution pending, with live measurements still required.
- G1: existing composition and package evidence identified; closure review pending.
- V7: local baseline passed; remote matrix, final build/package/fuzz and release-source checks pending.
- Integration and npm release: pending. Registry `14.0.2` already exists at
  `14eb4bfa61c710a45d9267fcf59e9a15057183a8` and is not this candidate. An unpublished version
  will be selected from the final compatibility diff. The historical local tarball will not be published.
- H2: conditional; the complete pilot bar and a successful supported external CLI remain unmet.

`completion-baseline-gates` passed at `88c5064d3` with an empty tracked diff. Actual summary:

```text
 Test Files  318 passed (318)
      Tests  3036 passed (3036)
   Start at  12:22:43
   Duration  130.56s (transform 9.47s, setup 0ms, import 21.65s, tests 993.30s, environment 16ms)
```

The command exited 0, reported no test skips, and retained 22 Biome warnings and one informational
diagnostic. Its complete output and command identity are in the external capture, digest
`sha256:9a37e8a5bb7d3a4dd020939dfb644a0262ae0fc44e22264a8effb459c1f5905d`.
This is baseline validation, not final integration or release evidence. Fetching all tags also
exposed an existing local/origin disagreement for `v14.0.0`; neither historical tag was overwritten.
Branch fetch succeeded separately with `--no-tags`.

### Completion reporting checks

`scripts/redesign/pilot-report.mjs` reads the frozen campaign and validates each settled
observation against its ledger outcome, manifest bytes and independent bundle verdict. It
preserves failed bundle verdicts. Campaign elapsed time includes the surrounding health
probes, while executor elapsed time does not; the report checks this relationship rather than
requiring the two clocks to agree. The reconciled interrupted slot retains unknown execution
time, separately from its original calendar time to administrative reconciliation.

The report keeps all 120 scheduled slots in the denominator, distinguishes observed incorrect
acceptance from unknown judgments, and keeps unknown usage, cost and human time explicit.
Model and command intervals are descriptive projections of recorded timestamps, not direct
measurements of CPU pressure or permit waiting. No evaluated worker or protocol changed.

The five reporting regression cases passed in `completion-report-bound-tests-v2`, based on
`7616cbbc0ab89ad6c2f0c1f41380bed31b598636` plus the captured patch, evidence
`sha256:db90db7f46cf10c6ec65a7073958f734f71912d83cc325c7faabef9e76a33499`.
The first eight settled slots passed raw-evidence validation in
`completion-report-first-batch-v3`, evidence
`sha256:bf89b4587f9953ab729fdecb67bd2b109d4078c2e43f67e1619141387cea930d`.
Its report digest is
`sha256:c820f56f2c6bd8c34cd931811c794685cef164481cb8fb5399585379072ee7ed`.
It explicitly reports `completeSchedule: false`. The earlier failed checks remain retained:
the first exposed the executor/campaign timing distinction; the second used an output
directory already created by the command recorder. Neither failure altered pilot observations.

### CI deadline measurement isolation

Push run [34881004809](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34881004809),
attempt 1, tested `7616cbbc0ab89ad6c2f0c1f41380bed31b598636`. Ubuntu gates and packaged
commands passed. macOS reported one deadline sample with 255 ms overshoot against the existing
250 ms bound; its separate 2% assertion passed. The complete failed output is retained in
`completion-ci-34881004809.zip` and `completion-ci-34881004809-failed.log`. Actual macOS summary:

```text
 Test Files  1 failed | 316 passed | 1 skipped (318)
      Tests  1 failed | 3020 passed | 15 skipped (3036)
   Duration  379.73s
```

The independently triggered PR run
[34881194271](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34881194271),
attempt 1, passed all three jobs on merge preview
`45c53130a1d901f2f491def48e7de103c458668a`. Its tree
`5dc7ba770d2b87a8f1f1b83026cf1ceac930644c` equals the feature head's tree. It used Node
24.20.0 and npm 11.19.0 on Ubuntu 24 and macOS 26 arm64. Ubuntu reported 318 files and
3036 tests passed; macOS reported 317 files passed, one skipped, 3021 tests passed and
15 skipped. The existing Docker-dependent cases account for the hosted macOS skips.
Both operating systems completed the eight fuzz harnesses; the packaged job satisfied all
19 documented command contracts. These are separate runs, not a combined passing total.
The full PR log is captured by `completion-ci-pr-full-log`, evidence
`sha256:8942e4035f64d55f7b313d475b73a3589c59d1466e6fd94f2296b9f05d769e4b`.

The deadline suite now runs in a later Vitest project after competing test processes finish.
This controls the measurement load without changing either deadline bound, cancellation code,
the supported matrix or the test universe. The failed measurement under concurrent suite load
remains a limitation; an isolated timing pass does not establish the same bound under arbitrary
contention. File collection before and after retained the same 319 unique files, including the
new reporting tests. `completion-ci-timing-targeted` passed all six deadline cases in 2.59 s
at `527dd134836dc9cae5810efae7d7436a551a459b` plus the captured configuration/test-comment
patch, evidence `sha256:a55f05c5a4bf5c3fc0400e8a6a993417d10cf02c67f004ad488cc6501c2af3c3`.
The full remote matrix must validate this change before integration. The frozen pilot checkout
does not use the changed test configuration.

### G1 closure: CLI, session and parallel composition

G1 is validated by the clean-source baseline at `88c5064d3` and CI run `34881194271` on
tree `5dc7ba770d2b87a8f1f1b83026cf1ceac930644c`, with the exact identities and complete
matrix results above. Its Ubuntu log separately records passing CLI option tests (74),
parallel composition tests (5), session-interface tests (11), CLI documentation tests (27),
verification tests (5), parallel-output tests (3), bond-report tests (6), session composition
tests (2) and command-definition tests (1). The parallel tests exercise administrative
cancellation, queued alternatives, explicit bootstrap and durable continuation through the
public command composition. Session child processes exercise lazy help discovery and two
buffered tasks through EOF. The separate packaged job checks all 19 public command contracts.
These results establish the declared extraction and behavior coverage, not universal CLI
correctness or a live pilot advantage.

The historical composition sessions were reopened and their chains and output digests agree
with the earlier entry. Their actual recorded source is `c17328b02f7593eb923abfcb20192e3433fe9050`
plus a patch, later landed as `e86fb82250c5a8f7f9c5bb3a4c05cf6f1ff7f234`. The earlier shorthand
"tested diff is commit" should be read with this qualification: known-pattern scrubbing replaced
benign `signingKey` and `keys` assignment expressions in the recorded patch, preventing exact
patch application. `completion-composition-source-audit` preserves that failed reconstruction,
evidence `sha256:74c6f85eb6b7b4e932246f253eac5943dbf9f8f120f686bafe2a7840b136f576`.
The clean-source baseline and newer CI, rather than a reconstructed historical patch, close the
source-binding gap. No credential detector rule was weakened.

### Completion release version

The completion candidate is `14.1.0`, with matching package and lockfile versions. The registry
already contains `14.0.2`, published from `14eb4bfa61c710a45d9267fcf59e9a15057183a8`; that
source is an ancestor of the remote default branch. Registry lookup for `14.1.0` returned E404
on September 14. A minor version reflects the added adaptive goal execution, bounded graph
revisions, resource controls and explicit bootstrap while retaining existing command options
and historical contract/evidence formats. No new dependency is required.

The candidate remains unpublished. The established tag-triggered publish workflow will run
from the integrated, validated source with npm provenance and the existing package name,
using the normal `latest` channel. Registry state and candidate identity must be checked again
immediately before publication. The older local `14.0.2` tarball is historical evidence only.

### Supplementary contention and replay protocol

The natural pilot retains its original source, 120 slots and limits. The following separate
measurements close questions that its fixed model/test concurrency cannot answer. They must
start after every pilot slot settles. They do not change pilot denominators, acceptance checks
or worker behavior, and no profiling output is used to repair a pilot candidate.

`scripts/redesign/profile-live.mjs freeze` records one clean source commit, the completed
campaign head, the unchanged local model digest and the complete measurement schedule. The
selected inputs are the first non-Python and first Python goals in frozen order, regardless of
their outcomes. The fixed limits are 24 model calls, 600,000 total reserved/reported tokens,
900,000 ms for execution and 60,000 ms for stopped cleanup. There are no retries. Each model
request uses the natural goal description, no tools and a 128-token output ceiling. The local
adapter retains its existing disabled thinking and zero provider retries.

Each measurement uses concurrency order 1, 2, 2, 1, giving two observations per condition:

- Model batches: four requests each, 16 calls total.
- Test batches: one declared test command on each of the two pinned baseline repositories,
  eight commands total. Dependency setup occurs once per repository and is timed separately.
- Worktree batches: two temporary Git worktrees of the same owned baseline copy, eight
  creations total. Each batch is cleaned before the next, with at most two temporary worktrees.
- Mixed batches: the same two model requests and one Node test command, first with one shared
  permit and then with separate model/test permits according to the fixed order. This adds
  eight model calls and four test commands.

The two prepared baseline repositories remain retained outside the workspace. Model and test
execution never exceed two simultaneous operations of either kind. Queue time, admitted
operation time, provider timing/usage, observed rate-limit responses, test outcomes, worktree
failures, host load and parent-process CPU are recorded. Parent CPU does not measure test-child
or container CPU. Persistent local-server caches, short prompts and two repetitions limit the
interpretation. Failures stay in their original batches. An interrupted batch or unconfirmed
runtime cleanup prevents further dispatch until actual effects and usage are reconciled.

`scripts/redesign/profile-replay.mjs` separately measures every retained launch's available
controller state, final model transcript, citation index, peer projection, ownership journal
and gate definitions. Seven repeated readings use the actual natural artifacts. Each journal
uses a new private copy for cold replay; 200 polls verify unchanged bytes, and append replay
uses the exact final historical entry on a private prefix. Original evidence is never changed.
Gate-definition assembly uses 1,000 assemblies per sample and never reuses a check observation.
This read-only pass has a 15-minute limit and no model calls. Missing artifact classes remain
unmeasured. It is a microbenchmark of recorded workloads, not a whole-run speed claim.

The pre-execution regression checks cover fixed resource ceilings, shared/separate permits,
retained failed activities, ambiguous resume and failed runtime cleanup. The earlier combined
report/profiler check passed nine tests in two files, evidence
`sha256:34665de9f9316a0e57a45fea733d7deea4a6196b3549df179cc89b111ed442dd`.
Live profiling and B2/G4 measurement closure remain pending at this entry.

### Recorded ablation-path audit

The reporter also checks the controller's recorded adaptation, peer-information and worktree
settings, the shared model/test declarations, and the actual tools in every worker prompt.
Single-worker and no-peer prompts must contain no peer tools. A no-adaptation run must contain
no graph revision. Missing configuration records remain named, including the historical
frozen-parallel controller, rather than being filled from the arm label.

At 21 settled slots, `completion-ablation-observations` passed these checks and the raw
observation/bundle checks. Evidence:
`sha256:2133e39066578b9ab092c6e784af56f7ffccbd45659e07cb220de8cbfc4f0800`;
report digest `sha256:4fa35e3bb3b51097aed0f40511e37e97c84a21a25b6da84fd9f7a76d3d5c1d6d`.
It measured 7,821,442 input and 127,743 output tokens, with zero unknown calls in those settled
slots. The original interrupted no-peer slot remains included with qualified unknown wall
time. There were 99 unsettled slot ceilings, including active work, at this checkpoint; the
conservative remaining ceiling was 59,400,000 tokens, with no outer retries.

The observed worker prompts were 54 single, 147 frozen-parallel, 56 adaptive, 78 no-adaptation
and 62 no-peer. Single and no-peer contained no peer tools. Frozen parallel exposed its legacy
`read_trail`; adaptive and no-adaptation exposed `read_trail`, `coordinate` and
`read_coordination`. This verifies distinct information paths; it does not establish an
ablation advantage. No graph revision had yet occurred in these slots. The reporter still
marks the pilot incomplete and makes no superiority claim.

### Original cohort withdrawn after final-verifier mount failure

The earlier suitability audit missed a controller-specific checkout path. On September 14,
the resumed Day.js observations showed that sealed final verification installed dependencies
inside a container mounted from macOS system temporary storage. Colima did not share that
directory. The container saw an empty checkout, and `npm ci` refused the missing lockfile.
Held-back verification explicitly selected the shared scratch root and did not have this
fault. These infrastructure refusals cannot establish agent performance.

`completion-verifier-mount-probe` independently observed ENOENT under `/var/folders` and
successful access under `/Users`, using the pinned Day.js image. Capture digest:
`sha256:56866bbccb2646c21056991ff61acf35d3301bc80ea0974d2744da200b5bb726`.
The original runner was stopped with SIGINT; no original record or candidate was deleted.
It retained 31 terminal slots, including the cancelled in-flight slot, and 89 unlaunched slots.
The complete resume command exited 0, which describes runner termination, not goal acceptance:
`sha256:723ee981c68b88d27a64c61eb8f7451e93e98989115a73c1fb537e0142b7077b`.
The original four observations, interrupted fifth observation and continuation all remain in
the original cohort. None will count toward the replacement cohort's 120 slots.

The controller now passes its configured scratch root to the existing independent verifier.
A new regression runs actual repository and withheld acceptance commands through a backend
that rejects checkouts outside that root. It rejects the control commit and accepts the repair
in separate fresh checkouts. Before the fix, it failed at the path boundary
(`sha256:7e65be7bb732b63ef0c33c78c4ddb44516163120f5dc7e1523ae37bd2a547b63`).
After the fix, this regression and the existing pilot-driver tests passed: two files, seven
tests (`sha256:513895f4465267a6bae74a1f2f4c4e28f0f67ae0d2c3a4b6f9321b00f00f1d89`).

Full gates on source `01529a64b8911f9a7f8d6f6c285b7678eb12bf14` plus the recorded
controller fix and regression patch exited 0. The report paragraph itself followed that run.
Capture `completion-verifier-fix-gates`,
`sha256:f9d8b1c29be641f3154e172d0f63fc16a72457f08a28e2d542ce0fb405170fff`:

```text
Found 22 warnings.
Found 1 info.
 Test Files  321 passed (321)
      Tests  3048 passed (3048)
   Start at  13:45:48
   Duration  132.04s (transform 9.59s, setup 0ms, import 21.02s, tests 965.46s, environment 16ms)
```

There were no failed or skipped tests. Full stdout and stderr remain in the capture. B2, D6,
G4 and V2 through V7 are still open; this fix does not close their measurements. The replacement
will use a clean fixed source and unchanged acceptance instruments after a bounded real
controller preflight: 24 controls and 24 references, no model calls, no retries and a 96-minute
total wall cap. Its initial model schedule has a maximum of 72,000,000 tokens and 30 hours,
plus a separately bounded two hours of cleanup. Actual prior usage remains separately charged.

The stopped cohort also exposed a numeric `reservedTokens` field scrubbed into a redaction
marker. Standard campaign replay correctly refuses that malformed record. Failed report capture
`completion-original-pilot-stopped-report` is retained at
`sha256:686bec8094b1fd95b053b80d4941cc7f9776bb228dfdbbbfb9e259d04d865613`.
That separate metric-name defect must be resolved before the new freeze. Historical bytes will
remain unchanged, with any lost measurement reported as unavailable or independently reconciled.

### Preserve outstanding reservation measurements during evidence scrubbing

The shared detector's exact metric-name table now includes `reservedTokens`. This is an
accounting quantity, including when cancellation leaves a large outstanding reservation.
The credential-name policy, four-character floor, structural JSON rules and accepted residuals
remain as specified in build guide section 7.1 and archived invariant 9. A nearby credential
name, `reservedApiToken`, remains scrubbed and blocking for the same numeric value.

A real campaign replay regression records a cancelled outcome with 600,000 reserved tokens
and one unknown call, reopens the on-disk session, and compares its complete report. It failed
on the prior source with the same Zod error seen in the original pilot
(`sha256:3173f7073429e5b2f436af5d3acdcf1529712c31ec7e3ae5ff1ac35014840849`).
With the name correction, three files and 59 tests passed, including shared scrubbing and child
environment regressions (`sha256:25955e0ddce2e42964ca84e6e3ad360622b7443c8cc688fff363f33f3e3b25db`).
Typecheck and targeted Biome checks passed. These captures bind source
`57f0dd1bc97ec3bd546688439d6a31effc68f85f` plus the recorded fix and test patch;
this evidence paragraph followed those checks. No historical payload was changed or replayed
with a guessed reservation count. The replacement freeze includes this evidence behavior fix.

### Replacement cohort identity and prior usage

The existing pilot freezer now records a cohort generation and predecessor identity in its
manifest and protocol digest. A replacement requires an explicit withdrawal on the old chain,
unchanged goal and evaluator bytes, the original model identity and resource settings, and
harness-captured controller preflight results for every control and reference. Duplicate,
missing, altered and failed preflight rows are rejected by regression tests. This changes
freezing and reporting; it adds no scheduler or model-selection behavior.

The original cohort withdrawal is recorded at chain head
`sha256:d82e8204161177c988c47935f922e5e30a17d435639e80394c5bc6b89fb49493`,
sequence 215. Capture `completion-original-cohort-withdrawal`,
`sha256:c093e74743fe63993629307d8cc398709dce5fae63774cb5ff487fb333508561`,
preserves all 31 terminal outcomes and names the 89 unlaunched slots. They reported
10,891,973 input and 165,608 output tokens, with one unknown call. The outstanding reservation
is independently recorded as 88,254 in controller payload
`sha256:4e866e7cf0371e236a91ac6c2cdd18467390157b6244c9690e8dd206c5658b36` and
agrees with raw observation `sha256:c769bf59c883bf63fee63636f7281e807320fde64399918a494f4c8d3de70ac3`.
The report projects that quantity with both references. The original malformed settlement
remains intact and ordinary campaign replay still refuses it.

The 31 launched original slots had an authorized ceiling of 18,600,000 tokens. A complete
replacement adds 72,000,000, and the separately declared live contention profile adds 600,000:
91,200,000 tokens across these schedules at their maximum per-slot allocations. This is a
resource ceiling, not measured usage or provider billing. The one unknown call remains unknown;
an outstanding reservation is not counted as additional reported usage. All model execution
uses the same existing local weights. No paid fallback or infrastructure purchase is authorized.
Intervention purposes are recorded, with unavailable human repair minutes left null.

Replacement-boundary and report regressions passed: two files, 13 tests in 11.93 seconds,
capture `completion-replacement-final-targeted`,
`sha256:cd0fbb7b38a1aaf27b586f7cac5897c613353fcc380e510b4e4246dee50c4b37`.
This binds `44867ea13186feaf48c78213d43ce3feffad412f` plus the captured freezer, test
and documentation patch. The preflight and replacement schedule were still running or unlaunched
at this checkpoint; this entry claims neither completed validation nor pilot acceptance.

### Repair Click's test temporary directory before the replacement freeze

The first controller preflight completed 36 observations, then refused the Click control because
repository checks left an unexpected tree. It exited 1; capture
`sha256:697cb5e39130f38d185a7e3750fb134a56fc41f3b239848f05ed26cfa556beb9`.
The pilot command precreated `.pytest_cache`, so pytest skipped creating its own ignore file.
Editor and pager fixtures and pytest scratch files then appeared as candidate additions.
The pinned image's installed pytest implementation confirms that early return, captured in
`completion-pytest-cache-source`,
`sha256:45ef04f73e2ed0d33c9d64f3bf517c5fbe8675ad4da9b8fca811932a44aac864`.
Both original Click control and reference were refused in the full-output diagnostic,
`sha256:8fe7ffd11997dcc53dbdde32a99000ace9df104c2550218ee46a12b1ac1d2432`.

The pilot now puts temporary files in Click's already ignored `.tox/swarm-tmp`, leaving pytest
to initialize its own cache. No test, check, assertion or acceptance artifact is removed or
weakened. A command-level regression verifies that the cache has not been precreated and that
both editor and test scratch files are ignored by Git. Its before-fix filtered run had one
failure and seven tests not selected, reported as skipped by Vitest
(`sha256:86980e94b5b4991859aed780db29548fa1f5fbcda55380a4a7a8c4842f95eed3`).
After the fix, all eight pilot-driver tests passed in 9.62 seconds
(`sha256:78470db7ba2f5d97a0a5a3050c13c331dd3cd775a1e632d28253a66202b5f94e`).

Real controller validation then rejected all three unchanged Click controls and accepted all
three historical references. Typecheck, lint, format and repository tests passed for all six.
Capture `completion-click-controls-fixed`,
`sha256:87bec19d83cd31093379b0baa77e00eccf89d9f46f677cee99960cc25e4bcc17`,
took 36,777 ms and binds `5b31160e1e207d0058b777c327651a5dee37d65a` plus the recorded
Click command and regression patch. This documentation followed that measurement.

One initial Koa reference had a repository test failure despite accepted goal checks. A direct
diagnostic passed all 452 tests, and a fresh controller diagnostic rejected the control and
accepted the reference with all 452 tests passing. The initial failure remains unreproduced;
its individual failing-test output was not retained by the original final verifier. The fresh
diagnostic retains full command output. Its process later failed before Click dispatch because
monitoring opened future evidence sessions and created empty directories. That observer error
is recorded at `sha256:5ffffae14e7469266b403de1e586971d86d40127f52ee16f030d358585b0cc33`;
the empty directories and successful Koa records remain preserved, and Click used a new root.
These are validation interventions, not additional model attempts. Their human minutes are unknown.

Before this pilot-only command fix, clean source `5b31160e1e207d0058b777c327651a5dee37d65a`
also passed full gates, build, 19 packaged command checks and eight fuzz harnesses with 84 seeds.
The full gates capture is `sha256:939954066fa020157b64e5afae7b7e2966aeab6cd1dd3348d70ea3bc8b960b75`:

```text
 Test Files  321 passed (321)
      Tests  3050 passed (3050)
   Start at  14:08:32
   Duration  136.77s (transform 11.27s, setup 0ms, import 24.57s, tests 1026.03s, environment 18ms)
```

No failed or skipped tests; 22 Biome warnings and one information diagnostic remained unchanged.
Build, packaged and fuzz capture digests are respectively
`sha256:74764786f5e1325cd87a5a8670535544289e5d5941d7309412740f0fc5e1828c`,
`sha256:45814366a1d9a7eac4aedbd2e48ef6a37385cc5e9c4fb1d734fabe142bf91fc4` and
`sha256:8efcd96d7191cfad1268f14cd25721b13fbd7641977f90ddfca4ca315e62ffc5`.
The archive review also byte-compared the original 25,878-byte policy and all 18 archived
transcripts, 1,346,516 bytes, against their recorded commits; every byte matched
(`sha256:3f25ef512cc019973780100704ae868d54d2b91370477ea5ef673d6065a57ae9`).

### Replacement cohort 2 launched on the validated source

The full preflight now contains 24 rejected controls and 24 accepted historical references,
with 53 attempted checks retained, including the original failures and diagnostics. Each row
names its source commit, captured patch, harness record and raw artifact digest. The source
comparison permits only the explicit reservation metric change, tests and the Click-only test
scratch correction; every selected Click observation uses the corrected command. The first
consolidation refused an unsanitized raw-payload comparison. The corrected comparison applies
the same shared write-time scrub and matches the recorded digest, preserving both representations.
Capture `completion-preflight-consolidation-verified`:
`sha256:16babe79fbfaf30ee35b15ed7df8ecfb4539d28926711a5e5f6ca5af0259aebf`.
Report bytes: `sha256:6c807b1b5978798b504e13a6c96c5c91c65405d6922edf83a9064b781692aa7e`.

Clean source `87d7ef0854e22de12042d190188578f606ae9aa7` passed `npm run gates`,
capture `sha256:9a03828eac3c024baa08926cf5a3c2559d5d230c980146afd57e734d634dd5d6`:

```text
 Test Files  321 passed (321)
      Tests  3051 passed (3051)
   Start at  14:16:36
   Duration  133.72s (transform 10.48s, setup 0ms, import 23.29s, tests 1003.90s, environment 16ms)
```

No failed or skipped tests; the existing 22 Biome warnings and one information diagnostic remain.
The freeze capture is `sha256:036940187e308f6f9453ac6d276a30afa46821d36273a6fc0f3d68d7deafe4e4`.
The replacement identities are:

- Source: `87d7ef0854e22de12042d190188578f606ae9aa7`.
- Manifest: `sha256:ea431de331175e31750d347169b2131ea350e2e8ba5f42cdf2006c50c6caedd2`.
- Protocol: `sha256:9d82eb08b3782cd0426e16178291b554ef18cd38b779d6409435de0af01b9569`.
- Cohort generation: 2, explicitly replacing the withdrawn original manifest and chain head.
- Storage: `/Users/brad/.cache/swarm-redesign-pilot/frozen-pilot-replacement-2/`.
- Clean execution checkout: `/Users/brad/projects/swarm-redesign-pilot-replacement/`.

`completion-replacement-pilot` runs durably with a streamed log and the existing campaign resume
ledger. It has 120 initial slots, no outer retries, 600,000 tokens and 15 minutes per slot,
one model permit, one test permit and two worktree slots. Each slot retains the original two
repair attempts, four graph revisions and one minute of separately bounded cleanup. The local
model and weight digest are unchanged. No original observation is transferred into this cohort.
This evidence-only update follows the frozen source and does not alter its evaluated behavior.

### D6 exploratory comparison rubric

The D6 reporting rubric is separately recorded at
`sha256:75992d46e79bf0e0e1a14ef9640f35b1178924802c57e6cab08fb71e2245739b`,
with rubric digest `sha256:b5db8973a34cdcc9b984d6c0ed86e2ef9b58fbedf7466fdbe6fa17376d1a0717`.
Two replacement slots had settled when the declaration was written. This is exploratory work
after the withdrawn observations and early replacement execution, not a change to the primary
analysis or a claim of prospective statistical testing.

Normalized reference patches identify nine tiny goals, at most 20 production-line additions
plus deletions in one source file, and 12 single-file goals. Tests, declaration tests, examples,
benchmarks and documentation are excluded from that source count. Four coupled goals are named
with explicit API reasons: Commander 1678 and 2006, ts-pattern 253, and attrs 4b5b295b. Groups
overlap and are reported separately for each comparison arm.

Paired complete-goal acceptance takes precedence. Two accepted attempts are compared by wall
time and reported input/output tokens; a preference requires dominance in both with at least
one strict improvement. Tradeoffs, two failed goals, unknown usage and infrastructure failures
remain separate outcomes. Repeated slots require a declared aggregation and cannot silently
select a favorable attempt. No universal threshold or additional confidence interval is claimed.

The existing pilot report includes this analysis through one focused reporting module. Two
reporting test files, nine tests, passed in 601 ms, capture
`sha256:9c357483c26667fc9eee260107049844db32ccae4e50ab89dc153fd1818ba9ad`.
This binds source `3ddb11152f144542bbb2293e5f24b8a59e3d0731` plus the recorded reporting
patch. No evaluated controller, model configuration, arm, check or budget changed.

### Replay profiling correction and authorized checkpoint push

Review before live profiling found that the replay script compared reconstructed prompts with
`payload.promptDigest`. Model-call recording stores that identity on the ledger record.
The profiler now checks `record.promptDigest` for both inline and component transcripts and
refuses a changed digest. The regression test records real harness fixtures and failed for both
storage formats before the correction, capture
`sha256:03a8b02e5f071cc3fcb5a9589ff87b94ff54a14f87bab18e5f653a408866e9e1`.
The two profiling test files then passed all seven tests in 519 ms, capture
`sha256:24162367fb2761b83dd9f7c38164104f5dade7a80329cd7a1909aff853e16ecb`,
bound to `559d48786223780849e41ee238816def45c1da63` plus the recorded patch. Formatting
was corrected afterward. This changes only supplementary measurement code; the frozen pilot
source and its running processes are unchanged.

The user explicitly permitted the existing administrator exemption for normal pushes and
merges. The normal feature-branch push of `559d48786223780849e41ee238816def45c1da63`
succeeded, capture `sha256:20667ba81b15fa98821a97044dd0a0dd664b3d5cb1b6d5071c274de53194d794`.
GitHub reported its existing protected-ref exemption; no rule was edited and no force push was
used. Push run [34894749621](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34894749621)
and PR run [34894753805](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34894753805)
started on that head. Their packaged jobs passed; platform gates were still running at this
checkpoint. Integration and publication remain unfinished.


### Replacement pilot and supplementary profiles measured, September 14

The replacement cohort completed all 120 scheduled slots. Its evaluated source is
`87d7ef0854e22de12042d190188578f606ae9aa7`, with manifest
`sha256:ea431de331175e31750d347169b2131ea350e2e8ba5f42cdf2006c50c6caedd2`, protocol
`sha256:9d82eb08b3782cd0426e16178291b554ef18cd38b779d6409435de0af01b9569`, and campaign head
`sha256:038973c31e47200158597e502a2191b9ef524cb385a9360bbbb25bf2bd315225`. The complete report
is [replacement-pilot-report.md](evidence/2026-09-14/replacement-pilot-report.md). Its JSON
digest is `sha256:9f523cf12587bcc8ce0c89fe8017e62809fd6ef8b214e6161bd44b2bda03b6ae`, captured by
`completion-replacement-final-report-2` (`sha256:b467182d8d72bf6b89c24e29530ab5ae2978add72ad0f91eceb874cc1349abf9`).

All five arms launched and settled 24 slots each. Single-worker had one independently accepted
goal; the other arms had none. There were 81 completed, 29 crashed and 10 budget-terminated
slots, 39 unknown judgments, 49 retries and five integration repairs. Observed incorrect
acceptance was zero. Provider cost and unlogged human time are unknown. The comparison is
failure-censored and ineligible for confirmatory analysis; no swarm advantage is claimed.
The reporter verified distinct adaptation and peer ablations, retained missing and malformed
records, and kept synthetic development cases outside the natural denominator.

The live contention profile was frozen from `ace0f359b90144029dc13eb81660f27d3980c129` and
completed 24 model calls, eight tests, eight worktree operations and four mixed batches under
concurrency order 1, 2, 2, 1. All 16 batches completed. Capture
`completion-profile-live-run-1` is `sha256:14f28f80c1feba83ce1b6e7b4c0b98ee1a60ce5e7d9414347d1e2783e7d9bae0`; result
head is `sha256:0bf442cde76facdf805e3732035dfc912f63f836ca6e40cf1ea440a9cd4465bb`. This closes
B2 and the live contention part of G4.

The replay profile used `bd6b481a65cccc2da08333a86eb27bfbede3cd31`, seven repeats and no model
calls, producing 1,430 measurements. Capture `completion-profile-replay-2` is
`sha256:d48b994b0339b91ef0330714794eb50f7b530fae4091056103d1b6cf6f4d53d7`; result digest is
`sha256:554d6eeb3f9dd67aeacd1e6c09d76bb46750021d1703c2db15d6543d152f2b18`. Three malformed
controller graphs remain unavailable with their exact digest errors. This closes the retained
replay portion of G4.

B2, D6, G1, G4 and V2 through V6 are now measured or validated as described in the report.
V7 is validated by the integrated release tree's final Ubuntu/macOS CI, build, package, fuzz and
registry installation evidence. H2 remains conditional because no approved supported external
CLI with usable local or already-authorized execution is available.

### Integrated default branch and 14.1.0 registry release, September 15

PR [#73](https://github.com/moonrunnerkc/swarm-orchestrator/pull/73) merged the validated
implementation branch into `v13-main` with merge commit
`caf960bc787e12bbba47d4f3e9720ebd8a8d4b4d`. Subsequent documentation-only evidence commits,
including `daffefb6dbbf22b54996b5dd1fac700ada2fe01d` and the current record, are on
`origin/v13-main`. The merge preserved the small implementation commits and used the existing administrator
exemption for the repository's active `restrictdelete` ruleset. No force push or ruleset change
was used.

The merged source passed the required local checks in a clean worktree: gates capture
`completion-merged-gates-caf`, evidence `sha256:3b7f44b1fbc0bf4c2099849e99e00541e71289fb13dd981255ec1d7c49a3f9d3`; build capture
`completion-merged-build-caf`, evidence `sha256:aeb3d389a067605267e426155ff8f9f83e6407ba90e122c19fc5b0fafbd9d2cb`;
packaged command capture `completion-merged-packaged-caf`, evidence
`sha256:033c49c7c5089b4d42fe5d3e2f13bfc99b324017041569c68bc0cfea100de004`; fuzz capture
`completion-merged-fuzz-caf`, evidence `sha256:848995ef33e9b66b6f61b2c0cdc451711afc588db58372990d3d962c1ee67751`;
and package capture `completion-merged-pack-caf`, evidence
`sha256:e7dd4f08a2b3f08452a077c1a385814cea8a1436ec3e20af7f0727fd04d18799`. The merged
artifact contains 641 entries, nine build assets and no credential-like files. Its local tarball
digest is `sha256:2499bbcbd1a5996ceda5cdf4c43fe3369869c836430a3027f2bfcef285522495`, with
inspection capture `completion-merged-artifact-inspect-caf`, evidence
`sha256:7446955e7326d6da47ea87fff249a188d382efa1205804da0fe8462cb11b2e77`.

The exact merged source passed the feature PR and push CI matrix. PR run
[34916224868](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916224868) and
push run [34916219577](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916219577)
both passed their packaged, Ubuntu and macOS jobs. Earlier runs on intermediate commits remain
historical and are not reused as final evidence.
The preceding documentation-only push at `daffefb6dbbf22b54996b5dd1fac700ada2fe01d` had
packaged and Ubuntu success but one macOS adaptive-repair call-order assertion failed in run
[34918247401](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34918247401). No
source behavior changed; the final push at `12fc15eb341893534e9996b0697f2af4d4f1f052` reran
the complete matrix in run
[34918984560](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34918984560),
with packaged, Ubuntu and macOS jobs all successful.

Tag `v14.1.0` points to the merged commit and was pushed normally, capture
`completion-release-tag-v14.1.0`, evidence `sha256:b62c46c61ebb44cd9c276b60f350be655efbbc39904c13936dd5856611a6f469`.
The normal release workflow [34916998130](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/34916998130)
published `swarm-orchestrator@14.1.0` with provenance. Registry metadata reports gitHead
`caf960bc787e12bbba47d4f3e9720ebd8a8d4b4d`, shasum
`9dd37a74fd5cfc6c412b851b6cb03e420a63663b`, and integrity
`sha512-o7dNkJBfIlc7duMMGRGfUcKHIpE3qWI6QM3f89dhpU5clh+lUCJAgPW0LY8RSvPZ3Rqo8Ggek6OxAKAzWGtJhQ==`.
The fetched tarball matched that integrity, capture `completion-registry-integrity-14.1.0`,
evidence `sha256:91fb7dbdd796fbc7b68b3f4c26297b205d5a63e7226097044f28a18588aa461a`. A fresh
temporary consumer installed exactly 14.1.0 from the registry and exercised its public CLI,
capture `completion-registry-install-14.1.0`, evidence
`sha256:a5eb8c03da54a0026f781faf66553c1a9835c2eeab161f809b808a70a45ede97`.

Release [v14.1.0](https://github.com/moonrunnerkc/swarm-orchestrator/releases/tag/v14.1.0)
retains the report, manifest, profiles and split campaign archive assets. The eight archive parts
were downloaded and reassembled byte-for-byte against the retained local archive, verification
capture `completion-release-assets-verify-2`, evidence
`sha256:e24e0a52183429ae1ba6f2cdfdf06330c2a7268d2390bbf2b087a11904993bc8`.

The replacement pilot was evaluated on `87d7ef085`, while the package and release were built
from merged source `caf960bc7`; this distinction is retained. The final documentation commit is
an evidence update after the release tag and does not relabel the pilot or require republishing.
H2 remains conditional because no approved supported external CLI with usable local or already-
authorized execution is available and the adaptive pilot bar is not met.
