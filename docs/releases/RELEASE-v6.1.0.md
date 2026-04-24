# v6.1.0 Release Notes

v6.1.0 is primarily an architectural release. The 2,090-line `swarm-orchestrator.ts` god-class is decomposed into a coordinator plus seven submodules under `src/orchestrator/`, each behind a named host interface. v6.1.0 also closes the SWE-bench container-path Known Gap carried over from v6.0.0 and cleans up several pieces of repository surface that no longer earn their keep: the unused Docker deployment infrastructure, zero-import dead modules, and a duplicated agent-definitions directory.

Tag: `v6.1.0` at commit `b3f5c2f` (2026-04-23). Commit range: `v6.0.0..v6.1.0` (35 commits).

## Theme 1: `swarm-orchestrator.ts` Decomposition (Phase 2)

Before v6.1.0, `swarm-orchestrator.ts` was 2,090 lines and carried greedy scheduling, wave dispatch, per-step execution, verification wiring, repair loop, replan coordination, final-gate pipeline, remediation-step synthesis, async meta-analysis, pause-controller state, git sanitize and install gating, PR-automation cycle entry, post-run reporting orchestration, and octopus merge helpers. Phase 2 splits these responsibilities along host-interface seams. The orchestrator now delegates to submodules it owns by composition and exposes host methods they call back through.

Post-decomposition: `swarm-orchestrator.ts` is 870 lines. Net change across the file: `-1,463 / +180`. Extracted logic lives in seven new modules under `src/orchestrator/` (2,114 lines total).

### Extracted Modules

| Module | Lines | Host Interface | Responsibility |
|--------|-------|----------------|----------------|
| `orchestrator/step-executor.ts` | 563 | `StepExecutorHost` | Single-step execution pipeline: session launch, verification, repair, cost attribution |
| `orchestrator/wave-scheduler-loop.ts` | 485 | `SchedulerHost` | Greedy per-wave dispatch loop, event-driven dependency resolution, adaptive concurrency |
| `orchestrator/final-gates-remediation.ts` | 432 | `RemediationHost` | Post-merge quality-gate pipeline plus remediation-step synthesis |
| `orchestrator/replan-runner.ts` | 369 | `ReplanHost` | Replan execution, retry-branch bookkeeping, failed-step objective carry-forward |
| `orchestrator/async-meta-analysis.ts` | 121 | (function) | Fire-and-forget wave health analysis |
| `orchestrator/git-state-utils.ts` | 89 | (function) | Pre-run git sanitize plus `npm install` gating |
| `orchestrator/pause-controller.ts` | 55 | (class) | Pause/resume signal coordination for steering |

`SwarmOrchestrator` retains coordination-layer responsibilities only: owning shared state (`ContextBroker`, `MetricsCollector`, `WorktreeManager`, `BranchMerger`, `PauseController`), holding the host-interface implementation surface, and the remaining merge and worktree-cleanup helpers.

Commits (chronological order):
- `516a3ce` pause-controller
- `34020cc` git-state-utils
- `7dd2690` async-meta-analysis
- `70a57ab` final-gates-remediation
- `59c448d` replan-runner
- `b9dd40a` step-executor
- `b3f5c2f` wave-scheduler-loop

Additional pre-extraction and support work:
- `c37c2f6` add `madge` as dev dependency (circular-dependency gate for Phase 2 verification)
- `f7c64cf` Phase 2a baseline and gate reinterpretation
- `e0521c1`, `1f58a66` decomposition plan and conventions
- `0040ece` post-run diff report (captures pre/post-decomposition semantics of the post-run block)
- `46bd30f` remove duplicated post-run block, call existing `runPostExecution`
- `936df2a` break `swarm-orchestrator` / `pr-automation` circular dependency via `PRSummaryContext`
- `7a9eecc` port `mainBranch` into `runPostExecution` autoPR path

### Why the Decomposition

The original file had grown to the point where the circular-dep gate (`madge`) tripped every time a new cross-module reference was added, change-blast radius for any scheduler or replan fix touched unrelated code paths, and the test seam was "mock the whole orchestrator or nothing." The four host interfaces give each submodule a narrow, testable contract without the orchestrator having to know submodule internals. No behavior change is intended from this work; the 1,497-passing-test suite is unchanged between v6.0.0 and v6.1.0.

## Theme 2: SWE-bench Container-Path Execution (closes v6.0.0 Known Gap)

