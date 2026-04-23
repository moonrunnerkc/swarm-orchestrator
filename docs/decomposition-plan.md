# Decomposition Plan

## Summary

Analyzed all 26 TypeScript files exceeding the 300-line soft limit (top 6 in depth, remaining 20 by judgment). Propose roughly 15 new modules across 8 new directories, moving ~3,500 lines out of the top 6 files, plus **one duplication-removal** in `swarm-orchestrator.ts` (lines 909-1101) where the code for post-run reporting has already been extracted into `src/post-run-reporter.ts` but the inline duplicate was never deleted. Highest-risk extractions are inside `executeSwarm` (the final-gates remediation block and the greedy scheduling loop), where responsibilities share the mutable `SwarmExecutionContext` with ordering dependencies; safe extractions are the per-step prompt builder in `session-executor.ts`, the goal templates in `plan-generator.ts`, and the MCP tool handlers in `mcp-server.ts`. Eight of the remaining twenty files are cohesive-but-long and should be left alone. The 300-line limit is a guideline, so the plan recommends extractions only where there is a genuine responsibility seam, not to chase line counts.

**Private-method test access resolution (applies to the entire plan):** `test/swarm-orchestrator.test.ts` and `test/upgrade-baseline.test.ts` both reach into private methods via `(orchestrator as any).<method>`. Every extraction below preserves this by leaving a thin private delegate method on the class that forwards to the extracted module. No test changes. No promotion of extracted module APIs to public. This is the resolution — do not revisit per-file.

**Callback injection shape (locked for all `orchestrator/*` extractions):** each extracted module receives a narrow, **module-specific TypeScript interface** that `SwarmOrchestrator` implements — not the class instance itself, not a bag of bound methods. Interface names: `SchedulerHost` (for `wave-scheduler-loop.ts`), `StepExecutorHost` (for `step-executor.ts`), `RemediationHost` (for `final-gates-remediation.ts`), `ReplanHost` (for `replan-runner.ts`). Each interface lists the exact methods the module needs — nothing more — and is type-checked at compile time. This blocks two failure modes: (1) modules reaching for collaborators they shouldn't know about, and (2) bound-method bags drifting out of sync silently. The thin private delegate methods on the class satisfy the interface naturally, so test access via `(orch as any).<method>` continues to work. Phase 2 executor: do NOT choose between "pass the orch" and "pass bound methods." Define the interface, implement it on the class, pass the interface.

**Scheduler invariant (locked for `wave-scheduler-loop.ts`):** the scheduler reads `context.plan.steps` on every loop iteration because `executeReplan` may swap `context.plan` mid-run. Extracted scheduler MUST carry this block comment at the top of the file verbatim: *"INVARIANT: plan.steps is re-read on every iteration. Do not cache this reference, do not cache readySteps or any derivative across iterations. `executeReplan` swaps `context.plan` to a revised plan mid-scheduling, and a cached reference will silently drop the newly-added steps."* Phase 2 must also add `test/wave-scheduler-replan.test.ts` that drives the scheduler with a replan firing mid-loop and asserts the new steps are picked up. Without that test, a regression only surfaces in full integration runs.

**Circular-dependency hard gate (applies to every extraction):** after every extraction commit, run all three of `npm test`, `npm run build`, `madge --circular src/`. Any failure stops Phase 2 until diagnosed — no "fix forward in the next commit," no "will clean up later." This is stricter than open question #8 in the earlier draft. If `madge` isn't installed, Phase 2's first action is `npm install --save-dev madge`.

**Post-run duplication — mandatory diff before deletion:** the inline block in `swarm-orchestrator.ts` lines 909-1101 and `src/post-run-reporter.ts`'s `runPostExecution` look identical at a glance, but "look identical" is paste-and-pray on 190 lines of code that's been edited independently since v5 shipped. Phase 2's first action before the deletion is to produce a line-by-line behavioral diff: fields read, files written, side effects (KB writes, metrics calls, external tool invocations), error handling. For every difference: either port the behavior into `runPostExecution` *with a test* that locks the new behavior, OR note it explicitly as intentionally removed (and why) in the commit message. Do not delete first and reconcile after.

## Top 6 Files

### src/swarm-orchestrator.ts (2,221 lines)

The file is a single `SwarmOrchestrator` class whose constructor wires up five collaborators (`SessionExecutor`, `ShareParser`, `VerifierEngine`, `WorktreeManager`, `BranchMerger`) and whose `executeSwarm` method is ~800 lines of mixed concerns. Most non-scheduling logic has already been extracted as thin delegate methods to external modules (`critic-reviewer`, `prompt-builder`, `wave-scheduler`, `commit-quality-analyzer`, `deployment-handler`). What remains is a scheduling loop, a final-gates remediation pipeline, a per-step execution pipeline, and a results/reporting phase, all entangled through `SwarmExecutionContext`.

#### 1. Responsibility inventory

| # | Name | Line range | Public entry point(s) | Private helpers |
|---|---|---|---|---|
| R1 | Swarm lifecycle coordinator (orchestrator class shell) | 159-199, 218-301 | constructor, `requestPause`, `requestResume`, `isPauseRequested`, `initializeSwarmExecution` | `resolveAgent`, `generateExecutionId` |
| R2 | Greedy wave scheduler | 412-609 (embedded in executeSwarm), 1864-1937 | (called from executeSwarm only) | `attemptFleetDispatch`, `onStepComplete`, `onStepFailed`, `getReadySteps` (local closures) |
| R3 | Per-step executor | 1378-1771 | `executeStepInSwarm` | (inline) |
| R4 | Final quality-gates remediation pipeline | 704-907, 1104-1145 | (embedded in executeSwarm) | `buildRemediationStep` |
| R5 | Replan / repair loop | 655-699, 1151-1373 | `executeReplan` | - |
| R6 | Post-run reporting (metrics, session state, OWASP, PR automation, KB) | 909-1101 | (embedded in executeSwarm) | - |
| R7 | Git-state utilities (thin delegates to WorktreeManager/BranchMerger) | 1800-2103, 2111-2135 | - | `createAgentWorktree`, `removeAgentWorktree`, `cleanupRemainingWorktrees`, `createAgentBranch`, `mergeWaveBranches`, `mergeAllBranches`, `tryRebaseAndMerge`, `mergeBranch`, `switchBranch`, `getCurrentBranch`, `ensureInitialCommit`, `sanitizeGitState` |
| R8 | Dependency install helper | 1999-2040 | - | `installDependenciesIfNeeded` |
| R9 | Pause/resume controller | 166-236, 2055-2065 | `requestPause`, `requestResume`, `isPauseRequested` | `waitForResume` |
| R10 | Async meta-analysis fire-and-forget | 2158-2200 | - | `runAsyncMetaAnalysis` |
| R11 | Thin delegates to already-extracted modules | 1775-1799, 2142-2157, 2206-2218 | - | `runCriticReview`, `buildSwarmPrompt`, `buildDependencyGraph`, `identifyExecutionWaves`, `writeSharedInstructions`, `analyzeCommitQuality`, `executeOptionalDeployment` |

