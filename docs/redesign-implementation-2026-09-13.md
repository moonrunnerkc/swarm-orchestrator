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
| A1 | Effective objective, dependencies, authorized/immutable paths, tools, checks, execution and budget | contract resolution through public worker dispatch | open |
| A2 | Worker declarations cannot enlarge controller scope; normalized paths | tool denial, amendment denial, post-run diff and shell-effect regressions | open |
| A3 | Required checks run and affect acceptance; unsupported restrictions refuse dispatch | observed policy distinct from requested/effective policy | open |
| B1 | Run context before planning; all activities share cancellation and budget | planning, queue, model, tests, integration, verification interruption | open |
| B2 | Separate worktree, model-call and test-process limits | queue fairness and local contention fixtures | open |
| B3 | In-flight input/output reservation, measured settlement, failed and unknown usage | exhaustion and provider failure regressions | open |
| B4 | Stop dispatch, separately bounded cleanup, durable parallel lifecycle | cancellation and recovery integrations | open |
| C1 | Failed integrated checks, conflicts and relevant ratchet failures start bounded repair | three complete development repair examples | open |
| C2 | Retain rejected attempts and reachable commits; reuse failure context | accepted unrelated task executes once | open |
| C3 | Revalidate repair and combined tree, one final task outcome | successful fallback retains failed history | open |
| C4 | Repeated failure fingerprints and limits, exact blocker and partial work | ineffective repair exhaustion | open |
| D1 | Readiness scheduling, one integration writer, actual integration base | dependent starts while unrelated worker runs | open |
| D2 | Versioned bounded revisions: prerequisite, split, combine, reroute | cycle/reference rejection and overlap serialization | open |
| D3 | Preserve requirements/history, invalidate affected acceptance | revision omission and changed-dependency tests | open |
| D4 | Base/revision identity and stale candidate refusal | late worker after integration/revision change | open |
| D5 | Typed bounded proposals, relevant deltas, provenance, independent alternatives | event projection and tool-path regressions | open |
| D6 | Prefer one worker for tiny/coupled work | no-op, single-file, over-decomposition cases | open |
| E1 | Independent final acceptance at exact integrated tree | all workers green but required interaction missing | open |
| E2 | One authoritative CLI/exit/TUI/export assessment, distinct trust dimensions | public command and bundle tests | open |
| E3 | User checks and recorded candidate checks protected from worker writes | author/exposure records, malicious edits refused | open |
| E4 | Preserve strict reference/control package and human judgment gaps | existing acceptance corpus | open |
| E5 | Explicit empty-repository bootstrap before acceptance pinning and implementation | bootstrap end-to-end fixture | open |
| E6 | All obligations eligible before goal ranking, declared objective; legacy comparator retained | omission ineligible despite test volume | open |
| F1 | Journal replay and reconciliation of attempts, usage, candidates, trees, integration, resources | crash/restart around each effect | open |
| F2 | Original remaining budget/policy, no duplicate landing or ambiguous replay | restart and accounting tests | open |
| F3 | Intent before effect, completion after; preserve torn/altered history | crash at journal boundaries | open |
| F4 | Verify ownership before cleanup, retain user and other-session resources | cleanup ownership negatives | open |
| G1 | Extract CLI/session/parallel composition and common settings/outcome | command/config precedence compatibility | open |
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
