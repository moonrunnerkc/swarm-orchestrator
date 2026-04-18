# Architecture — Module Reference

> For a project overview, see [README.md](README.md). For the high-level pipeline and system diagram, see [Architecture](README.md#architecture).

112 source files, 26,653 lines of TypeScript.

## Core Orchestration

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `swarm-orchestrator.ts` | 2,090 | Greedy scheduler, event-driven dependency resolution, octopus merge, multi-repo grouping, governance, lean mode, replay, cost tracking, merge orchestration |
| `plan-generator.ts` | 996 | Plan creation, dependency validation, Copilot-assisted generation, plan-cache short-circuit |
| `session-executor.ts` | 671 | Copilot CLI subprocess management, transcript capture, /fleet prompt wrapping |
| `step-runner.ts` | 434 | Single-step execution with branch setup, context injection, cleanup |
| `branch-merger.ts` | 412 | Branch merge operations: octopus merge, sequential fallback, conflict detection |
| `context-broker.ts` | 412 | Shared state, EventEmitter-based step completion signaling, git locking, dependency context injection, strict isolation filter |
| `steering-router.ts` | 290 | Human-in-the-loop commands during execution |
| `bootstrap-orchestrator.ts` | 208 | Multi-repo bootstrap coordination, relationship detection, grouped execution |
| `prompt-builder.ts` | 173 | Prompt construction for agent steps: context assembly, template rendering |
| `wave-resizer.ts` | 166 | Adaptive wave splitting, merging, and concurrency adjustment |
| `wave-scheduler.ts` | 51 | Wave scheduling: topological sort, dependency grouping, greedy dispatch |

## Verification & Quality

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `share-parser.ts` | 715 | Transcript parsing: files, commands, tests, commits, claims, MCP evidence |
| `verifier-engine.ts` | 622 | Evidence checking against transcripts (accepts pre-parsed index to avoid double parse), verification report generation |
| `repair-agent.ts` | 452 | Self-repair loop with failure classification, targeted strategies, context accumulation |
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
| `cli-handlers.ts` | 62 | Legacy barrel — re-exports from `src/cli/` sub-modules (no logic) |
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