#### 2. Shared state map

Class instance fields:

| State | Kind | Read by | Written by | Ordering |
|---|---|---|---|---|
| `workingDir` | string (final) | R1-R11 | constructor only | CLEAN |
| `targetMode` | boolean (final) | R4 (skippedGateKeys) | constructor only | CLEAN |
| `sessionExecutor`, `shareParser`, `verifier`, `worktreeManager`, `branchMerger` | collaborators (final) | R3, R5, R7 | constructor only | CLEAN |
| `pauseRequested` | mutable | R2 (scheduler loop), R9 (waitForResume) | R9 (requestPause/Resume), R2 (governance pause) | PASSABLE — encapsulate as `PauseController` and inject into scheduler |
| `resumeRequested` | mutable | R9 (waitForResume) | R9 (requestResume) | PASSABLE — same as above |

Context object (`SwarmExecutionContext`) fields that cross responsibility boundaries:

| State | Kind | Read by | Written by | Ordering |
|---|---|---|---|---|
| `results[]` | array, mutated in place | R2, R3, R4, R5, R6 | R1 (init), R3 (status/branchName/timestamps), R5 (replan reset) | ENTANGLED — status transitions depend on scheduler firing before reporter reads; replan mutates status back to 'pending' mid-run |
| `contextBroker` | event emitter + lock manager | R2 (step-completed listener), R3 (addStepContext, getDependencyContext, waitForDependencies), R4 (forceReleaseStaleLocks), R5, R6 | R3 writes entries | PASSABLE — passed as ctx arg |
| `plan.steps` | array | R2, R3, R4 (remediation), R5 (appends new steps) | R5 (`context.plan = revised`) replaces the whole plan | ENTANGLED — R5 swaps `context.plan`, so any extracted scheduler needs to read `context.plan.steps` each loop iteration, not cache it |
| `qualityGatesTriggered` | flags object | R4 (canAutoFix, buildRemediationStep) | R4 (buildRemediationStep sets triggeredFlag) | PASSABLE — single responsibility |
| `unmergedBranches[]` | array | R6 (summary print) | R7 (mergeWaveBranches/mergeAllBranches append) | PASSABLE — append-only |
| `replanState` | nested object | R5 only | R5 only | CLEAN to R5 |
| `metricsCollector`, `costEstimator`, `costEstimate`, `stepCostRecords` | collectors | R3 (trackStep/trackVerification, record cost), R6 (finalize/write), R5 (nothing — gap) | R3 appends | PASSABLE — append-only from R3, flush-only from R6 |
| `knowledgeBase` | KB manager | R2 (lean mode, metaAnalysis trigger), R3 (replay mode), R5 (replan event), R6 (recordRun, cost history) | shared append | PASSABLE |
| `baselineSnapshot`, `filteredRequirements` | snapshots | R4 (gates baseline), R6 (implicit) | R1 (top of executeSwarm) | CLEAN once set |
| `prManager`, `prUrls` | PR state | R7 (mergeWaveBranches), R6 (summary) | R1 (init when `options.prMode`), R7 (append) | PASSABLE |
| `finalGateResults` | array | R6 (session state) | R4 (overwrites after each gate run) | ENTANGLED — R4 re-runs gates and replaces the array; R6 reads the last one |

**Flag:** The "ENTANGLED" items above prevent a clean extraction of R2 (scheduler), R4 (remediation), and R5 (replan) into separate modules that talk only through immutable messages. These three responsibilities must either continue to share the context object by reference (same style as today, just in different files) or be rewritten to use explicit state transitions. Recommendation: extract them to sibling modules that take `context: SwarmExecutionContext` as a mutable parameter — same semantics as today, separate files. No behavior change, no test breakage.

#### 3. External contract

Importers:

| Importer | Symbols imported | Stays via barrel re-export? |
|---|---|---|
| `src/index.ts` | `SwarmOrchestrator`, type `SwarmExecutionContext`, type `ParallelStepResult` | yes |
| `src/cli/swarm-handlers.ts` | `SwarmOrchestrator`, `SwarmExecutionOptions`, `SwarmExecutionContext` | yes |
| `src/critic-reviewer.ts` | `ParallelStepResult` | yes |
| `src/dashboard.tsx` | `ParallelStepResult` | yes |
| `src/gate-remediation.ts` | type `SwarmExecutionOptions` | yes |
| `src/meta-analyzer.ts` | `ParallelStepResult` | yes |
| `src/post-run-reporter.ts` | `ParallelStepResult` | yes |
| `src/pr-automation.ts` | `SwarmExecutionContext` | yes |
| `test/github-action.test.ts` | `SwarmExecutionContext`, `ParallelStepResult` | yes |
| `test/meta-analyzer.test.ts` | `ParallelStepResult` | yes |
| `test/upgrade-baseline.test.ts` | `SwarmOrchestrator`, `ParallelStepResult`, `SwarmExecutionContext` — calls `(orch as any).runCriticReview(...)` via private access | yes — keep thin delegate method on the class |
| `test/swarm-orchestrator.test.ts` | `SwarmOrchestrator`, `SwarmExecutionContext`, `ParallelStepResult` — calls `orch.generateExecutionId`, `buildDependencyGraph`, `identifyExecutionWaves`, `buildSwarmPrompt`, `runCriticReview`, `buildRemediationStep`, `cleanupRemainingWorktrees` via `as any` | yes — keep thin delegate methods on the class |

**Decision:** preserve the class surface exactly. Extractions become private methods that delegate to extracted modules (same pattern already used for `_runCriticReview` etc. at lines 1775-1799). Existing tests continue to work.

#### 4. Test coverage map

Direct:

- `test/swarm-orchestrator.test.ts` (528 lines, ~27 cases). Tests the following **private** methods via `(orch as any).<method>`:
  - `generateExecutionId` (3 cases)
  - `buildDependencyGraph` (3 cases) — thin delegate to `wave-scheduler`
  - `identifyExecutionWaves` (6 cases) — thin delegate to `wave-scheduler`
  - `buildSwarmPrompt` (5 cases) — thin delegate to `prompt-builder`
  - `runCriticReview` (8 cases) — thin delegate to `critic-reviewer`
  - `buildRemediationStep` (6 cases)
  - `cleanupRemainingWorktrees` (3 cases)