v6.0.0 shipped the SWE-bench Verified harness "ready-to-run with container-path execution pending v6.1." v6.1.0 closes this gap with five fixes traced to PR #38 follow-through and smoke-run post-mortems:

| Commit | Fix |
|--------|-----|
| `34dd91e` | Define `PERINSTANCE_IMAGE_REGISTRY` constant in `run_swebench.py` (was referenced but undefined, would have NameError if container path was reached) |
| `82fedd6` | Update `test_union_capture` assertion to match PR #38 semantics |
| `5ca9a3e` | Route `evaluate_tasks` through `run_tests_dispatch` |
| `3c9166f` | Remove `--allow-empty` from container `git apply` (allows distinguishing empty-patch failures from application failures) |
| `7510605` | Strip test-file hunks from agent patch before container eval (RC6 port) |
| `32e5bc1` | Scope `pytest -k` to `test_patch` files for bare `FAIL_TO_PASS` names |

The last four land on `main` after the v6.1.0 tag cut but are included here as the closeout of the v6.0 Known Gap; they will re-ship identically in v6.1.1 or the next patch tag.

Also in this theme:
- `90b80e3` add single-instance SWE-bench smoke fixture

## Theme 3: Repository Surface Cleanup

Five chores that reduce repo surface area and eliminate duplication:

- `c58d70b` strip unused Docker deployment infrastructure (`Dockerfile.deploy`, compose services, k8s manifests, push workflows). The orchestrator's `deployment-manager.ts` was never exercised against these artifacts; they carried no live path.
- `e235e8c` remove deploy workflow, audit continuous-benchmark triggers
- `66a4591` remove dead modules (zero external imports detected via `madge`)
- `f37a48e` deduplicate agent definitions, generate plugin agents from canonical source. Previously `.github/agents/` and `config/default-agents.yaml` drifted independently; now plugin agents are generated from the canonical YAML at build time.
- `b39ab13` move `cli-handlers.ts` barrel to `src/cli/index.ts`. Code-level no-op (the file was a re-export), but removes the top-level `cli-handlers.ts` entry so the `src/cli/` subdirectory is self-contained.
- `3db2253` remove phantom subproject references from `.dockerignore`
- `610d670` remove stale debug investigation artifacts
- `f41a39c` remove session artifacts and leaked `pyproject.toml` from repo root
- `d477e15` remove benchmark raw run data from main (keep scoring infrastructure)

## Theme 4: Orchestrator and Planner Correctness Fixes

Individual fixes that accumulated between tags:

- `d4ceee5` carry forward failed step objectives in replan; fix middleware classifier and SecurityAuditor agent routing
- `2ed1861` eliminate false negatives in `git_diff` outcome check
- `1794ee1` planner: collapse trivial single-file modifications to one step
- `88f2b53` orchestrator: label fallback transcript header by actual tool (was mislabeled as `copilot` regardless of adapter)
- `3d105d1` prompts: inject target project's full test gate into every agent prompt
- `2932948` CLI: accept Codex login auth file as a valid credential
- `50c7aab` codex-adapter: stream output via `supervisedSpawn` for live progress
- `de4f13f` spinner: skip ANSI cursor escapes when stdout is not a TTY
- `cc37fae` CD: align sha tag prefix with verify pull (`sha-` prefix)

## Documentation Sync

ARCHITECTURE.md and the README "Key modules" table are updated in v6.1.0 to reflect the new module structure, corrected file counts (119 source files, 27,825 lines), and a pointer to this release for the decomposition rationale. Historical phase analysis documents under `docs/phase-*.md` contain line-number references into the pre-decomposition `swarm-orchestrator.ts` and are left as-is; they are snapshot artifacts of the work, not canonical references.

## Test Summary

No test count change from v6.0.0. Full suite: **1,497 passing, 6 pending, 0 failing**. All quality gates green on swarm-orchestrator.

## Known Gaps / Pending for v6.2

- **Constraint-binding full expansion.** Still at 4 pilot tasks; 16 additional tasks + master-default fixture pending validator/fetch hygiene at scale.
- **Plan-generator UI-bug routing.** Bug-fix goal type still defaults to BackendMaster; UI-bug evidence case not yet observed.
- **Reserved-paths invariant enforcement.** Issue #34 still open.
- **Test-coverage gate dynamic `require()` handling.** Issue #28 still open.
- **`package.json` version field.** Currently lags git tags (at `5.0.0` as of tag cut). Will be reconciled in the next patch release.
