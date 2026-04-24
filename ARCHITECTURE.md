# Architecture: Module Reference

> For a project overview, see [README.md](README.md). For the high-level pipeline and system diagram, see [Architecture](README.md#architecture).

119 source files, 27,825 lines of TypeScript.

## Core Orchestration

`SwarmOrchestrator` is a coordinator class that implements four host interfaces (`RemediationHost`, `ReplanHost`, `StepExecutorHost`, `SchedulerHost`) and delegates their work to submodules under `src/orchestrator/`. It owns shared state: `ContextBroker`, `MetricsCollector`, `WorktreeManager`, `BranchMerger`, `PauseController`. See the v6.1.0 release notes for the decomposition rationale.

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `swarm-orchestrator.ts` | 870 | Coordinator: owns shared state, wires host interfaces, holds merge and worktree-cleanup helpers. Delegates scheduling, step execution, replan, and final-gate remediation to `orchestrator/` submodules |
| `plan-generator.ts` | 1,396 | Plan creation, dependency validation, Copilot-assisted generation, plan-cache short-circuit |
| `session-executor.ts` | 690 | Copilot CLI subprocess management, transcript capture, /fleet prompt wrapping |
| `step-runner.ts` | 443 | Single-step execution with branch setup, context injection, cleanup |
| `branch-merger.ts` | 415 | Branch merge operations: octopus merge, sequential fallback, conflict detection |
| `context-broker.ts` | 412 | Shared state, EventEmitter-based step completion signaling, git locking, dependency context injection, strict isolation filter |
| `bootstrap-orchestrator.ts` | 208 | Multi-repo bootstrap coordination, relationship detection, grouped execution |
| `prompt-builder.ts` | 210 | Prompt construction for agent steps: context assembly, template rendering |
| `wave-resizer.ts` | 165 | Adaptive wave splitting, merging, and concurrency adjustment |
| `wave-scheduler.ts` | 51 | Pure topological-sort helper: dependency grouping, wave identification |

### `src/orchestrator/` (extracted in v6.1.0)

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `step-executor.ts` | 563 | `StepExecutorHost`: single-step execution pipeline including session launch, verification, repair, and cost attribution |
| `wave-scheduler-loop.ts` | 485 | `SchedulerHost`: greedy per-wave dispatch loop, event-driven dependency resolution, adaptive concurrency |
| `final-gates-remediation.ts` | 432 | `RemediationHost`: post-merge quality-gate pipeline plus remediation-step synthesis |
| `replan-runner.ts` | 369 | `ReplanHost`: replan execution, retry-branch bookkeeping, failed-step objective carry-forward |
| `async-meta-analysis.ts` | 121 | Fire-and-forget wave health analysis |
| `git-state-utils.ts` | 89 | Pre-run git sanitize plus `npm install` gating |
| `pause-controller.ts` | 55 | Pause/resume signal coordination for steering |

## Verification & Quality

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `share-parser.ts` | 581 | Transcript parsing: files, commands, tests, commits, claims, MCP evidence. Claim-verification logic extracted to `share/transcript-verification.ts` (stage-4b) |
| `verifier-engine.ts` | 577 | Evidence checking orchestration (accepts pre-parsed index to avoid double parse); delegates outcome and transcript checks plus report generation to `verifier/` submodules (stage-4a) |
| `repair-agent.ts` | 463 | Self-repair loop with failure classification, targeted strategies, context accumulation |
| `share/transcript-verification.ts` | 148 | Claim-verification logic extracted from `share-parser.ts` |
| `verifier/outcome-checks.ts` | 395 | Filesystem and runtime evidence checks |
| `verifier/transcript-checks.ts` | 225 | Transcript-derived evidence checks |
| `verifier/verification-reporters.ts` | 136 | Markdown and JSON verification report rendering |
| `meta-analyzer.ts` | 305 | Wave health scoring, pattern detection, replan decisions |
| `gate-remediation.ts` | 284 | Quality-gate failure remediation: auto-fix strategies for gate violations |
| `critic-reviewer.ts` | 65 | Governance critic scoring: weighted axis evaluation, approve/reject/revise |
| `commit-quality-analyzer.ts` | 53 | Commit message quality analysis and scoring |

## Cost & Metrics

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `knowledge-base.ts` | 340 | Persistent cross-run pattern storage (including cost history), Levenshtein similarity, findSimilarTasks |
| `cost-estimator.ts` | 300 | Pre-execution cost prediction with model multipliers, retry calibration, knowledge base integration |
| `post-run-reporter.ts` | 240 | Post-execution summary with cost attribution, next-step guidance, and artifact locations |
| `metrics-collector.ts` | 186 | Metrics tracking, session save/load, audit report generation |

## CLI

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `cli/swarm-handlers.ts` | 729 | Swarm execution commands: bootstrap, run, swarm, quick |
| `cli/status-handlers.ts` | 440 | Status, metrics, audit, dashboard, agents commands |
| `cli/plan-handlers.ts` | 362 | Plan generation, template listing, plan management |
| `cli/demo-handlers.ts` | 263 | Demo scenario execution and listing |
| `cli/misc-handlers.ts` | 228 | Gates, report, recipe commands |
| `cli.ts` | 205 | Command dispatch entry point, routes to CLI sub-modules |
| `cli/flags.ts` | 200 | Centralized flag parsing and validation |
| `cli/share-handlers.ts` | 183 | Share/transcript import and export |
| `cli/usage.ts` | 75 | Help text and usage formatting |
| `cli/index.ts` | 62 | Barrel re-exporting `src/cli/` sub-modules (replaces the former `src/cli-handlers.ts`; no logic) |
| `cli/cost-prompt.ts` | 24 | Interactive cost confirmation prompt |

## Agents & Adapters

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `config-loader.ts` | 390 | YAML agent profile loading with validation and merge |
| `copilot-cli-wrapper.ts` | 317 | CLI wrapper with strict isolation guard and degraded fallback |
| `pm-agent.ts` | 308 | Plan validation: cycles, unknown agents, stale metadata |
| `adapters/claude-code-teams.ts` | 161 | Claude Code Agent Teams adapter with fallback to standard adapter |
| `fleet-wrapper.ts` | 101 | /fleet prompt prefix, version detection, subagent count heuristic |

## Reporting & UI

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `dashboard.tsx` | 561 | TUI dashboard with real-time progress, repo status, per-axis critic scores, lean savings |
| `owasp-mapper.ts` | 206 | Maps verification results to OWASP ASI Top 10 risk assessments |
| `report-generator.ts` | 183 | Assembles structured run reports from execution artifacts |
| `logger.ts` | 103 | Structured leveled logger (error/warn/info/debug) replacing raw console calls |
| `report-renderer.ts` | 89 | Renders run reports to Markdown, JSON, and single-line TUI summary |
| `owasp-report-renderer.ts` | 43 | Renders OWASP compliance reports to Markdown and JSON |

## Other

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `repo-analyzer.ts` | 355 | Codebase scanning for languages, deps, build scripts, tech debt |
| `quick-fix-mode.ts` | 325 | Single-agent quick task runner |
| `deployment-manager.ts` | 250 | Preview deployment, tag/health-check/rollback cycle, deployment metadata persistence |
| `demo-mode.ts` | 164 | Two demo scenarios (demo-fast, api-quick) with agent prompts and expected outputs |
| `recipe-loader.ts` | 123 | Recipe loading, parameterization, listing |
| `deployment-handler.ts` | 93 | Deployment step execution: tag, health-check, rollback cycle |

## Output Artifacts

```
runs/<execution-id>/
  session-state.json                    # full execution state (resumable)
  metrics.json                          # timing, commit count, verification stats
  cost-attribution.json                 # per-step estimated vs actual premium requests
  knowledge-base.json                   # patterns learned from this run (including cost history)
  wave-N-analysis.json                  # per-wave health assessment
  report.md                             # structured run report (with swarm report)
  report.json                           # machine-readable run report
  owasp-compliance.md                   # OWASP ASI compliance report (with --owasp-report)
  owasp-compliance.json                 # machine-readable OWASP report
  steps/
    step-N/share.md           # raw agent transcript
  verification/
    step-N-verification.md    # outcome-based pass/fail report
```