- `test/upgrade-baseline.test.ts` (866 lines) — exercises `runCriticReview` via `(orch as any)` plus a smoke test of `new SwarmOrchestrator(tmpWorkDir)`.

Indirect:

- `test/github-action.test.ts` asserts CI-output invariants via the context shape.
- `test/multi-repo.test.ts` exercises multi-repo flow end-to-end.

Scheduler internals (R2), per-step executor (R3), final-gates remediation (R4), replan (R5), and reporting (R6) have **no direct unit coverage** — they are exercised only via full `executeSwarm` integration (which the test suite largely does not run because it requires real git worktrees and the copilot CLI). This is why extractions that preserve the existing class surface are low-risk: the integration tests that *do* run go through `executeSwarm` as a black box.

**Risk per extraction:**
- Thin-delegate modules already extracted (R11): zero risk, mechanical.
- `buildRemediationStep` (R4 partial): 6 direct unit tests — extraction must keep the same public shape. LOW risk.
- `cleanupRemainingWorktrees` (R7): 3 direct unit tests. LOW risk.
- R2 scheduler: no direct tests; integration-only. MEDIUM risk — could break full-run tests that assert on wave counts.
- R4 remediation pipeline: no direct tests. MEDIUM risk — changes in order of gate-replan-gate would be hard to catch.
- R5 replan: no direct tests. MEDIUM risk — mutates `context.plan` and `context.results`.
- R6 reporting: no direct tests, purely post-processing. LOW risk.

#### 5. Proposed decomposition

Preserve the class surface. Each extracted module takes `context: SwarmExecutionContext` (and other parameters) and the class method becomes a one-line delegate.

| Module | Extracted from | Public API | Dependencies (imports from original + what original imports back) | Est. size | Parent after |
|---|---|---|---|---|---|
| `src/orchestrator/wave-scheduler-loop.ts` | R2 (executeSwarm lines 412-609 + attemptFleetDispatch 1864-1937) | `runWaveLoop(orch, plan, agents, context, options)` | imports `SwarmExecutionContext`, `SwarmExecutionOptions`, `ParallelStepResult`; original re-imports `runWaveLoop`. Needs callbacks into class for `executeStepInSwarm`, `mergeWaveBranches`, `runCriticReview`, `runAsyncMetaAnalysis`, `attemptFleetDispatch` — pass as an object of bound methods. | ~240 | -235 |
| `src/orchestrator/step-executor.ts` | R3 (executeStepInSwarm 1378-1771) | `executeStepInSwarm(orch, step, agent, context, options)` — `orch` supplies workingDir, shareParser, verifier, sessionExecutor, branchMerger | 400-ish lines; imports most orchestrator-level types. | ~395 | -395 |
| `src/orchestrator/final-gates-remediation.ts` | R4 (executeSwarm lines 704-907 + buildRemediationStep 1104-1145) | `runFinalGatesPipeline(orch, context, agents, gatesConfig, options)` returning `{ finalGateResults, remediationAttempted }` | Tightly coupled to `buildRemediationStep` (keep together). Mutates `context.finalGateResults`, `context.qualityGatesTriggered`, `context.plan`. | ~260 | -240 |
| `src/orchestrator/replan-runner.ts` | R5 (executeReplan 1151-1373) | `executeReplan(orch, context, replanPayload, agents, options)` | Mutates `context.plan`, `context.results`, `context.replanState`. Uses `orch.executeStepInSwarm`, `orch.mergeWaveBranches`, `orch.switchBranch`, `orch.createAgentBranch`. | ~225 | -220 |
| **(not a new module — duplicate deletion)** `src/post-run-reporter.ts` already exists and exports `runPostExecution(workingDir, runDir, context, plan, options)` that does exactly this work. | R6 (executeSwarm lines 909-1101) — **delete** the inline block; import `runPostExecution` and `PostRunContext`; build the `PostRunContext` from the `SwarmExecutionContext` (subset of fields) and call it. | no new exports | 0 new lines | -190 from parent; no new file |
| `src/orchestrator/pause-controller.ts` | R9 (lines 166-167, 218-236, 2055-2065) | `class PauseController` with `requestPause`, `requestResume`, `isPauseRequested`, `waitForResume` | Small, isolated. Class holds an instance. | ~35 | -20 |
| `src/orchestrator/git-state-utils.ts` | `sanitizeGitState` (R1 subset, 2111-2135), `installDependenciesIfNeeded` (R8, 1999-2040) | `sanitizeGitState(workingDir)`, `installDependenciesIfNeeded(workingDir)` | Both pure static helpers over `workingDir`. | ~75 | -65 |
| `src/orchestrator/async-meta-analysis.ts` | R10 (2158-2200) | `runAsyncMetaAnalysis(context, plan, runDir, completedSteps)` | Writes analysis-batch-N.json; updates KB. | ~45 | -42 |

After all extractions, `swarm-orchestrator.ts` drops from 2,221 lines to approximately **800 lines**, holding: class shell, constructor, `initializeSwarmExecution`, the top-level `executeSwarm` orchestration (now a ~100-line function that calls the extracted modules in order), `resolveAgent`, `generateExecutionId`, pause-controller forwarding, and the thin delegates to WorktreeManager/BranchMerger that the test suite depends on.

**Why one big `executeSwarm` remains:** the top-level orchestration — init → scheduler → retriable-failures replan → final-gates → merge-all → finalize-run — is the class's main job. Keeping the sequence readable in one place, with each step delegated to a focused module, is more valuable than splitting the sequence across files.

#### 6. Execution order (low → high risk)

1. `pause-controller.ts` — isolated, tiny, CLEAN state. No test exposure.
2. `git-state-utils.ts` (`sanitizeGitState` + `installDependenciesIfNeeded`) — pure over `workingDir`.
3. `async-meta-analysis.ts` — fire-and-forget, no return value consumed.
4. **Delete duplicated post-run block (lines 909-1101)** and call existing `runPostExecution` instead — pure post-processing, no state for later steps to depend on.
5. `final-gates-remediation.ts` — mutates context but in a well-defined window; covered indirectly by integration tests and directly by `buildRemediationStep` unit tests.
6. `replan-runner.ts` — mutates `context.plan` and `context.results`; needs care around `context.plan` reference being swapped.
7. `step-executor.ts` — the largest single extraction, most state reads, but semantics are one-step-in/one-step-out.
8. `wave-scheduler-loop.ts` — highest risk: coordinates all callbacks, owns pending/inFlight/completed sets, reads `context.plan.steps` after replan may have replaced `context.plan`.

