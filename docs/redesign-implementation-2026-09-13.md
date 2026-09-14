# Adaptive goal controller implementation, September 13, 2026

Status: implementation in progress. No complete-goal or performance advantage is established.
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
| B1 | Run context before planning; all activities share cancellation and budget | context precedes CLI planning and wraps provider calls, tests and final verification; planning cancellation tested; recovery open | partial |
| B2 | Separate worktree, model-call and test-process limits | separate worktree cap and FIFO model/test permits, cancellation tests; contention measurement remains M4 | implemented |
| B3 | In-flight input/output reservation, measured settlement, failed and unknown usage | reservation races, settlement, failed/unknown usage and original deadline restart tests | validated |
| B4 | Stop dispatch, separately bounded cleanup, durable parallel lifecycle | cancellation and recovery integrations | open |
| C1 | Failed integrated checks, conflicts and relevant ratchet failures start bounded repair | three real-worktree synthetic repair cases pass through the public runner | validated |
| C2 | Retain rejected attempts and reachable commits; reuse failure context | rejected Git refs retained; accepted peer executes once in repair tests | validated |
| C3 | Revalidate repair and combined tree, one final task outcome | repair and integration checks followed by exact-tree independent goal checks; final outcome tests | validated |
| C4 | Repeated failure fingerprints and limits, exact blocker and partial work | repeated patch/base/reason fingerprint and attempt cap; blocker test passes | validated |
| D1 | Readiness scheduling, one integration writer, actual integration base | dependent starts while unrelated worker runs | open |
| D2 | Versioned bounded revisions: prerequisite, split, combine, reroute | cycle/reference rejection and overlap serialization | open |
| D3 | Preserve requirements/history, invalidate affected acceptance | revision omission and changed-dependency tests | open |
| D4 | Base/revision identity and stale candidate refusal | late worker after integration/revision change | open |
| D5 | Typed bounded proposals, relevant deltas, provenance, independent alternatives | event projection and tool-path regressions | open |
| D6 | Prefer one worker for tiny/coupled work | no-op, single-file, over-decomposition cases | open |
| E1 | Independent final acceptance at exact integrated tree | fresh independent checkout with exact Git tree check; locally green omission refused | validated |
| E2 | One authoritative CLI/exit/TUI/export assessment, distinct trust dimensions | CLI and plain progress report consume exported controller assessment; TUI and recovery remain | partial |
| E3 | User checks and recorded candidate checks protected from worker writes | user and planner-authored candidate checks, immutable artifacts and authorship regression; bootstrap open | implemented |
| E4 | Preserve strict reference/control package and human judgment gaps | strict reference/control path and existing corpus remain green; uncovered requirements unjudged | validated |
| E5 | Explicit empty-repository bootstrap before acceptance pinning and implementation | bootstrap end-to-end fixture | open |
| E6 | All obligations eligible before goal ranking, declared objective; legacy comparator retained | omission ineligible despite test volume | open |
| F1 | Journal replay and reconciliation of attempts, usage, candidates, trees, integration, resources | crash/restart around each effect | open |
| F2 | Original remaining budget/policy, no duplicate landing or ambiguous replay | restart and accounting tests | open |
| F3 | Intent before effect, completion after; preserve torn/altered history | crash at journal boundaries | open |
| F4 | Verify ownership before cleanup, retain user and other-session resources | cleanup ownership negatives | open |
| G1 | Extract CLI/session/parallel composition and common settings/outcome | parallel handler and common settings extracted; session extraction remains | partial |
| G2 | Shared immutable verification setup, independent trust and known-answer tests | verifier/signature/hash parity and independent fixtures | open |
| G3 | Harness routine claims, smaller optional vocabulary; compare before default change | prompt success and usage comparison | open |
| G4 | Profile journal, polling, transcripts, peers, checks and contention first | fixed fixture time/space measurements | open |
| G5 | Warranted incremental processing, exact reconstruction, cross-process visibility | corrupt history and exact prompt tests | open |
| G6 | Immutable check reuse, observations rerun after relevant changes; unknown disables cache | content/environment identity tests if caching is warranted | open |
| G7 | Final blocking checks mandatory, remove duplicate workflow calls, explicit corpus setup | complete scripts and CI review | open |
| G8 | Consolidate policy and archive narrative losslessly, meaningful weight gate | drift, restoration and cited bundles | open |
| G9 | Goal/blocker/resource/acceptance/branch output, detailed features accessible | public command fixtures | open |
| G10 | Learned routing stays experimental pending matching evaluation | existing routing authority tests | open |
| H1 | External transcript/patch import and honest unavailable provenance | historical import compatibility | open |
| H2 | Concrete external CLI driver only after pilot bar and supported CLI availability | conditional prerequisites, no driver claim before both hold | conditional |
| V1 | Six development goal classes, valid fixes and omissions | missing dependency, interface, behavior, conflict, interruption, over-decomposition | open |
| V2 | Freeze 24 goals, at least eight repositories, JS/TS and Python, multiple categories | source/acceptance/budget/stopping/order identities before launches | open |
| V3 | Single with repair, frozen old parallel, adaptive, feasible competitor | same verifier, exposure and budget; disclose comparability | open |
| V4 | Adaptation and peer ablations, repeats correlated, natural/synthetic distinct | all launches/failures/timeouts/admission/unknown retained | open |
| V5 | Wall/tokens/cost/completion/incorrect acceptance/human burden/retries/recovery | overhead included; uncertainty, no held-out tuning | open |
| V6 | Available authorized local models, no new paid commitment | runnable infrastructure is not empirical completion | open |
| V7 | Full gates, build, packaged CLI, fuzz, evidence and supported platforms | actual final output bound to commit; unavailable separately | open |
| R1 | README, usage, CLI, build guide, ADRs, instructions, changelog, examples | complete-goal and adaptive recovery reproduction | open |
| R2 | Tested coherent commits, installable release candidate, exact push/CI/release status | package contents and installed behavior | open |
| R3 | Final audit against entire appendix, explicit remaining blockers | all mandatory implementable rows closed before completion | open |

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

The first full recovery gate run, `m3-recovery-gates`, exited 1: 299 files and 2943 tests passed, and one compatibility assertion still expected the old record-kind catalogue. It was updated to include the new pinned controller-configuration record while retaining every legacy record assertion. The corrected full run is pending. This source work does not establish M4 performance improvements, completion of bootstrap and goal-oriented candidate selection, or the paired pilot.
