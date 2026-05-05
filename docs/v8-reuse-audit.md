# v8 Reuse Audit (Phase 0)

Branch: v8-dev
Date: 2026-05-05
Reference: v8-overhaul-guide.md (architecture), v8-implementation-guide.md Section 2 (module inventory)

Classification counts: **52 KEPT-UNCHANGED | 74 MODIFIED | 28 DELETED**

---

## src/adapters/

### src/adapters/adapter-factory.ts
Status: MODIFIED
Rationale: Factory and registry survive for CLI fallback mode resolution, but the registry must accommodate v8 session adapters alongside existing CLI adapters.
Modification scope:
- Add v8 session adapter type to registry
- Gate CLI adapter instantiation behind fallback-mode detection
- Update type signatures to accept v8 adapter options

### src/adapters/agent-adapter.ts
Status: MODIFIED
Rationale: AgentAdapter interface survives as the contract for CLI fallback adapters, but needs a parallel v8 session adapter interface for the default shared-inference path.
Modification scope:
- Add or import v8 session adapter interface type
- Widen `AgentSpawnOptions` for v8 session parameters (persona, contract obligation)
- Update `buildRestrictedEnv` to support v8 session context

### src/adapters/claude-code-adapter.ts
Status: MODIFIED
Rationale: Adapter survives in CLI fallback mode per implementation guide Section 2; no longer the default execution path.
Modification scope:
- Add fallback-mode guard that skips when v8 shared session is active
- Preserve premium-request cost parsing for fallback cost attribution

### src/adapters/claude-code-teams.ts
Status: MODIFIED
Rationale: Teams adapter survives in CLI fallback mode; v8's parallelism comes from tournaments, not CLI team dispatch.
Modification scope:
- Add fallback-mode guard
- Preserve team-lead fallback logic for CLI isolation users

### src/adapters/codex-adapter.ts
Status: MODIFIED
Rationale: Codex adapter survives in CLI fallback mode per implementation guide Section 2.
Modification scope:
- Add fallback-mode guard

### src/adapters/copilot-adapter.ts
Status: MODIFIED
Rationale: Copilot adapter survives in CLI fallback mode per implementation guide Section 2; premium-request parsing preserved for fallback cost tracking.
Modification scope:
- Add fallback-mode guard
- Preserve billing-accurate premium-request parsing

### src/adapters/fatal-error-classifier.ts
Status: MODIFIED
Rationale: Fatal error classification is still needed for CLI fallback mode, but v8 may introduce session-level error categories (cache expiry, contract violation).
Modification scope:
- Add v8 session error signatures (cache-miss, contract-violation, session-expired)
- Preserve existing CLI error patterns for fallback

### src/adapters/index.ts
Status: MODIFIED
Rationale: Barrel re-exports must be updated for v8 adapter types and fallback-mode utilities.
Modification scope:
- Export v8 session adapter interface
- Export fallback-mode detection helper

### src/adapters/persistent-session.ts
Status: MODIFIED
Rationale: Long-lived CLI child-process session survives for CLI fallback mode; v8's shared inference session is a fundamentally different construct (API-level, not subprocess-level).
Modification scope:
- Add fallback-mode guard
- Preserve end-of-turn token marker logic for fallback use

### src/adapters/process-supervisor.ts
Status: MODIFIED
Rationale: Subprocess supervision survives for CLI fallback mode; no changes to stall detection or shutdown logic, but needs fallback-mode awareness.
Modification scope:
- Add fallback-mode guard or conditional initialization
- Preserve heartbeat and line-buffered capture for fallback

---

## src/

### src/agents-exporter.ts
Status: MODIFIED
Rationale: Agent config export concept survives but adapts to the persona registry model; `.agent.md` generation may continue for CLI fallback, but v8 personas have a different config surface.
Modification scope:
- Add persona-to-agent-md bridge for CLI fallback
- Adapt knowledge-base queries to ledger-based cost/behavior data
- Preserve recency-weighted aggregation logic

### src/analytics-log.ts
Status: MODIFIED
Rationale: Append-only analytics log concept survives, but metric schema changes for v8 (tournaments, ledger entries, cache hit rates).
Modification scope:
- Add v8 metric fields (tournament count, cache hit rate, obligation pass/fail)
- Update historical averaging to include v8 metrics
- Preserve append-only file structure

### src/baseline-scanner.ts
Status: KEPT-UNCHANGED
Rationale: Git-based repository file enumeration is architecture-independent; used identically for pre-generation verification context.

### src/bootstrap-evidence.ts
Status: MODIFIED
Rationale: Evidence persistence survives but format adapts to ledger-based storage; bootstrap artifacts feed the contract compiler instead of the plan generator.
Modification scope:
- Replace plan-artifact persistence with contract-artifact persistence
- Adapt versioned JSON schema to contract model
- Preserve file I/O patterns