Run the full test suite (`npm test`) after each extraction.

---

### src/plan-generator.ts (1,396 lines)

The file is a single `PlanGenerator` class. Responsibilities are cleanly separated — there are almost no ordering dependencies, and the class state (`availableAgents`, `gateConfig`) is immutable after construction.

#### 1. Responsibility inventory

| # | Name | Line range | Public entry points | Private helpers |
|---|---|---|---|---|
| R1 | Plan orchestration / entry points | 40-232, 1290-1393 | `createPlan`, `createBootstrapPlan`, `parseCopilotPlanFromTranscript`, `generateCopilotPlanningPrompt`, `getExecutionOrder`, `revisePlan` | `applyAgentGuidance`, `validatePlanSchema` |
| R2 | Goal classification | 524-678 | `classifyGoal` | `detectGoalType`, `hasContractChangeShape`, `hasBugReportShape`, `isTrivialTask`, `isSimpleProject` |
| R3 | Per-goal-type step templates | 680-1213 | - | `generateApiSteps`, `generateWebAppSteps`, `generateCliToolSteps`, `generateLibrarySteps`, `generateInfrastructureSteps`, `generateDataPipelineSteps`, `generateMobileAppSteps`, `generateBugFixSteps`, `generateContractChangeSteps`, `generateGenericSteps` |
| R4 | Acceptance-criteria / review-criteria text | 299-400 | - | `getAcceptanceCriteria`, `getIntegratorReviewCriteria` |
| R5 | Gate-requirement application | 466-510 | - | `applyGateRequirements` |
| R6 | Plan validation | 237-293, 1214-1249 | - | `validatePlanSchema`, `validateAgentAssignments`, `validateDependencies` |
| R7 | Heuristic agent assignment | 1250-1288 | `assignAgent` | - |
| R8 | Intelligent-step dispatcher | 406-456 | - | `generateIntelligentSteps` (switch over goal type → R3 templates, then R5) |

#### 2. Shared state map

| State | Kind | Read by | Written by | Classification |
|---|---|---|---|---|
| `this.availableAgents` | `AgentProfile[]` (final) | R6 (validateAgentAssignments), R1 (revisePlan), R7 (not used — assignAgent hardcodes names) | constructor only | PASSABLE — pass into validator and revisePlan |
| `this.gateConfig` | optional (final) | R5 (applyGateRequirements) | constructor only | PASSABLE — pass into extracted template-post-processor |

All mutable state lives in the returned `ExecutionPlan` object. No ordering concerns across responsibilities — templates produce steps independently, and R5 processes them after.

#### 3. External contract

Importers use `PlanGenerator`, `ExecutionPlan`, `PlanStep`, and `ReplanPayload`. 34 files across src and test depend on these symbols. Type-only exports (`ExecutionPlan`, `PlanStep`, `ReplanPayload`) should move to a dedicated `src/plan-generator/types.ts` or stay re-exported from `plan-generator.ts` barrel. The `PlanGenerator` class must keep its public method shape.

#### 4. Test coverage map

- `test/plan-generator.test.ts` (929 lines, 51 `it(...)` cases). Exercises `createPlan`, `assignAgent`, `getExecutionOrder`, `revisePlan`, `classifyGoal` directly, plus indirect coverage of all templates via `createPlan` with representative goals. Contract-change and bug-fix classification have dedicated parameterized suites (`#27 fix 2` / `fix 3`).
- `test/spec-aware-planning.test.ts` (244 lines)
- `test/copilot-planning.test.ts` (95 lines)
- `test/upgrade-baseline.test.ts` exercises via `PlanGenerator` construction.

**Risk per extraction:**
- R2 (classifier): 50+ tests directly cover `classifyGoal`. Extraction must preserve exact classification behavior. LOW risk if pure-function extraction.
- R3 (templates): covered via `createPlan` shape assertions. LOW risk because each template is pure and returns steps.
- R6 (validation): covered by 3 cases. LOW risk.
- R7 (assignAgent): 6 direct cases. LOW risk.

#### 5. Proposed decomposition

| Module | Extracted from | Public API | Est. size | Parent after |
|---|---|---|---|---|
| `src/plan-generator/goal-classifier.ts` | R2 (528-678) | `classifyGoal(goal: string): GoalType`, plus `hasContractChangeShape`, `hasBugReportShape`, `isTrivialTask`, `isSimpleProject` as internal helpers | ~155 | -150 |
| `src/plan-generator/templates/api.ts`, `web-app.ts`, `cli-tool.ts`, `library.ts`, `infrastructure.ts`, `data-pipeline.ts`, `mobile-app.ts`, `bug-fix.ts`, `contract-change.ts`, `generic.ts` | R3 (680-1213) | Each file exports `generate<X>Steps(goal: string, startNumber: number, criteria: { acceptance: string; integrator: string }): PlanStep[]` | each 30-90 | total -530 |
| `src/plan-generator/criteria.ts` | R4 (299-400) | `getAcceptanceCriteria(goalType)`, `getIntegratorReviewCriteria()` | ~110 | -100 |
| `src/plan-generator/gate-requirements.ts` | R5 (466-510) | `applyGateRequirements(steps, goal, goalType, gateConfig)` | ~50 | -45 |
| `src/plan-generator/validation.ts` | R6 (237-293, 1214-1249) | `validatePlanSchema(plan)`, `validateAgentAssignments(steps, agents)`, `validateDependencies(steps)` | ~100 | -90 |
| `src/plan-generator/agent-assigner.ts` | R7 (1250-1288) | `assignAgent(task: string): string` | ~45 | -40 |

Alternatively, collapse the 10 templates into one `src/plan-generator/templates.ts` dispatch file that re-exports each generator; but a directory keeps each template under 100 lines and lets future edits stay focused. Preference: directory split.

Parent `plan-generator.ts` after: R1 entry points + a `switch`-style dispatcher that calls into the extracted modules. Estimated size **~350 lines** — still slightly over 300 but cohesive (the `PlanGenerator` class public surface plus its orchestration logic). That is the right shape to leave it at.

#### 6. Execution order

1. `agent-assigner.ts` (R7) — pure, tiny, directly tested.
2. `criteria.ts` (R4) — pure string-building helpers, no state.
3. `validation.ts` (R6) — pure over `AgentProfile[]` and `PlanStep[]`.
4. `gate-requirements.ts` (R5) — pure over `QualityGatesConfig`.
5. `goal-classifier.ts` (R2) — pure over `string`.
6. `templates/*.ts` (R3) — pure; each generator independent.

All extractions here are CLEAN. No mutable shared state, no ordering. Run tests after each.

---

