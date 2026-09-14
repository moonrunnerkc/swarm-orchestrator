# Adaptive goal controller implementation, September 13, 2026

Status: implementation delivered on the review branch. Complete-goal behavior is established by
development and integration evidence; no performance advantage or universal correctness is claimed.
This record tracks the entire approved redesign, including empirical work that code alone
cannot complete. The September 11 audit record remains historical evidence.

## Baseline and authorization

Source: `a950d1bd51474ec24ec647c3fd9ed3c003dc93b8`, initially clean `v13-main`, origin
`https://github.com/moonrunnerkc/swarm-orchestrator`. Implementation branch:
`redesign/adaptive-goal-controller`. Node v24.15.0, npm 11.12.1, macOS. `v12-final` is present.
No historical reset, unrelated edit, paid call, push or publication was authorized by this work.
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
| B2 | Separate worktree, model-call and test-process limits | separate worktree cap and FIFO model/test permits, cancellation tests; contention measurement remains M4 | implemented |
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
| D6 | Prefer one worker for tiny/coupled work | Tiny/coupled planner guidance and collapse are implemented; six live development cases and the paired pilot distinguish scheduling behavior from an advantage | implemented |
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
| G1 | Extract CLI/session/parallel composition and common settings/outcome | focused handlers and shared settings, ledger-derived output; child-process command and buffered session checks | implemented |
| G2 | Shared immutable verification setup, independent trust and known-answer tests | Controller verification shares immutable setup; fresh checkouts and independent hash/signature/verdict known-answer tests remain separate | validated |
| G3 | Harness routine claims, smaller optional vocabulary; compare before default change | Harness receipts and optional small claim vocabulary; six exposed prompt-comparison launches were inconclusive, so the default remains unchanged | validated |
| G4 | Profile journal, polling, transcripts, peers, checks and contention first | fixed fixture profiles and preserved reconstruction; live model/test contention remains | partial |
| G5 | Warranted incremental processing, exact reconstruction, cross-process visibility | Measured incremental journal parsing retains full-byte hashing and cross-process visibility; corruption and exact transcript tests pass | validated |
| G6 | Immutable check reuse, observations rerun after relevant changes; unknown disables cache | Immutable gate definitions reused; all final observations rerun. Fixed-fixture transcript/peer/check timings did not justify observation caches | validated |
| G7 | Final blocking checks mandatory, remove duplicate workflow calls, explicit corpus setup | gates workflow retains Linux/macOS and fuzz, packaged job; duplicate invocations removed and v12-final prerequisite checked in M0 | validated |
| G8 | Consolidate policy and archive narrative losslessly, meaningful weight gate | Canonical generated policy, lossless historical archive and 18 transcript offloads; byte restoration, drift and cited-bundle gates pass | validated |
| G9 | Goal/blocker/resource/acceptance/branch output, detailed features accessible | Goal, blockers, resources, acceptance and branch views share a projection; all 19 legacy commands passed the packaged composition check | validated |
| G10 | Learned routing stays experimental pending matching evaluation | Learned routing remains opt-in and experimental; no pilot claim or default promotion | validated |
| H1 | External transcript/patch import and honest unavailable provenance | existing importer, historical bundle, signer and tamper fixtures remain in full gates through goal-selection milestone | validated |
| H2 | Concrete external CLI driver only after pilot bar and supported CLI availability | conditional prerequisites, no driver claim before both hold | conditional |
| V1 | Six development goal classes, valid fixes and omissions | Six frozen synthetic development goals accepted with offline-verifying bundles; one exposed repeat also exercised a valid dependency revision | validated |
| V2 | Freeze 24 goals, at least eight repositories, JS/TS and Python, multiple categories | Protocol v2 froze 24 public-history goals across eight repositories with all 15 Node and nine Python instruments admitted. Only four of 120 launches produced observations before the local execution window was stopped. | partial |
| V3 | Single with repair, frozen old parallel, adaptive, feasible competitor | Single, frozen historical parallel and adaptive arms ran under the frozen protocol. The frozen arm recorded a shared-budget admission crash; the local Loom canary did not complete within its timeout and no paid provider was available. | partial |
| V4 | Adaptation and peer ablations, repeats correlated, natural/synthetic distinct | No-adaptation began and was cancelled at the same budget admission boundary; no-peer and full ablation totals remain unobserved. Synthetic development cases remain separately labeled. | partial |
| V5 | Wall/tokens/cost/completion/incorrect acceptance/human burden/retries/recovery | Campaign schema records wall time, reported and unknown usage, failures, cancellations, retries and retained work. The partial run is insufficient for comparative estimates or human-burden conclusions. | partial |
| V6 | Available authorized local models, no new paid commitment | Owned local Qwen weights executed the six development cases and pilot arms. No paid calls were made. The complete paired evaluation remains unfinished. | partial |
| V7 | Full gates, build, packaged CLI, fuzz, evidence and supported platforms | Final gates, build, packaged command contracts and fuzz passed on macOS at `f971b53594b6ef63d747074a739655ff0e765414`; Linux and other CI platform checks were unavailable locally. | partial |
| R1 | README, usage, CLI, build guide, ADRs, instructions, changelog, examples | README, usage, CLI, build guide, ADR 0009, synchronized instructions, changelog and implementation examples describe complete-goal and adaptive recovery behavior. | validated |
| R2 | Tested coherent commits, installable release candidate, exact push/CI/release status | Coherent commits and package checks are complete; final dry-run tarball and branch status are recorded below. No push, CI run or registry publication was authorized. | validated |
| R3 | Final audit against entire appendix, explicit remaining blockers | This map records every mandatory implementable item and names the incomplete empirical pilot and unavailable platform/competitor checks below. | validated |

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

The final committed source is `f971b53594b6ef63d747074a739655ff0e765414` on
`redesign/adaptive-goal-controller`. `redesign-gates-final-4` exited 0 with 318 test files and
3036 tests passed, no skips, in 150.32 seconds. Biome retained the baseline 22 warnings and one
informational diagnostic. The capture digest is
`sha256:8c48d1c4e9eebf42111bf14eaaf579d4973dd248c2e3388971415bda529654f2`.

The committed-tree build exited 0 and copied nine assets, digest
`sha256:29752d4d95d064a743147123e871a4e716bf34c87a9a3baae3ee09d4f4ef625d`. Packaged command
contracts exited 0 for all 19 documented commands, digest
`sha256:1730a636ac237de0dec5b26d8793ae1c571c60c18671de0a77f20c20b2295f65`. Fuzz smoke exited 0
with eight adapters and the declared seed counts, digest
`sha256:26911d7860ed7f92e45ec648adf0926a4c7e2089cfe9894f9c0603803e1b8027`. A local release
candidate tarball was generated with `npm pack --dry-run`; it was not published. Linux, macOS CI
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