### src/bootstrap-orchestrator.ts
Status: MODIFIED
Rationale: Bootstrap pipeline survives but replaces plan generation with contract compilation; repo analysis and GitHub issue ingestion still inform the contract compiler.
Modification scope:
- Replace `PlanGenerator` call with contract compiler invocation
- Adapt pipeline stages to contract model (analyze → compile contract → persist)
- Preserve repo analysis, cross-repo, and GitHub issue stages

### src/bootstrap-types.ts
Status: MODIFIED
Rationale: Type definitions adapt to the contract model; `AnnotatedPlanStep` and related plan types are replaced by contract obligation types.
Modification scope:
- Replace `AnnotatedPlanStep` with contract obligation type
- Add contract-related type definitions
- Preserve `RepoAnalysis`, `CrossRepoRelationship`, `GitHubIssueReference` types

### src/branch-merger.ts
Status: KEPT-UNCHANGED
Rationale: Git merge strategies (rebase+ff, -X theirs, conflict resolution) are architecture-independent; tournament winners merge via the same git operations.

### src/cli.ts
Status: MODIFIED
Rationale: Main CLI entry point needs v8 subcommand dispatch (`swarm v8 compile`, `swarm v8 run`, `swarm v8 resume`) alongside existing v6 commands.
Modification scope:
- Add `v8` subcommand group dispatch
- Import v8 CLI handler module
- Preserve existing v6 command dispatch for migration period

### src/cli/attest-handlers.ts
Status: KEPT-UNCHANGED
Rationale: Attestation verification operates on git note format, which is independent of the orchestration architecture.

### src/cli/cost-prompt.ts
Status: MODIFIED
Rationale: Cost estimation prompt adapts to v8 cache-aware pricing model; estimated token ranges and cost structure differ.
Modification scope:
- Update cost estimation display for cache-aware input pricing
- Add tournament cost projection (N candidates × cached input)
- Preserve user confirmation flow

### src/cli/demo-handlers.ts
Status: MODIFIED
Rationale: Demo scenarios adapt to contract-based execution; demo goals become contract compilation + v8 run instead of plan + swarm.
Modification scope:
- Add v8 demo execution path (compile contract → run)
- Preserve scenario listing and temp-directory scaffolding
- Adapt post-demo dependency installation for v8 output

### src/cli/flags.ts
Status: MODIFIED
Rationale: CLI flags need v8-specific options (`--v8`, `--contract-only`, `--cost-cap`, `--persona`).
Modification scope:
- Add `ExecuteV8CliOptions` type with contract, persona, cost-cap fields
- Add `--v8` flag parser
- Preserve existing v6 flag parsers for migration period

### src/cli/index.ts
Status: MODIFIED
Rationale: Barrel updates to include v8 CLI handlers and flag types.
Modification scope:
- Export v8 handler module
- Export v8 flag types

### src/cli/live-status.ts
Status: MODIFIED
Rationale: Live status display adapts to tournament/ledger view; step-progress blocks become obligation-progress with candidate status.
Modification scope:
- Add tournament candidate status rendering
- Add obligation satisfaction progress display
- Preserve ANSI spinner and TTY detection

### src/cli/misc-handlers.ts
Status: MODIFIED
Rationale: Recipe handlers (`swarm use`, `swarm recipes`) become contract template handlers per migration plan; `swarm agents export` adapts to persona registry.
Modification scope:
- Replace recipe execution with contract template compilation
- Update recipe listing to show contract templates
- Adapt `agents export` to persona-registry data source

### src/cli/plan-handlers.ts
Status: DELETED
Rationale: `swarm plan` and `swarm execute` commands are replaced by `swarm v8 compile` and `swarm v8 run` in the contract model.

### src/cli/share-handlers.ts
Status: DELETED
Rationale: /share transcript import and context display are replaced by ledger-based state management; v8 does not use transcript-centric workflows.

### src/cli/status-handlers.ts
Status: MODIFIED
Rationale: Status queries adapt to ledger-based run state; gate/audit/metrics/report subcommands reference contract obligations and ledger entries.
Modification scope:
- Adapt `swarm status` to read ledger state
- Adapt `swarm gates` to run against contract obligation results
- Preserve SARIF output support

### src/cli/swarm-handlers.ts
Status: MODIFIED
Rationale: Swarm run command becomes v8 run entry point; the `--v8` flag routes to contract-based execution.
Modification scope:
- Add v8 run dispatch path (contract compilation → tournament execution)
- Preserve v6 run path for migration period
- Adapt cost estimation and auth checks for v8

### src/cli/usage.ts
Status: MODIFIED
Rationale: Help text must document v8 subcommands and new flags.
Modification scope:
- Add v8 command group to usage text
- Update flag documentation

### src/commit-pattern-detector.ts
Status: KEPT-UNCHANGED
Rationale: Commit quality analysis (anti-pattern detection, scoring) is architecture-independent.