### src/cli/swarm-handlers.ts (784 lines)

#### 1. Responsibility inventory

| # | Name | Line range | Public entry |
|---|---|---|---|
| R1 | Adapter secret validation | 45-67 | `validateAdapterSecrets` |
| R2 | Core swarm execution flow | 69-401 | `executeSwarm` — load plan → PM review → cost estimate → confirm → start dashboard → run orchestrator → print summary → writeCIOutputs |
| R3 | CI output writing | 407-443 | `writeCIOutputs` |
| R4 | Bootstrap command | 449-527 | `handleBootstrapCommand` |
| R5 | Swarm command wrapper (arg parsing + help) | 529-584 | `handleSwarmCommand` |
| R6 | Quick-fix command | 586-668 | `handleQuickCommand` |
| R7 | Run command | 670-784 | `handleRunCommand` |

#### 2. Shared state map

No class, no module-level mutable state. Everything flows through function parameters. CLEAN across the board.

Inside `executeSwarm` (R2), a local `dashboard` variable and closure-captured `agentLogLines` array cross the boundary between dashboard setup and the orchestrator call — straightforward to factor into a dashboard-binding helper.

#### 3. External contract

- `src/cli/index.ts` barrel re-exports all 7 public symbols.
- `src/cli/misc-handlers.ts` imports `executeSwarm`.

Preserving the barrel keeps all other callers untouched.

#### 4. Test coverage map

- `test/cli-handlers.test.ts` (214 lines, 23 cases) and `test/cli.test.ts` (233 lines, 21 cases) — test CLI parsing and handler dispatch, not the internals of `executeSwarm`.
- `test/github-action.test.ts` asserts `writeCIOutputs` is invoked when `GITHUB_ACTIONS` is set.

**Risk:** No internal test coverage on `executeSwarm`'s body. Extractions that preserve handler signatures are LOW risk.

#### 5. Proposed decomposition

| Module | Extracted from | Public API | Est. size | Parent after |
|---|---|---|---|---|
| `src/cli/swarm/cost-gate.ts` | Cost estimation + confirmation (executeSwarm 114-179) | `runCostGate(plan, options): Promise<{ confirmed: boolean; exitCode?: number; costEstimate; modelName }>` | ~75 | -65 |
| `src/cli/swarm/dashboard-binding.ts` | Dashboard start + progress/onAgentLine wiring (executeSwarm 222-306) | `bindDashboard(plan, runId, costEstimate, modelName, options): Promise<DashboardBinding>` with `update`, `stop`, `hookInto(swarmOptions)` | ~90 | -80 |
| `src/cli/swarm/run-summary.ts` | Final summary block (executeSwarm 321-386) | `printRunSummary(context, plan, runId, runDir, costEstimate, modelName, retryPct)` | ~70 | -60 |

Parent file after: ~**580 lines**. The 4 command handlers (R4-R7) stay where they are — they're each focused single-purpose functions, moving them would split a natural "CLI command handlers" module that the `cli/index.ts` barrel already exports as a unit.

#### 6. Execution order

1. `run-summary.ts` — pure print logic, no side effects beyond logger calls.
2. `cost-gate.ts` — self-contained, reads options, prompts user.
3. `dashboard-binding.ts` — encapsulates dashboard start/update/stop closure. Slightly riskier because it captures `swarmOptions` by callback.

---

### src/mcp-server.ts (769 lines)

Single `McpServer` class implementing MCP over JSON-RPC stdio.

#### 1. Responsibility inventory

| # | Name | Line range | Public entry points |
|---|---|---|---|
| R1 | Transport (stdio framing, extract messages, send response) | 78-215 | `start`, `extractMessages`, `sendResponse` |
| R2 | Protocol router (dispatch by method name) | 176-215 | `handleRequest` |
| R3 | MCP protocol handlers | 216-425 | `handleInitialize`, `handleResourcesList`, `handleResourcesRead`, `handleToolsList`, `handleToolsCall` |
| R4 | Resource readers (runs, agents, knowledge) | 428-565 | `readRunsList`, `readRunDetail` (private), `readStepDetail` (private), `readAgents`, `readKnowledge` (private) |
| R5 | Tool implementations (status / plan / gates / exportAgents / cost) | 566-758 | `toolStatus`, `toolPlan`, `toolGates`, `toolExportAgents`, `toolCost` (all private) |

#### 2. Shared state map

| State | Kind | Read by | Written by | Classification |
|---|---|---|---|---|
| `workingDir` | string (final) | R4, R5 | constructor only | CLEAN |
| `configLoader` | `ConfigLoader` (final) | R5.toolPlan, R5.toolCost, R4.readAgents | constructor only | CLEAN |

No mutable state. Responsibilities communicate only via pure function calls.

#### 3. External contract

- `src/cli.ts` imports `startMcpServer`.
- `test/mcp-server.test.ts` imports `McpServer` and calls `extractMessages`, `handleRequest`, and individual handlers directly.

Preserve `McpServer` class shape. Tests call the class, not the underlying modules, so extracted pure helpers can be delegated to.

#### 4. Test coverage map

- `test/mcp-server.test.ts` — 27 cases covering `extractMessages` (multiple framings), `handleRequest` (protocol responses), and each tool. Good direct coverage. LOW risk.

#### 5. Proposed decomposition

| Module | Extracted from | Public API | Est. size | Parent after |
|---|---|---|---|---|
| `src/mcp/transport.ts` | R1 (78-174, minus handleRequest) | `extractMessages(buffer)`, `sendResponse(response)`, `readLoop(onMessage, onClose)` | ~95 | -90 |
| `src/mcp/resources.ts` | R4 (428-565) | `readRunsList(workingDir)`, `readRunDetail(workingDir, runId)`, `readStepDetail(workingDir, runId, stepNumber)`, `readAgents(workingDir, configLoader)`, `readKnowledge(workingDir)` | ~145 | -140 |
| `src/mcp/tools.ts` | R5 (566-758) | `toolStatus(workingDir, id)`, `toolPlan(workingDir, configLoader, id, args)`, `toolGates(workingDir, id, args)`, `toolExportAgents(workingDir, id, args)`, `toolCost(workingDir, configLoader, id, args)` | ~195 | -190 |

Parent after: ~**345 lines** holding `McpServer` class, constructor, `start`, `handleRequest`, `handleInitialize`, `handleResourcesList`, `handleResourcesRead`, `handleToolsList`, `handleToolsCall` (the protocol dispatchers). Slightly over 300, cohesive.

#### 6. Execution order

1. `transport.ts` — most isolated (pure message parsing). Has direct test coverage.
2. `resources.ts` — filesystem reads only.
3. `tools.ts` — dynamic requires of `PlanGenerator`, `CostEstimator`, quality gates; preserve the lazy-require behavior.

