# Phase 3c: State Mutation Audit

Result: **all invariants satisfied. No ordering violations.**

Tool: `scripts/verify/state-mutation-audit.ts` (new, diagnostic only). Reads `src/swarm-orchestrator.ts`, extracts the `executeSwarm` top-level call sequence, and verifies the read-after-write orderings documented in `docs/decomposition-plan.md` (shared state map).

## Call sequence (from executeSwarm, post-decomposition)

| # | Stage | Module | Reads | Writes |
|---|---|---|---|---|
| 1 | initialize context | `SwarmOrchestrator.initializeSwarmExecution` | plan | plan, runDir, executionId, startTime, results, contextBroker, mainBranch, metricsCollector, executionQueue, queueStats, waveResizer, adaptiveConcurrency, knowledgeBase, metaAnalyzer, waveAnalyses |
| 2 | sanitize git state | `orchestrator/git-state-utils` | – | – |
| 3 | attach agents to context | (inline) | – | agents |
| 4 | seed qualityGatesTriggered flags | (inline) | – | qualityGatesTriggered |
| 5 | set initial totalWaves | (inline) | – | totalWaves |
| 6 | cost estimation | (inline) | knowledgeBase | costEstimator, costEstimate, stepCostRecords |
| 7 | scan baseline | (inline) | – | baselineSnapshot |
| 8 | filter requirements | (inline) | – | filteredRequirements |
| 9 | **SCHEDULER: run wave loop** | `orchestrator/wave-scheduler-loop` | plan, knowledgeBase, executionQueue, metaAnalyzer, contextBroker | results, queueStats, totalWaves, criticResults, leanSavedRequests, stepCostRecords, unmergedBranches, waveAnalyses |
| 10 | cleanup remaining worktrees | `SwarmOrchestrator.cleanupRemainingWorktrees` | runDir | – |
| 11 | install dependencies (post-scheduler) *(fires 2x)* | `orchestrator/git-state-utils` | – | – |
| 12 | **REPLAN: re-queue failed steps [SWAPS plan]** | `orchestrator/replan-runner` | results, plan | results, replanState, knowledgeBase |
| 13 | **REMEDIATION: final gates pipeline [SWAPS plan]** | `orchestrator/final-gates-remediation` | baselineSnapshot, filteredRequirements, qualityGatesTriggered, agents, plan, results | finalGateResults, qualityGatesTriggered, plan, results, replanState, unmergedBranches |
| 14 | merge all branches | `BranchMerger` via `SwarmOrchestrator.mergeAllBranches` | results, runDir, mainBranch, contextBroker | unmergedBranches |
| 15 | **POST-RUN: finalize metrics, cost, session state, OWASP, auto-PR** | `post-run-reporter` | metricsCollector, costEstimate, costEstimator, stepCostRecords, results, knowledgeBase, waveAnalyses, finalGateResults, baselineSnapshot, executionId, mainBranch, plan | – (writes to filesystem, not context) |

Stage 11 fires twice — once at `src/swarm-orchestrator.ts:448` after the scheduler, once at line 495 after the retriable-failures replan (stage 12). The script collapses duplicates and annotates `(fires 2x)` on the first occurrence.

## Invariant results

| Field | Writer stage | Reader stage | Status |
|---|---|---|---|
| `results[]` | 9 SCHEDULER | 15 POST-RUN | ✔ 9 < 15 |
| `finalGateResults` | 13 REMEDIATION | 15 POST-RUN | ✔ 13 < 15 |
| `stepCostRecords` (appends) | 9 SCHEDULER | 15 POST-RUN | ✔ 9 < 15 |
| `qualityGatesTriggered` (seed) | 4 (inline seed) | 13 REMEDIATION | ✔ 4 < 13 |
| `baselineSnapshot` | 7 scan | 13 REMEDIATION | ✔ 7 < 13 |
| `filteredRequirements` | 8 filter | 13 REMEDIATION | ✔ 8 < 13 |
| `costEstimate` | 6 estimate | 9 SCHEDULER (step-executor lookup) | ✔ 6 < 9 |

All seven read-after-write invariants hold.

## Plan-swap invariant (within scheduler, not a cross-stage check)

Stages 12 and 13 both may reassign `context.plan` (stage 12 directly in `executeReplan`; stage 13 indirectly via its internal `executeReplan` calls). The scheduler (stage 9) completes before either, so the runtime invariant the plan-swap concerns is *within-scheduler*: if a future change causes a replan to fire from inside the scheduler loop (e.g., from step-executor via hooks), the scheduler must still see the swapped plan on the next iteration.

- Lock-in test: `test/wave-scheduler-replan.test.ts` (new in Phase 2c, passing on HEAD).
- Within-scheduler re-read verified statically in Phase 3b section 1 (`context.plan.steps` re-read at `wave-scheduler-loop.ts` lines 263, 271, 340, 362, 405).

This static audit does not simulate the runtime behavior; the combination of the lock-in test and the trace report covers it.

## Verdict

No ordering violations. No halt.