### src/commit-quality-analyzer.ts
Status: KEPT-UNCHANGED
Rationale: Commit quality analysis wrapper is architecture-independent.

### src/config-loader.ts
Status: MODIFIED
Rationale: Agent config loading adapts to persona/CLI fallback model; v8 personas have a different config surface (system-prompt slices, sampling regimes, model tiers).
Modification scope:
- Add persona config loading path
- Preserve agent YAML/markdown loading for CLI fallback mode
- Merge persona and agent config where they coexist

### src/context-broker.ts
Status: DELETED
Rationale: Cross-agent state coordination via file locks and EventEmitter is replaced by the evidence ledger, which provides stigmergic coordination via append-only reads.

### src/copilot-cli-wrapper.ts
Status: MODIFIED
Rationale: Copilot CLI resilience wrapper survives for CLI fallback mode; capability detection and retry logic still needed.
Modification scope:
- Add fallback-mode guard
- Preserve retry and graceful-degradation logic

### src/cost-estimator.ts
Status: MODIFIED
Rationale: Concept survives per implementation guide Section 2; multipliers updated for prompt-cache-aware pricing (90% discount on cached input tokens) and tournament candidate costs.
Modification scope:
- Add cache-aware input token cost calculation (full price vs 10% cached price)
- Add tournament cost model (N candidates × variable portion)
- Add WASM deterministic floor cost (zero LLM tokens)
- Remove retry-probability calibration (no repair loops in v8)
- Preserve premium-request budget caps

### src/defaults.ts
Status: MODIFIED
Rationale: Default constants change for v8: retry/replan defaults removed, tournament parameters added, cache TTL defaults introduced.
Modification scope:
- Remove retry probability and remediation rate defaults
- Add tournament candidate count default (2-4)
- Add cache TTL and breakpoint defaults
- Add obligation round cap default (3)
- Preserve timeout and heartbeat interval defaults

### src/demo-mode.ts
Status: MODIFIED
Rationale: Demo scenarios become contract-based; seed files and goals translate to contract compilation + v8 run instead of plan generation + swarm execution.
Modification scope:
- Convert demo goal definitions to contract compilation targets
- Replace ExecutionPlan construction with contract construction
- Preserve demo scaffolding and temp-directory logic

### src/deployment-handler.ts
Status: KEPT-UNCHANGED
Rationale: Preview deployment execution is architecture-independent; tagging, health checks, and rollback operate the same way.

### src/deployment-manager.ts
Status: KEPT-UNCHANGED
Rationale: Deployment platform detection and management is architecture-independent.

### src/execution-queue.ts
Status: DELETED
Rationale: Priority execution queue serves the greedy scheduler; v8's stigmergic coordination has no central dispatch queue.

### src/external-tool-manager.ts
Status: KEPT-UNCHANGED
Rationale: External tool management (gh, vercel, netlify) with safety gating is architecture-independent.

### src/gate-prompt-builder.ts
Status: DELETED
Rationale: Quality-gate requirements are encoded as contract obligations and persona system-prompt slices in v8, not injected as per-step prompt clauses.

### src/gate-remediation.ts
Status: DELETED
Rationale: Gate-failure remediation via repair/replan cycles is eliminated in v8; failed obligations are re-escalated via tournament diversity injection, not repair.

### src/github/comment-body-builder.ts
Status: KEPT-UNCHANGED
Rationale: Verification-finding-to-markdown formatting is architecture-independent.

### src/github/comment-dedup.ts
Status: KEPT-UNCHANGED
Rationale: SHA-256 deduplication and marker reconciliation are architecture-independent.

### src/github/diff-position-resolver.ts
Status: KEPT-UNCHANGED
Rationale: Unified-diff line resolution for GitHub review API anchoring is architecture-independent.

### src/github/review-comment-fetcher.ts
Status: KEPT-UNCHANGED
Rationale: Octokit review comment fetching is architecture-independent.

### src/github/review-poster.ts
Status: KEPT-UNCHANGED
Rationale: PR review posting with deduplication is architecture-independent.

### src/github-issues-ingester.ts
Status: MODIFIED
Rationale: Issue ingestion still useful for deriving contract goals from open issues, but the output feeds the contract compiler instead of the plan generator.
Modification scope:
- Change output target from plan goals to contract goal candidates
- Preserve `gh` CLI fetching and keyword matching

### src/github-mcp-integrator.ts
Status: MODIFIED
Rationale: MCP integration adapts to v8 persona context; prompt sections and evidence validation reference contract obligations.
Modification scope:
- Adapt MCP prompt sections for persona consumption
- Update evidence validation to check ledger entries
- Preserve PR URL extraction

### src/hook-generator.ts
Status: MODIFIED
Rationale: Copilot CLI hook generation survives for CLI fallback mode scope enforcement; v8's shared inference session does not use CLI hooks.
Modification scope:
- Add fallback-mode guard
- Preserve scope boundary enforcement and evidence capture hooks