---

### src/session-executor.ts (690 lines)

Single `SessionExecutor` class that wraps the copilot binary / an agent adapter.

#### 1. Responsibility inventory

| # | Name | Line range | Public entry points |
|---|---|---|---|
| R1 | Class shell + copilot-path session execution | 62-155 | `executeSession` |
| R2 | Adapter delegation | 157-217 | `executeViaAdapter` (private) |
| R3 | Step-level execution (with hooks, transcript, baseline) | 218-286 | `executeStep` |
| R4 | Prompt builder (~170 lines of static template sections) | 291-461 | `buildStepPrompt` (private) |
| R5 | Subprocess supervision (spawn, stall detection, heartbeat, line buffering) | 475-656 | `runCommand` (private) |
| R6 | Retry helper | 661-687 | `executeWithRetry` |

#### 2. Shared state map

| State | Kind | Read by | Written by | Classification |
|---|---|---|---|---|
| `copilotBin` | string (final) | R1 | constructor only | CLEAN |
| `workingDir` | string (final) | R1, R3, R4 (baseline scan + test discovery), R5 (spawn cwd) | constructor only | CLEAN |
| `adapter` | optional (final) | R1 (branch on presence), R2 | constructor only | CLEAN |
| `SCOPE_NOISE_PATTERNS` (static), `STALL_TIMEOUT_MS` (static) | constants | R5 | - | CLEAN |

All instance state is immutable after construction. No ordering concerns.

#### 3. External contract

- `src/index.ts`, `src/swarm-orchestrator.ts`, `src/repair-agent.ts`, `src/step-runner.ts`, `src/pm-agent.ts`, `src/fleet-executor.ts`, `src/quick-fix-mode.ts` all import `SessionExecutor` (default or named) plus `SessionOptions` and `SessionResult` types.
- `test/session-executor.test.ts` (342 lines, 10 cases), `test/adapters.test.ts`, `test/test-command-discovery.test.ts` import directly.

Preserve class shape.

#### 4. Test coverage map

- `test/session-executor.test.ts` covers session execution paths; heavy use of mocks for subprocess spawn.

**Risk:** R5 (runCommand) is the most complex extraction — spawn, stall detection, heartbeat, and line-buffered output are tightly coupled to timing behavior. Tests likely mock `spawn`; extraction should preserve the exact same event-emitter wiring.

#### 5. Proposed decomposition

| Module | Extracted from | Public API | Est. size | Parent after |
|---|---|---|---|---|
| `src/session-executor/prompt-builder.ts` | R4 (291-461) | `buildStepPrompt(step, agent, context, workingDir): string` | ~175 | -170 |
| `src/session-executor/subprocess-runner.ts` | R5 (475-656) | `runCommand(command, args, opts: { cwd; logPrefix?; additionalEnv?; onAgentLine?; isNoise?: (line) => boolean }): Promise<{stdout, stderr, exitCode}>` — pass the scope-noise predicate as a callback rather than hardcoding it | ~180 | -175 |

Parent after: ~**345 lines** holding the class shell, `executeSession`, `executeViaAdapter`, `executeStep`, `executeWithRetry`, `sleep`, and the scope-noise classifier. Slightly over 300, cohesive.

#### 6. Execution order

1. `prompt-builder.ts` — pure function, easy to unit test in isolation.
2. `subprocess-runner.ts` — carefully preserve timing semantics; run `test/session-executor.test.ts` after.

---

### src/dashboard.tsx (594 lines)

React / Ink TUI. Three distinct concerns: sub-components, the main component, and a runtime with stdout.write monkey-patching.

#### 1. Responsibility inventory

| # | Name | Line range | Public entry |
|---|---|---|---|
| R1 | Sub-components (StatusIcon, ProgressBar, ProductivitySummary) | 39-158 | - (internal) |
| R2 | Main SwarmDashboard component | 160-424 | `export default SwarmDashboard` |
| R3 | startDashboard runtime (stdout.write interceptor, mount lifecycle, keybindings wiring) | 426-592 | `startDashboard`, type `DashboardManager` |

#### 2. Shared state map

All state is React-component-local. No module-level mutable state.

The stdout.write monkey-patch (R3) captures `_origWrite` and `frameBuf` in a closure — isolated, no impact on R1 / R2.

#### 3. External contract

- `src/cli/swarm-handlers.ts` and `src/cli/status-handlers.ts` both lazy-load via `await import('../dashboard')` and look up `startDashboard` / `renderDashboard` from the module object.
- No static imports of dashboard symbols from any src/ or test/ file.
- `ParallelStepResult` is imported from `swarm-orchestrator.ts`.

This means: extracted modules must still be reachable through `src/dashboard.tsx` exports, OR the dynamic import targets can be updated to point at the new file paths. Prefer keeping `src/dashboard.tsx` as a thin barrel.

#### 4. Test coverage map

No test file imports from `dashboard.tsx`. No coverage. Changes here risk only manual-TUI regressions (which CLAUDE.md requires to be caught by running the dev server). **For this decomposition analysis, dashboard is lower priority because there are no tests to break — but for the same reason, any regression ships silently.**

#### 5. Proposed decomposition

| Module | Extracted from | Public API | Est. size | Parent after |
|---|---|---|---|---|
| `src/dashboard/components.tsx` | R1 (39-158) | `StatusIcon`, `ProgressBar`, `ProductivitySummary` — also needs to receive `Box`, `Text`, `Spinner` lazily (same pattern as parent) | ~125 | -120 |
| `src/dashboard/stdout-frame-buffer.ts` | R3 stdout.write interception (458-544) | `installFrameBuffer(): () => void` (returns teardown) — pure TTY escape handling, no React | ~65 | -60 |

Parent after: ~**415 lines** — `SwarmDashboard` component + `startDashboard` lifecycle wiring. Still slightly over 300. The main component is cohesive; further splitting (e.g., per-panel) would fragment without clear benefit. Accept 415.

#### 6. Execution order

1. `stdout-frame-buffer.ts` — pure, no React.
2. `components.tsx` — sub-components, isolated visuals.

Manual verification: run a swarm with `--dashboard` and confirm the TUI still renders without frame drift.

---

## Remaining 20 Files

Classification convention below: **SPLIT** = worth decomposing, **KEEP** = cohesive despite length.

1. **`src/share-parser.ts` (581)** — SPLIT. 10+ `extract*` methods for different transcript fragments (changed files, commands, tests, PR links, git commits, package operations, build operations, lint operations, MCP sections). Parallel structure, each 20-80 lines. Plan: keep `ShareParser` class as entry point (`parse`), extract a `src/share-parser/extractors/` directory with one file per extractor, each exporting a pure function `(lines, commands) => <fragment>`. New parent ~120 lines.
2. **`src/verifier-engine.ts` (577)** — SPLIT. Already has a sibling `src/verifier/outcome-checks.ts`. Extract per-check helpers (`verifyTests`, `verifyBuild`, `verifyCommits`, `verifyAllClaims`) into `src/verifier/claim-checks.ts`, and `crossReferenceEvidence` / `resolveBaseBranch` / `runGitCommand` into `src/verifier/git-helpers.ts`. `rollback` is a distinct enough concern to get its own `src/verifier/rollback.ts`. Parent (`VerifierEngine` class shell + `verifyStep` + `generateVerificationReport` + `commitVerificationReport`) ~280 lines.
3. **`src/agents-exporter.ts` (470)** — SPLIT. Three distinct concerns: KB aggregation (`aggregatePerAgent`, `classifyPattern`, `computeRecencyWeight`, `countDistinctRuns`), markdown rendering (`generateAgentMd`), diff (`computeDiff`, `extractSections`). Extract `src/agents-exporter/aggregator.ts` (~150), `src/agents-exporter/markdown-renderer.ts` (~130), `src/agents-exporter/diff.ts` (~55). Parent `AgentsExporter` class shell ~135 lines.
4. **`src/repair-agent.ts` (463)** — SPLIT (light). `buildRepairPrompt` is ~120 lines of static prompt text; extract to `src/repair-agent/prompt.ts`. `classifyFailure` + `getRepairStrategy` are pure and could pair into `src/repair-agent/failure-classifier.ts` (~40). Parent ~300 lines.
5. **`src/step-runner.ts` (443)** — SPLIT (light). `generateSessionPrompt` is ~150 lines of static text; extract to `src/step-runner/prompt.ts`. Parent ~290 lines.
6. **`src/cli/status-handlers.ts` (440)** — SPLIT. Five independent commands (`handleStatusCommand`, `handleGatesCommand`, `handleAuditCommand`, `handleMetricsCommand`, `handleDashboardCommand`, `handleReportCommand`) plus `showStatus`. Split into `src/cli/status/status.ts`, `src/cli/status/gates.ts`, `src/cli/status/audit.ts`, `src/cli/status/metrics.ts`, `src/cli/status/dashboard.ts`, `src/cli/status/report.ts`. Parent `src/cli/status-handlers.ts` becomes a re-export barrel (~30 lines) — mirrors the `src/cli/index.ts` pattern. Mechanical.
7. **`src/pr-manager.ts` (419)** — KEEP (borderline). Cohesive class wrapping `gh` CLI. Formatters (`formatPRBody`, `formatVerificationEvidence`, `formatCostComment`, `formatGateResultsComment`) could extract to `src/pr-manager/formatters.ts` for a minor win (~90 lines out); optional, not high priority.
8. **`src/branch-merger.ts` (415)** — KEEP. One responsibility (merge a set of branches with conflict/rebase fallback). Splitting along inner steps would fragment the merge algorithm.
9. **`src/context-broker.ts` (412)** — SPLIT (light). Three arguably-separable concerns: event emission + step-context store (core), filesystem-backed lock manager (`acquireGitLock`, `releaseGitLock`, `forceReleaseStaleLocks`, `acquireFileLockSync`, `releaseFileLockSync`), and dependency-wait helpers (`areDependenciesSatisfied`, `waitForDependencies`). Extract `src/context-broker/lock-manager.ts` (~130 lines) since locks are the most self-contained. Keep the rest together (~270). Lower priority.
10. **`src/verifier/outcome-checks.ts` (395)** — KEEP. Set of parallel verification checks (`checkFileExistence`, build check, test check, diff check); cohesive set, splitting would just scatter. Marginally over.
11. **`src/config-loader.ts` (390)** — KEEP (borderline). Loads agent configs from YAML + markdown custom-agent files. `parseCustomAgentFile` + `extractMarkdownSection` could extract to `src/config-loader/markdown-agent-parser.ts` (~80 lines) if this file gets edited again; otherwise leave.
12. **`src/quality-gates/gates/accessibility.ts` (381)** — KEEP. Sequential list of 12+ accessibility checks against a config. Cohesive (one gate, one purpose). The file reads top-to-bottom as a checklist.
13. **`src/cli/plan-handlers.ts` (362)** — KEEP (borderline). Three subcommands (`generatePlan`, `importPlanFromTranscript`, `executePlan`) and their dispatchers. Splitting would add one-line files with no real isolation benefit; the CLI barrel already imports them as a group.
14. **`src/repo-analyzer.ts` (355)** — SPLIT (light). Methods `detectLanguages`, `findBuildScripts`, `findTestScripts`, `extractDependencies`, `findTechDebtMarkers` are each independent filesystem scans. Extract to `src/repo-analyzer/scanners/` (one file per scan). `RepoAnalyzer` class orchestrates. Optional — each scanner is only 30-40 lines, so extraction gain is modest.
15. **`src/worktree-manager.ts` (352)** — KEEP. Cohesive `git worktree` / branch wrapper. Splitting `ensureInitialCommit` or `ensureOwnGitRepo` would strand small siblings without reducing the main file's weight meaningfully.
16. **`src/knowledge-base.ts` (340)** — KEEP. Single-concern KB persistence + pattern matching. Similarity helpers (`isSimilarInsight`, `levenshtein`) could extract but add little.
17. **`src/quick-fix-mode.ts` (325)** — KEEP. Cohesive single-task execution flow. `buildQuickFixPrompt` (~45 lines) is the only candidate; not worth a separate file.
18. **`src/copilot-cli-wrapper.ts` (317)** — KEEP. Cohesive capability detection + degraded execution. `runCommand` is tightly coupled to the wrapper's supervision logic.
19. **`src/pm-agent.ts` (308)** — KEEP. Cohesive PM-agent review flow.
20. **`src/meta-analyzer.ts` (303)** — KEEP. Barely over, single responsibility (wave analysis).

**Also worth noting for the 300-line boundary:** `src/cost-estimator.ts` is exactly 300, `src/gate-remediation.ts` is 291, `src/hook-generator.ts` is 289 — all cohesive, all KEEP.

---

## Recommended execution order across all files

Lowest risk first. Each entry is independently safe to land and ship; tests should run green after each one.

### Phase A: mechanical / no test exposure