### src/index.ts
Status: MODIFIED
Rationale: Public API barrel re-exports adapt to v8 module structure (contract compiler, population manager, ledger, persona registry).
Modification scope:
- Export v8 public classes and types
- Gate v6 exports behind migration compatibility layer
- Update re-exports to reflect new module boundaries

### src/knowledge-base.ts
Status: MODIFIED
Rationale: Kept as the storage layer beneath the evidence ledger per implementation guide Section 2; append-only hash-chain semantics are added on top for ledger integrity.
Modification scope:
- Add hash-chain entry format (prior-entry hash, persona identity, contract obligation reference)
- Add ledger-specific query methods (by obligation, by persona, by timestamp)
- Preserve insight deduplication, auto-pruning, and Levenshtein task matching
- Add IRONROOT hash-chain integration

### src/logger.ts
Status: KEPT-UNCHANGED
Rationale: Scoped leveled logger is architecture-independent; v8 uses the same logging interface.

### src/meta-analyzer.ts
Status: DELETED
Rationale: Wave-level meta-analysis for replan decisions is eliminated; v8 has no replan mechanism and no wave-level coordination.

### src/metrics-collector.ts
Status: MODIFIED
Rationale: Metrics collection adapts to v8 concepts (tournaments, obligations, ledger entries, cache hit rates) replacing v6 concepts (waves, steps, retries).
Modification scope:
- Add tournament and obligation metrics (candidates, scores, rounds)
- Add cache hit rate and effective input token tracking
- Remove retry/replan/recovery metrics
- Add persona utilization metrics
- Preserve session-state persistence and markdown audit report generation

### src/metrics-types.ts
Status: MODIFIED
Rationale: Metric type definitions adapt to v8 metric schema (tournaments, obligations, cache) replacing v6 schema (waves, steps, retries).
Modification scope:
- Add tournament, obligation, and persona metric interfaces
- Add cache hit rate and effective token cost types
- Remove retry/recovery event types
- Preserve cost attribution record types (extend with per-persona per-obligation breakdown)

### src/multi-repo-coordinator.ts
Status: MODIFIED
Rationale: Cross-repo relationship analysis survives for multi-repo contracts; relationship identification informs contract obligation dependencies across repositories.
Modification scope:
- Adapt output to feed contract compiler dependency detection
- Preserve API dependency, shared schema, and build coupling analysis

---

## src/orchestrator/

### src/orchestrator/async-meta-analysis.ts
Status: DELETED
Rationale: Off-critical-path meta-analysis feeds replan decisions; v8 has no replan mechanism.

### src/orchestrator/end-of-run-battery.ts
Status: MODIFIED
Rationale: Falsification battery concept survives as post-merge verification (v8 architecture Layer 5), but adapts to contract obligation context and ledger-based evidence.
Modification scope:
- Adapt battery preparation to contract obligation results
- Replace step-based file selection with obligation-affected file selection
- Preserve five-layer battery execution sequence

### src/orchestrator/fatal-run-error.ts
Status: MODIFIED
Rationale: Fatal error concept survives, but error categories adapt to v8 session model (cache expiry, contract impossibility, persona exhaustion).
Modification scope:
- Add v8-specific fatal error categories
- Preserve existing CLI-level fatal patterns for fallback mode

### src/orchestrator/final-gates-remediation.ts
Status: DELETED
Rationale: Quality-gate failure remediation via repair/replan is eliminated; v8 escalates via tournament diversity injection, not remediation.

### src/orchestrator/git-state-utils.ts
Status: KEPT-UNCHANGED
Rationale: Git state cleanup (aborting pending merges, resetting unmerged entries, pruning stale worktrees) is architecture-independent.

### src/orchestrator/pause-controller.ts
Status: DELETED
Rationale: Scheduler pause/resume handshake is eliminated; v8's stigmergic coordination has no central scheduler to pause.

### src/orchestrator/post-battery-attestation.ts
Status: KEPT-UNCHANGED
Rationale: SLSA v1.0 in-toto attestation generation and git-note attachment is architecture-independent.

### src/orchestrator/pre-worker-synthesis.ts
Status: DELETED
Rationale: Pre-worker failing-intent-test synthesis is replaced by v8's pre-generation verification (ledger checks whether obligation is already satisfied).

### src/orchestrator/replan-runner.ts
Status: DELETED
Rationale: Replan execution via RepairAgent is eliminated; v8 replaces repair with tournament re-escalation and diversity injection.

### src/orchestrator/step-executor.ts
Status: DELETED
Rationale: Per-step end-to-end execution (worktree → prompt → session → verify → commit) is replaced by tournament-based obligation satisfaction in v8.

### src/orchestrator/wave-scheduler-loop.ts
Status: DELETED
Rationale: Greedy as-soon-as-ready scheduler loop is replaced by stigmergic coordination; v8 has no central dispatch.