1. `swarm-orchestrator.ts` → `orchestrator/pause-controller.ts`
2. `swarm-orchestrator.ts` → `orchestrator/git-state-utils.ts`
3. `swarm-orchestrator.ts` → `orchestrator/async-meta-analysis.ts`
4. `dashboard.tsx` → `dashboard/stdout-frame-buffer.ts`
5. `dashboard.tsx` → `dashboard/components.tsx`

### Phase B: pure-function extractions with direct test coverage

6. `plan-generator.ts` → `plan-generator/agent-assigner.ts`
7. `plan-generator.ts` → `plan-generator/criteria.ts`
8. `plan-generator.ts` → `plan-generator/validation.ts`
9. `plan-generator.ts` → `plan-generator/gate-requirements.ts`
10. `plan-generator.ts` → `plan-generator/goal-classifier.ts`
11. `plan-generator.ts` → `plan-generator/templates/*.ts` (10 files in one commit is fine — parallel structure)
12. `session-executor.ts` → `session-executor/prompt-builder.ts`

### Phase C: CLI handler splits

13. `cli/status-handlers.ts` → `cli/status/{status,gates,audit,metrics,dashboard,report}.ts` + barrel
14. `cli/swarm-handlers.ts` → `cli/swarm/run-summary.ts`
15. `cli/swarm-handlers.ts` → `cli/swarm/cost-gate.ts`
16. `cli/swarm-handlers.ts` → `cli/swarm/dashboard-binding.ts`

### Phase D: MCP and other cohesive-but-splittable modules

17. `mcp-server.ts` → `mcp/transport.ts`
18. `mcp-server.ts` → `mcp/resources.ts`
19. `mcp-server.ts` → `mcp/tools.ts`
20. `share-parser.ts` → `share-parser/extractors/*.ts`
21. `verifier-engine.ts` → `verifier/claim-checks.ts`, `verifier/git-helpers.ts`, `verifier/rollback.ts`
22. `agents-exporter.ts` → `agents-exporter/{aggregator,markdown-renderer,diff}.ts`

### Phase E: reporting and targeted helpers (post-run logic)

23. `swarm-orchestrator.ts` → **delete inline lines 909-1101 and call existing `runPostExecution` from `src/post-run-reporter.ts`** (no new module)
24. `swarm-orchestrator.ts` → `orchestrator/final-gates-remediation.ts`
25. `swarm-orchestrator.ts` → `orchestrator/replan-runner.ts`

### Phase F: highest-risk extractions (scheduler core)

26. `session-executor.ts` → `session-executor/subprocess-runner.ts`
27. `swarm-orchestrator.ts` → `orchestrator/step-executor.ts`
28. `swarm-orchestrator.ts` → `orchestrator/wave-scheduler-loop.ts`

### Phase G: optional light splits

29. `repair-agent.ts` → `repair-agent/prompt.ts`, `repair-agent/failure-classifier.ts`
30. `step-runner.ts` → `step-runner/prompt.ts`
31. `context-broker.ts` → `context-broker/lock-manager.ts`
32. `repo-analyzer.ts` → `repo-analyzer/scanners/*.ts`
33. `pr-manager.ts` → `pr-manager/formatters.ts`
34. `config-loader.ts` → `config-loader/markdown-agent-parser.ts`

Phases G items are optional — decide based on whether the parent files need to be edited again. If they do not, leave them alone.

---

## Risks and open questions

**Resolved at the top of this document (do not re-decide in Phase 2):**

- *Private-method test access* — thin private delegate methods on `SwarmOrchestrator`. No test changes.
- *Callback injection shape* — module-specific TypeScript interfaces (`SchedulerHost`, `StepExecutorHost`, `RemediationHost`, `ReplanHost`) that the class implements.
- *`context.plan` swap invariant* — re-read `context.plan.steps` every iteration in `wave-scheduler-loop.ts`; block comment at the top of the file; test in `test/wave-scheduler-replan.test.ts` locks it.
- *Circular-dependency gate* — `npm test` + `npm run build` + `madge --circular src/` after every extraction. Install madge as a dev dep if absent.
- *Post-run duplicate* — line-by-line behavioral diff before the deletion; port or explicitly remove each divergence.

**Remaining open items:**

1. **React imports in `dashboard.tsx`.** The file lazy-loads Ink via `new Function('specifier', 'return import(specifier)')` to defeat TypeScript's CJS transform. Extracted `components.tsx` will need the same `Box`, `Text`, `Spinner` references. The cleanest approach is to pass them as module-level vars (same pattern as today) or as a rendering context. Confirm the tsconfig module setting before splitting.
2. **`mcp/tools.ts` lazy `require` preservation.** The current `toolPlan` / `toolGates` / `toolCost` use `require('./plan-generator')` at call time — almost certainly to break a require cycle or defer startup cost. Extraction must preserve the lazy-require behavior.
3. **Line-count estimates are ±15%.** Use the estimates for sequencing, not as acceptance criteria.
4. **`step-executor.ts` will land at ~395 lines, over the 300 soft limit. That is intentional for Phase 2.** The plan named three sub-split candidates (replay-mode block, auto-commit block, per-adapter dispatch). All three are **deferred to Phase 3** for evaluation in a separate pass. Specifically, do NOT move the auto-commit block into `orchestrator/git-state-utils.ts` during Phase 2 — that block encodes orchestrator semantics (reserved-path excludes, per-step commit message conventions) and belongs in the executor, not a leaf-level git helper. Pulling it down would drag orchestrator-layer concerns into what should be a stateless utility.
5. **`swarm-orchestrator.ts` will land at ~800 lines after Phase 2, still well over 300. That is the designed outcome, not a partial result.** This refactor exists to separate the four entangled coordination responsibilities (scheduler, step-executor, remediation, replan) from the class shell, not to hit the line limit. The class shell retains: constructor wiring, `initializeSwarmExecution`, the top-level `executeSwarm` orchestration sequence (init → scheduler → retriable-failures replan → final-gates → merge-all → post-run), `resolveAgent`, `generateExecutionId`, pause-controller forwarding, and the thin private delegates that tests depend on. Do NOT continue cutting to shrink this further; doing so destabilizes the class surface tests depend on, for no responsibility-boundary gain.
6. **Not investigated in this pass:**
    - Whether `test/swarm-orchestrator.test.ts`'s `buildSwarmPrompt`/`runCriticReview` tests should migrate to `test/prompt-builder.test.ts` / `test/critic-reviewer.test.ts`. Recommend: leave them where they are; they assert the class's delegate contract, which is a real contract.
    - `test/cli.test.ts` and `test/cli-handlers.test.ts` — whether they dynamically or statically import from the CLI barrel. Static imports continue to work through the re-export barrel; dynamic ones need verification before the `cli/status/*` split.