---

## src/ (continued)

### src/owasp-mapper.ts
Status: KEPT-UNCHANGED
Rationale: OWASP ASI risk assessment mapping is architecture-independent; governance positioning survives unchanged.

### src/owasp-report-renderer.ts
Status: KEPT-UNCHANGED
Rationale: OWASP compliance report rendering is architecture-independent.

### src/plan-files.ts
Status: DELETED
Rationale: Plan JSON file I/O is replaced by contract serialization (JSONL, hash-referenced from ledger).

### src/plan-generator.ts
Status: DELETED
Rationale: Plans are replaced by contracts per implementation guide Section 2; the contract compiler is a new component.

### src/pm-agent.ts
Status: DELETED
Rationale: Plan review is replaced by contract validation (internal consistency checks) and user-approval step in the contract compiler.

### src/post-run-reporter.ts
Status: MODIFIED
Rationale: Post-run artifact persistence adapts to ledger-based format; session-state and cost-attribution JSON adapt to contract/ledger schema.
Modification scope:
- Replace session-state persistence with ledger state persistence
- Extend cost-attribution with per-persona per-obligation breakdown
- Preserve metrics, OWASP compliance, and knowledge-base update paths
- Adapt auto-PR creation for contract-based run summaries

### src/pr-automation.ts
Status: MODIFIED
Rationale: PR automation adapts to contract-based run summaries; execution summary format includes contract obligations and ledger evidence.
Modification scope:
- Adapt execution summary to include contract obligation results
- Preserve `gh` CLI PR creation and deployment link inclusion

### src/pr-manager.ts
Status: MODIFIED
Rationale: Per-step PR lifecycle adapts to per-obligation or per-tournament PR model; cost/gate evidence comments reference contract obligations.
Modification scope:
- Adapt PR creation to obligation-level granularity
- Update cost/gate evidence comments for contract context
- Preserve branch push, approval polling, and auto-merge flows

### src/presenter/index.ts
Status: MODIFIED
Rationale: Presentation layer adapts to v8 output format; plan summaries become contract summaries, gate-running indicators become obligation-check indicators.
Modification scope:
- Add contract summary presentation (obligation count, types)
- Add tournament result presentation (candidate scores, winner)
- Adapt final result summary for contract pass/fail
- Preserve banner and quiet-mode logic

### src/prompt-builder.ts
Status: DELETED
Rationale: Per-step prompt construction for CLI agents is replaced by persona system-prompt slices and contract obligation context in v8.

### src/quick-fix-mode.ts
Status: DELETED
Rationale: Single-agent bypass mode is unnecessary; v8 has a proper single-persona execution path (Phase 2) and tournament path (Phase 3).

---

## src/quality-gates/

### src/quality-gates/config-loader.ts
Status: KEPT-UNCHANGED
Rationale: Gate config loading and merging from three layers is architecture-independent.

### src/quality-gates/default-config.ts
Status: MODIFIED
Rationale: Default gate configuration values may change for v8 context (e.g., different thresholds for contract-aware execution).
Modification scope:
- Review and update threshold defaults for v8 execution context
- Preserve all nine built-in gate configurations

### src/quality-gates/file-utils.ts
Status: KEPT-UNCHANGED
Rationale: Recursive file listing, binary detection, and exclusion matching are architecture-independent.

### src/quality-gates/gate-runner.ts
Status: MODIFIED
Rationale: Gate execution runner adapts to contract-aware context; target-mode and requirement filtering reference contract obligation types.
Modification scope:
- Adapt target-mode skip logic for contract obligation context
- Update requirement-based downgrade to use contract types
- Preserve gate execution, result collection, and report writing

### src/quality-gates/gates/accessibility.ts
Status: KEPT-UNCHANGED
Rationale: Accessibility checks (lang attributes, heading hierarchy, aria-labels, focus styles) are architecture-independent.

### src/quality-gates/gates/duplicate-blocks.ts
Status: KEPT-UNCHANGED
Rationale: Duplicate code block detection via normalized line hashing is architecture-independent.

### src/quality-gates/gates/hardcoded-config.ts
Status: KEPT-UNCHANGED
Rationale: Hardcoded configuration value detection is architecture-independent.

### src/quality-gates/gates/readme-claims.ts
Status: KEPT-UNCHANGED
Rationale: README claim verification against source files is architecture-independent.

### src/quality-gates/gates/runtime-checks.ts
Status: KEPT-UNCHANGED
Rationale: Runtime test/lint/audit execution is architecture-independent.

### src/quality-gates/gates/scaffold-defaults.ts
Status: KEPT-UNCHANGED
Rationale: Scaffold/boilerplate leftover detection is architecture-independent.

### src/quality-gates/gates/test-coverage.ts
Status: KEPT-UNCHANGED
Rationale: Test coverage and assertion checks are architecture-independent.

### src/quality-gates/gates/test-file-protection.ts
Status: KEPT-UNCHANGED
Rationale: Pre-existing test file modification detection is architecture-independent.

### src/quality-gates/gates/test-isolation.ts
Status: KEPT-UNCHANGED
Rationale: Mutable module-scope store and reset-hook detection is architecture-independent.

### src/quality-gates/index.ts
Status: MODIFIED
Rationale: Barrel updates for v8 type exports.
Modification scope:
- Export v8 context types if added
- Preserve existing public API surface

### src/quality-gates/registry.ts
Status: MODIFIED
Rationale: Gate registration may add contract-gated plugin support; SELF_IMPROVEMENT_GATE_KEYS may be re-evaluated for v8.
Modification scope:
- Review SELF_IMPROVEMENT_GATE_KEYS for v8 relevance
- Preserve built-in gate registration and project plugin loading

### src/quality-gates/types.ts
Status: MODIFIED
Rationale: Type definitions may extend for v8 context (contract obligation reference in GateContext).
Modification scope:
- Add optional contract obligation reference to GateContext
- Preserve existing gate result and config types

---

## src/ (continued)

### src/recipe-loader.ts
Status: MODIFIED
Rationale: Recipes become contract templates per migration plan (implementation guide Section 12); template parameter substitution survives but output is a contract, not a plan.
Modification scope:
- Change output type from ExecutionPlan to contract draft
- Preserve `{{param}}` placeholder substitution
- Preserve built-in recipe directory loading

### src/repair-agent.ts
Status: DELETED
Rationale: No repair in v8 per implementation guide Section 2; failed obligations are re-escalated via tournament diversity injection, not retried.

### src/repo-analyzer.ts
Status: MODIFIED
Rationale: Repository analysis informs the contract compiler's understanding of project structure; analysis output feeds contract context instead of plan context.
Modification scope:
- Adapt output to be consumable by contract compiler
- Preserve language detection, build/test script discovery, and dependency extraction

### src/report-generator.ts
Status: MODIFIED
Rationale: Report generation adapts to ledger-based artifacts; RunReport schema includes contract obligations and tournament results.
Modification scope:
- Read ledger state instead of session-state for obligation results
- Add tournament and cache metrics to report data
- Preserve artifact directory reading and structured report assembly

### src/report-renderer.ts
Status: MODIFIED
Rationale: Report rendering adapts to include contract obligation results, tournament scores, and cache hit rates.
Modification scope:
- Add contract obligation status section to markdown output
- Add tournament summary rendering
- Add cache economics section
- Preserve JSON and one-line summary formats

### src/requirement-filter.ts
Status: MODIFIED
Rationale: Requirement filtering adapts to contract obligation model; tier-based filtering maps to contract obligation types instead of step task types.
Modification scope:
- Map task classification to contract obligation type recommendations
- Adapt prompt injection output for persona system-prompt context
- Preserve enforce/recommend/skip tier logic

### src/rules/loader.ts
Status: MODIFIED
Rationale: Rule loading adapts to contract verification context; property templates and regression fixtures may serve contract obligation types.
Modification scope:
- Add contract-obligation-type rule pack support
- Preserve cheat-rule, property-template, and regression-fixture loading

### src/rules/schemas.ts
Status: MODIFIED
Rationale: Rule schemas may extend for contract obligation type validation.
Modification scope:
- Add contract obligation rule schema if new rule kind is introduced
- Preserve Ajv validation and schema caching

### src/sarif-formatter.ts
Status: KEPT-UNCHANGED
Rationale: SARIF 2.1.0 JSON formatting for GitHub code scanning is architecture-independent.

---

## src/scheduling/

### src/scheduling/dependency-analyzer.ts
Status: MODIFIED
Rationale: Conflict analysis concept survives for detecting parallelizable contract obligations (which obligations touch overlapping files), but the implementation reworks from step task text to contract obligation metadata.
Modification scope:
- Adapt file touchpoint inference to contract obligation metadata
- Replace step conflict graph with obligation conflict graph
- Preserve conservative conflict marking for unclear touchpoints

### src/scheduling/work-stealing-queue.ts
Status: DELETED
Rationale: Dependency-aware greedy dispatch queue serves the scheduler; v8's stigmergic coordination dispatches via trigger predicates, not a central queue.

---

## src/ (continued)

### src/secret-redactor.ts
Status: KEPT-UNCHANGED
Rationale: Secret redaction from env vars is architecture-independent; equally needed for ledger entries and log output.

### src/session-executor.ts
Status: DELETED
Rationale: CLI subprocess session execution is replaced by shared inference session per implementation guide Section 2; CLI fallback uses adapter infrastructure directly.

### src/session-manager.ts
Status: MODIFIED
Rationale: Run directory management survives, but transcript import/claim tracking is replaced by ledger-based state; share-index management adapts to ledger entries.
Modification scope:
- Replace /share transcript import with ledger entry reading
- Replace claim tracking with obligation satisfaction tracking
- Preserve run directory structure management
- Adapt prior-context accumulation to ledger-based state

### src/share-parser.ts
Status: MODIFIED
Rationale: /share transcript parsing survives for CLI fallback mode to extract agent output into ledger entries; not used on the v8 primary path.
Modification scope:
- Add fallback-mode guard
- Add ledger-entry conversion from parsed ShareIndex
- Preserve file/command/test/commit extraction

### src/share/transcript-verification.ts
Status: DELETED
Rationale: Transcript claim verification is replaced by contract-based verification; v8 verifies against contract obligations, not against natural-language claims in transcripts.

### src/spinner.ts
Status: KEPT-UNCHANGED
Rationale: Terminal spinner animation is architecture-independent.

### src/step-runner.ts
Status: DELETED
Rationale: Legacy sequential step runner is replaced by v8 execution model (single-persona then tournament).

### src/swarm-orchestrator.ts
Status: DELETED
Rationale: Greedy scheduler is replaced by stigmergic coordination per implementation guide Section 2; the central orchestrator class has no v8 equivalent.

### src/task-classifier.ts
Status: MODIFIED
Rationale: Task classification informs contract compiler obligation type selection; the keyword-based classifier survives but outputs obligation type recommendations.
Modification scope:
- Map task types to default contract obligation type sets
- Preserve keyword-based classification logic

### src/test-command-discovery.ts
Status: KEPT-UNCHANGED
Rationale: Test command discovery from package.json is architecture-independent; needed for `test-must-pass` contract obligations.

### src/text-similarity.ts
Status: KEPT-UNCHANGED
Rationale: Levenshtein distance function is architecture-independent.

### src/tier-maps.ts
Status: MODIFIED
Rationale: Requirement tier maps adapt to contract obligation types; per-task-type classification tables map obligation types instead of quality requirements.
Modification scope:
- Add contract obligation type tier columns
- Preserve per-task-type classification structure

### src/types.ts
Status: MODIFIED
Rationale: Core type definitions adapt to v8: ExecutionOptions gains v8 fields, SessionState is replaced by ledger state, ExecutionPlan is replaced by contract.
Modification scope:
- Add v8 execution option fields (contract path, persona, cost cap)
- Replace SessionState with ledger state types
- Add contract and obligation type definitions
- Preserve cost limit and PR mode types

### src/types/finding.ts
Status: KEPT-UNCHANGED
Rationale: Quality-gate finding schema (line/file/summary scoped, content-hash IDs, severity) is architecture-independent.

### src/url-shortener.ts
Status: KEPT-UNCHANGED
Rationale: In-memory URL shortener with SHA-256 base62 codes is architecture-independent.

---

## src/verification/

### src/verification/attestation.ts
Status: KEPT-UNCHANGED
Rationale: In-toto SLSA v1.0 provenance statement building and verification is architecture-independent.

### src/verification/battery-layer-runners.ts
Status: MODIFIED
Rationale: Five-layer battery dispatch survives as post-merge verification, but layer runners adapt to contract obligation context.
Modification scope:
- Adapt layer input to include contract obligation metadata
- Preserve five-layer dispatch and exception-to-result conversion

### src/verification/battery-runner.ts
Status: MODIFIED
Rationale: Top-level battery orchestration adapts to post-merge contract verification; git preparation and composite scoring reference contract obligations.
Modification scope:
- Adapt git state preparation for contract obligation results
- Reference contract obligations in scoring and gate decisions
- Preserve sequential layer execution and human-review threshold

### src/verification/battery-types.ts
Status: MODIFIED
Rationale: Battery type definitions adapt to include contract obligation references.
Modification scope:
- Add contract obligation reference to BatteryRunnerInput
- Preserve layer name, status, and result types

### src/verification/cheat-detector.ts
Status: KEPT-UNCHANGED
Rationale: Cheat detection patterns (hardcoded answers, exception swallowing, test modification) are architecture-independent.

### src/verification/command-runner.ts
Status: KEPT-UNCHANGED
Rationale: Shell command execution with timeout and SIGTERM/SIGKILL escalation is architecture-independent.

### src/verification/composite-score.ts
Status: MODIFIED
Rationale: Weighted composite scoring adapts to include contract obligation results; advisory score penalties may reference contract violation severity.
Modification scope:
- Add contract violation penalty to composite calculation
- Preserve cheat-detector, property-gate, and attestation layer weights

### src/verification/cosign-attestation.ts
Status: KEPT-UNCHANGED
Rationale: Cosign keyless and key-based signing/verification is architecture-independent.

### src/verification/diff-analysis.ts
Status: KEPT-UNCHANGED
Rationale: Unified diff parsing and literal extraction is architecture-independent.

### src/verification/differential-gate.ts
Status: MODIFIED
Rationale: Differential intent gate concept survives as a contract obligation type (test-must-pass with base/patch comparison), but adapts to contract assertion context.
Modification scope:
- Accept contract obligation reference for differential test specification
- Preserve base-commit vs patch-commit test execution logic

### src/verification/index.ts
Status: MODIFIED
Rationale: Barrel updates for v8 type exports.
Modification scope:
- Export v8 verification types
- Update re-exports for modified submodules

### src/verification/mutation-findings.ts
Status: KEPT-UNCHANGED
Rationale: Mutation tool output-to-Finding conversion is architecture-independent.

### src/verification/mutation-gate.ts
Status: KEPT-UNCHANGED
Rationale: Mutation testing execution and score classification is architecture-independent.

### src/verification/property-gate.ts
Status: KEPT-UNCHANGED
Rationale: Property-based test discovery, harness generation, and execution is architecture-independent.

### src/verification/property-harness.ts
Status: KEPT-UNCHANGED
Rationale: Per-target property test harness file emission is architecture-independent.

### src/verification/property-param-parsing.ts
Status: KEPT-UNCHANGED
Rationale: Python/TypeScript parameter list parsing for property gates is architecture-independent.

### src/verification/property-strategies.ts
Status: KEPT-UNCHANGED
Rationale: Type-hint-to-Hypothesis/fast-check strategy mapping is architecture-independent.

### src/verification/semgrep-normalizer.ts
Status: KEPT-UNCHANGED
Rationale: Semgrep JSON output normalization is architecture-independent.

### src/verification/source-locations.ts
Status: KEPT-UNCHANGED
Rationale: Source file location extraction from command output is architecture-independent.

### src/verification/test-framework-detection.ts
Status: KEPT-UNCHANGED
Rationale: Test framework detection from repo filesystem is architecture-independent.

### src/verification/test-synthesizer-io.ts
Status: MODIFIED
Rationale: Test synthesis I/O adapts to contract obligation context; LLM prompt and file placement reference contract assertions.
Modification scope:
- Add contract obligation context to LLM prompt
- Adapt test file placement to obligation-targeted paths
- Preserve candidate JSON parsing, retry feedback, and venv sanitization

### src/verification/test-synthesizer-types.ts
Status: MODIFIED
Rationale: Test synthesis type definitions adapt to include contract obligation references.
Modification scope:
- Add contract obligation reference to TestSynthesisInput
- Preserve attempt status and candidate types

### src/verification/test-synthesizer.ts
Status: MODIFIED
Rationale: Test synthesis loop adapts to contract-driven obligation model; the synthesis target is a contract obligation, not a step.
Modification scope:
- Accept contract obligation as synthesis target
- Preserve multi-attempt loop with LLM adapter generation
- Preserve preflight validation and retry feedback

---

## src/verifier/

### src/verifier-engine.ts
Status: MODIFIED
Rationale: Concept survives per implementation guide Section 2; modified to support multi-point verification (pre-generation, mid-generation, post-generation, post-merge) instead of post-only.
Modification scope:
- Add pre-generation verification (check if obligation already satisfied via ledger)
- Add mid-generation streaming verification (sample partial output, abort on contract violation)
- Add post-merge integration verification (full contract suite across all merged obligations)
- Preserve post-generation transcript/outcome checks
- Preserve rollback on verification failure

### src/verifier/outcome-checks.ts
Status: MODIFIED
Rationale: Outcome-based checks (git diff, file existence, build, test execution) survive as post-generation verification, but assertions are derived from contract obligations instead of plan step expectations.
Modification scope:
- Accept contract obligations as the assertion source
- Preserve real-execution-evidence demotion of transcript checks
- Preserve git diff, build, and test execution logic

### src/verifier/transcript-checks.ts
Status: DELETED
Rationale: Transcript-based claim verification is replaced by contract-based verification; v8 verifies against contract obligations, not against parsed transcript claims.

### src/verifier/verification-reporters.ts
Status: MODIFIED
Rationale: Verification report rendering adapts to contract obligation results; markdown report includes obligation-by-obligation status.
Modification scope:
- Add per-obligation verification status section
- Preserve markdown report and git commit logic

---

## src/ (continued)

### src/wave-resizer.ts
Status: DELETED
Rationale: Dynamic wave resizing for rate-limit adaptation is eliminated; v8 has no wave scheduling.

### src/wave-scheduler.ts
Status: DELETED
Rationale: Topological-sort wave identification is eliminated; v8's stigmergic coordination has no waves.

### src/worktree-manager.ts
Status: KEPT-UNCHANGED
Rationale: Git worktree creation, removal, and branch management for per-obligation isolation is architecture-independent.

### src/worktree-reserved-paths.ts
Status: KEPT-UNCHANGED
Rationale: Directory exclusion lists and git pathspec generation are architecture-independent.

---

## Needs human review

None. All modules have a clear classification grounded in the v8 architecture.