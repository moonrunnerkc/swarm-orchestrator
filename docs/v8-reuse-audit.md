# Swarm Orchestrator v8 Reuse Audit

Phase 0 deliverable per `docs/v8-implementation-guide.md` §3. Every file under
`src/` on `v8-dev` at branch creation is classified as KEPT-UNCHANGED,
MODIFIED, or DELETED. Pre-classifications from implementation guide §2 were
applied where present and verified against the current source. All other
modules were classified from first principles using the three architectural
inversions in `docs/v8-overhaul-guide.md` §4:

1. CLI subprocess per agent → single shared inference session with persona
   slicing (CLI execution preserved as opt-in fallback).
2. Repair loops with structured retry → verify-before-commit tournaments;
   failed candidates discarded, no retries.
3. Greedy scheduler conducting steps → stigmergic shared workspace; the
   evidence ledger is the only coordination substrate.

Plan generation collapses into contract compilation; quality gates collapse
into contract obligation types; wave scheduling, octopus merging, repair
agents, /share transcript parsing, and worktree-based parallel isolation all
fall away with the conductor pipeline.

Total modules audited: 157 — 154 TypeScript sources plus 3 JSON rule
schemas under `src/rules/schemas/`.

Bucket totals:

- KEPT-UNCHANGED: 45
- MODIFIED: 31
- DELETED: 81
- Needs human review: 0

## Adapters (`src/adapters/`)

Per implementation guide §2: agent adapters are deprecated to a "CLI
fallback mode" code path; default execution moves to the shared-session
substrate. Per-tool adapter implementations themselves do not need code
changes for the role shift, but the adapter contract and dispatch barrels
need to coexist with the new session manager.

### src/adapters/adapter-factory.ts
Status: MODIFIED
Rationale: Adapter registry survives but only as the entry point for opt-in CLI fallback execution; default substrate moves to the new shared-session path.
Modification scope:
- Make CLI adapters non-default (gate behind explicit fallback flag).
- Coexist with the v8 session manager's persona dispatch in `src/session/`.

### src/adapters/agent-adapter.ts
Status: MODIFIED
Rationale: The `AgentAdapter` contract is CLI-subprocess-shaped; v8 needs the contract to expose enough metadata that the orchestrator can choose between shared-session and CLI-fallback execution per obligation.
Modification scope:
- Add an execution-mode hint to `AgentSpawnOptions`.
- Document fallback semantics on the interface JSDoc.
- Audit `AgentResult` for v6-specific fields (`shareTranscriptPath`) that no longer make sense in default execution.

### src/adapters/claude-code-adapter.ts
Status: KEPT-UNCHANGED
Rationale: Claude Code CLI subprocess code is preserved verbatim as the opt-in fallback path; no internal changes are required for the role shift.

### src/adapters/claude-code-teams.ts
Status: KEPT-UNCHANGED
Rationale: Claude Code Teams adapter survives untouched as part of the CLI fallback surface.

### src/adapters/codex-adapter.ts
Status: KEPT-UNCHANGED
Rationale: Codex CLI subprocess code is preserved as fallback; no internal changes required.

### src/adapters/copilot-adapter.ts
Status: KEPT-UNCHANGED
Rationale: Copilot CLI subprocess code is preserved as fallback; no internal changes required.

### src/adapters/fatal-error-classifier.ts
Status: KEPT-UNCHANGED
Rationale: Fatal-error classification of CLI agent output remains useful in the fallback path with no semantic shift.

### src/adapters/index.ts
Status: MODIFIED
Rationale: Barrel re-exports must continue to surface the fallback adapters while not implying they are the default substrate.
Modification scope:
- Update `defaultModelForAdapter` semantics for cache-aware pricing alignment.
- Re-export shared-session entry points alongside the CLI registry.

### src/adapters/persistent-session.ts
Status: KEPT-UNCHANGED
Rationale: Persistent CLI session helper is still useful for CLI-fallback users who want interactive reuse.

### src/adapters/process-supervisor.ts
Status: KEPT-UNCHANGED
Rationale: Generic supervised-spawn primitive (stall detection, heartbeat, line buffering) remains useful for any CLI subprocess invocation v8 retains.

## Top-level core (`src/`)

### src/agents-exporter.ts
Status: DELETED
Rationale: Generates `.agent.md` from knowledge base patterns for CLI agent profiles; v8's persona library replaces `.agent.md` profiles entirely.

### src/analytics-log.ts
Status: MODIFIED
Rationale: Append-only run analytics overlap with the evidence ledger's coordination role; per-run summary surface still useful but its source moves from RunMetrics to ledger projection.
Modification scope:
- Replace `RunMetrics` input with a ledger-derived projection.
- Drop wave/step counts; add obligation-level counters.

### src/baseline-scanner.ts
Status: MODIFIED
Rationale: Baseline file scanning seeds CLI agent prompts in v6; in v8 the same primitive feeds the contract compiler's repo-context cached prefix.
Modification scope:
- Decouple from CLI-prompt instruction emission (`formatPreservationRules`).
- Expose snapshot as a structured context payload for the session manager.

### src/bootstrap-evidence.ts
Status: DELETED
Rationale: Persists bootstrap-pipeline evidence shaped around `ExecutionPlan`; the bootstrap pipeline is replaced wholesale by contract compilation.

### src/bootstrap-orchestrator.ts
Status: DELETED
Rationale: Bootstrap pipeline coordinator depends on `PlanGenerator`, `RepoAnalyzer`, and `GitHubIssuesIngester`; all three are deleted as plans become contracts.

### src/bootstrap-types.ts
Status: DELETED
Rationale: Type definitions for the bootstrap pipeline; gone with their consumers.

### src/branch-merger.ts
Status: DELETED
Rationale: Merges per-step worktree branches via wave/octopus semantics; v8 commits within the shared session, with no per-step branches to merge.

### src/cli.ts
Status: MODIFIED
Rationale: Top-level CLI dispatcher must add v8 commands (`compile`, `run`, `resume`) without losing the existing surface during the transition window.
Modification scope:
- Route `swarm v8 …` subcommands into `src/cli/v8/` per impl guide §3.
- Preserve the existing v6 surface behind an internal feature gate until cutover.

### src/cli/attest-handlers.ts
Status: MODIFIED
Rationale: `swarm attest verify <commit>` continues but verifies contract attestations and ledger entries instead of step-battery outputs.
Modification scope:
- Source attestation from ledger entries, not run battery results.
- Update CLI output schema for contract obligations rather than step layer results.

### src/cli/cost-prompt.ts
Status: MODIFIED
Rationale: Pre-execution cost confirmation survives but the underlying cost model becomes cache-aware, so the displayed estimate format and units change.
Modification scope:
- Replace "premium requests" units with cached-vs-fresh token counts.
- Render per-persona cost breakdown.

### src/cli/demo-handlers.ts
Status: DELETED
Rationale: Demo command handlers depend on `ExecutionPlan`/`PlanStep` and `DemoMode`; replaced by contract-template demos in Phase 7.

### src/cli/flags.ts
Status: MODIFIED
Rationale: Most v6 flags (`--strict-isolation`, `--lean`, `--useInnerFleet`, `--max-retries`, `--no-quality-gates`) become meaningless under v8; v8 introduces new flags (`--cost-cap`, `--contract-only`, persona-tier selectors).
Modification scope:
- Strip v6-only flags from `ExecuteSwarmCliOptions`.
- Add v8 flags per impl guide §12.

### src/cli/index.ts
Status: MODIFIED
Rationale: Barrel re-exports change as plan/swarm/share/misc handlers are deleted and v8 handlers are introduced.
Modification scope:
- Drop deleted handler exports.
- Add v8 handler exports from `src/cli/v8/`.

### src/cli/live-status.ts
Status: MODIFIED
Rationale: Bottom-pinned step status block survives in concept but renders obligation/persona state instead of v6 wave-and-step state.
Modification scope:
- Replace step-id and wave model with obligation-id and persona model.
- Source updates from ledger appends, not the wave scheduler.

### src/cli/misc-handlers.ts
Status: DELETED
Rationale: Hosts `swarm use <recipe>` and `swarm agents export`; recipes become contract templates and `.agent.md` export goes with the persona library replacement.

### src/cli/plan-handlers.ts
Status: DELETED
Rationale: `swarm plan` workflow is replaced wholesale by `swarm v8 compile`; plan generation collapses into contract compilation.

### src/cli/share-handlers.ts
Status: DELETED
Rationale: Imports CLI agent `/share` transcripts into the run record; v8 reads coordination state from the ledger directly, never from agent-CLI transcripts.

### src/cli/status-handlers.ts
Status: MODIFIED
Rationale: Run-status, audit, metrics, gates, and report commands continue but their data source becomes the ledger rather than the v6 step-result store.
Modification scope:
- Replace `StepRunner.loadExecutionContext` with a ledger reader.
- Drop the `gates` subcommand; surface contract-obligation status instead.

### src/cli/swarm-handlers.ts
Status: DELETED
Rationale: Hosts `swarm run`, `swarm swarm`, `swarm bootstrap`, `swarm quick`; all four are replaced by `swarm v8 run` against compiled contracts.

### src/cli/usage.ts
Status: MODIFIED
Rationale: Help text must reflect the new command surface and remove flags that no longer apply.
Modification scope:
- Rewrite usage block for v8 commands (`compile`, `run`, `resume`, `attest`).
- Remove v6-only command lines.

### src/commit-pattern-detector.ts
Status: DELETED
Rationale: Heuristic commit-message anti-pattern detection feeds v6 commit-quality analysis; v8 verification is contract-driven, with no commit-quality side-channel.

### src/commit-quality-analyzer.ts
Status: DELETED
Rationale: Consumes `commit-pattern-detector` and `/share` index data; both inputs go away with v6 step execution.

### src/config-loader.ts
Status: MODIFIED
Rationale: YAML agent-profile loader feeds v6 CLI agents; v8 needs a parallel persona-definition loader sharing the same config-precedence model.
Modification scope:
- Add persona-definition schema and loader.
- Decouple `AgentProfile` from `.agent.md` consumers retained only for CLI fallback.

### src/context-broker.ts
Status: DELETED
Rationale: Cross-step context-sharing primitive (locks, entries) is the v6 substitute for a real shared workspace; the ledger is the v8 shared workspace, leaving no role for the broker.

### src/copilot-cli-wrapper.ts
Status: DELETED
Rationale: Pre-adapter Copilot wrapper that the adapters already supersede; with adapters demoted to fallback, this layer is dead weight.

### src/cost-estimator.ts
Status: MODIFIED
Rationale: Per impl guide §2, multipliers must be updated for prompt-cache-aware pricing; the premium-request cap concept is preserved.
Modification scope:
- Replace per-CLI-invocation token math with cached-prefix + variable-suffix math.
- Track per-persona, per-obligation cost attribution.
- Drop quality-gate remediation overhead from the model.

### src/defaults.ts
Status: MODIFIED
Rationale: Most numeric defaults relate to v6 timing (heartbeat, repair report sizes, retry probability); v8 needs cache-TTL, tournament, and watchdog defaults instead.
Modification scope:
- Remove `DEFAULT_RETRY_PROBABILITY`, `DEFAULT_REMEDIATION_RATE`, repair-report constants.
- Add tournament-round cap, cache-TTL, stigmergy-watchdog defaults.

### src/demo-mode.ts
Status: DELETED
Rationale: Demo scenarios are typed against `ExecutionPlan`/`PlanStep`; replaced by contract-template demos.

### src/deployment-handler.ts
Status: DELETED
Rationale: Per-step optional preview deployment is a v6-pipeline hook with no parallel in the v8 contract obligation model.

### src/deployment-manager.ts
Status: DELETED
Rationale: Vercel/Netlify preview-deploy primitive reachable only through `deployment-handler`; gone with its caller.

### src/execution-queue.ts
Status: DELETED
Rationale: Concurrency-limited task queue is the scheduler's dispatch primitive; stigmergic coordination has no scheduler.

### src/external-tool-manager.ts
Status: DELETED
Rationale: Wraps `gh`/`vercel`/`netlify` invocations for `deployment-handler`; gone with deployment.

### src/gate-prompt-builder.ts
Status: DELETED
Rationale: Builds quality-gate clauses for CLI agent prompts; quality gates as a separate engine are subsumed by contract obligation types.

### src/gate-remediation.ts
Status: DELETED
Rationale: Auto-injects remediation steps when gates fail; v8 has no repair loop and no quality gate engine.

### src/github-issues-ingester.ts
Status: DELETED
Rationale: Bootstrap-pipeline component fetching issues via `gh` for plan generation; gone with bootstrap.

### src/github-mcp-integrator.ts
Status: DELETED
Rationale: Generates an "MCP evidence" preamble for CLI agent prompts; v8 personas operate inside a single API session, not via MCP-equipped CLI agents.

### src/github/comment-body-builder.ts
Status: KEPT-UNCHANGED
Rationale: Generic `Finding`-to-PR-comment formatting; the GitHub Action surface stays compatible per impl guide §12 and v8 still emits Findings.

### src/github/comment-dedup.ts
Status: KEPT-UNCHANGED
Rationale: Finding-id reconciliation against existing PR comments is independent of how findings are produced.

### src/github/diff-position-resolver.ts
Status: KEPT-UNCHANGED
Rationale: Maps line findings to PR diff positions; pure utility, no v6 coupling.

### src/github/review-comment-fetcher.ts
Status: KEPT-UNCHANGED
Rationale: Octokit wrapper for fetching existing review comments; pure utility.

### src/github/review-poster.ts
Status: KEPT-UNCHANGED
Rationale: Octokit wrapper for posting reviews from `Finding`s; reusable behind v8 verification output.

### src/hook-generator.ts
Status: DELETED
Rationale: Generates per-step git hooks that scope a CLI agent to its allowlist; v8 personas run inside a single session with no per-step hook surface.

### src/index.ts
Status: MODIFIED
Rationale: Public API barrel re-exports v6 internals (`SwarmOrchestrator`, `PlanGenerator`, `SessionExecutor`, `RepairAgent`, `PMAgent`) that are deleted; replace with v8 surface.
Modification scope:
- Remove deleted-module exports.
- Export contract compiler, session manager, ledger, population manager, and verification entry points.

### src/knowledge-base.ts
Status: KEPT-UNCHANGED
Rationale: Per impl guide §2, kept as the storage layer beneath the new evidence ledger; the append-only hash-chain semantics ride on top in `src/ledger/`.

### src/logger.ts
Status: KEPT-UNCHANGED
Rationale: Generic structured logger with no v6-specific concepts; CLAUDE.md treats it as the project-wide logging primitive.

### src/meta-analyzer.ts
Status: DELETED
Rationale: Consumes wave step results to detect anti-patterns and trigger replan; v8 has no waves, no replan, and no meta-analyzer concept.

### src/metrics-collector.ts
Status: MODIFIED
Rationale: Run-time metrics surface survives but its event vocabulary (waves, steps, recovery events) is v6-shaped.
Modification scope:
- Replace wave/step counters with obligation-level counters.
- Source events from ledger appends rather than orchestrator hooks.
- Drop `RecoveryEvent` (no recovery in v8).

### src/metrics-types.ts
Status: MODIFIED
Rationale: `RunMetrics`/`RecoveryEvent` are v6-shaped; v8 needs cost-attribution-per-persona-per-obligation and ledger-projection types.
Modification scope:
- Remove `RecoveryEvent`, `waveCount`, `stepCount`.
- Add per-persona, per-obligation cost-attribution types.

### src/multi-repo-coordinator.ts
Status: DELETED
Rationale: Bootstrap-pipeline cross-repo relationship analyzer; gone with bootstrap.

### src/orchestrator/async-meta-analysis.ts
Status: DELETED
Rationale: Wave-level async meta-analysis hook; gone with waves and meta-analyzer.

### src/orchestrator/end-of-run-battery.ts
Status: DELETED
Rationale: End-of-run verification battery is a v6 step-model construct; v8's post-merge verification runs the contract suite end-to-end and is implemented in `src/verification/`.

### src/orchestrator/fatal-run-error.ts
Status: KEPT-UNCHANGED
Rationale: Error class signaling unrecoverable account-level CLI failures; still useful in the CLI fallback path.

### src/orchestrator/final-gates-remediation.ts
Status: DELETED
Rationale: Drives quality-gate-triggered remediation step injection; both the gate engine and remediation are removed in v8.

### src/orchestrator/git-state-utils.ts
Status: KEPT-UNCHANGED
Rationale: Sanitizes leftover merge state and installs missing dependencies; useful regardless of orchestration model.

### src/orchestrator/pause-controller.ts
Status: DELETED
Rationale: Owns pause/resume state for the scheduler loop; v8 has no scheduler loop to pause.

### src/orchestrator/post-battery-attestation.ts
Status: MODIFIED
Rationale: Signs an attestation over a battery result; v8 attests over contract + ledger state instead.
Modification scope:
- Replace `BatteryResult` input with a contract-obligation result set.
- Update predicate metadata schema for v8.

### src/orchestrator/pre-worker-synthesis.ts
Status: DELETED
Rationale: Pre-step regression-test synthesis driven by CLI worker prep; v8 contract compiler subsumes test-must-pass obligation generation.

### src/orchestrator/replan-runner.ts
Status: DELETED
Rationale: Replanning is the repair-loop control plane; v8 removes repair entirely (inversion two).

### src/orchestrator/step-executor.ts
Status: DELETED
Rationale: Drives a single step through the CLI adapter, deployment hook, commit, and verification flow; v8 dispatches obligations through the population manager.

### src/orchestrator/wave-scheduler-loop.ts
Status: DELETED
Rationale: The wave scheduler loop itself; the file's own header notes the loop owns dispatch, dependency tracking, replan, and meta-analysis — every concept is removed in v8.

### src/owasp-mapper.ts
Status: KEPT-UNCHANGED
Rationale: Maps execution metadata to OWASP ASI risks for compliance reporting; survives as a governance projection over v8 ledger data.

### src/owasp-report-renderer.ts
Status: KEPT-UNCHANGED
Rationale: Renders OWASP report markdown from the mapper output; pure presentation, reusable.

### src/plan-files.ts
Status: DELETED
Rationale: Persists `ExecutionPlan` JSON files under `plans/`; gone with the plan concept.

### src/plan-generator.ts
Status: DELETED
Rationale: Per impl guide §2, plans become contracts; the new pipeline lives in the contract compiler in `src/contract/`.

### src/pm-agent.ts
Status: DELETED
Rationale: PM agent reviews a generated plan before swarm execution; v8 contracts are user-approved directly with no intermediary persona acting on the plan shape.

### src/post-run-reporter.ts
Status: MODIFIED
Rationale: Generates the end-of-run report from artifacts; the artifacts shift from step results to ledger entries.
Modification scope:
- Rebuild input contract around ledger projections.
- Drop wave/step/RecoveryEvent rendering; add per-obligation, per-persona sections.

### src/pr-automation.ts
Status: MODIFIED
Rationale: Builds PR title/body from execution context; the input shape changes from `SwarmExecutionContext` to a contract-plus-ledger projection, but PR auto-creation survives.
Modification scope:
- Update `PRSummaryContext` to read from contract obligations, not steps.

### src/pr-manager.ts
Status: MODIFIED
Rationale: PR creation, auto-merge, and approval-wait survive; the evidence body and merge gates change to contract-driven.
Modification scope:
- Replace step-status checks with obligation-status checks.
- Source PR evidence from ledger and contract.

### src/presenter/index.ts
Status: KEPT-UNCHANGED
Rationale: Generic user-facing CLI presentation primitives (banners, glyphs, theme); independent of orchestration model.

### src/prompt-builder.ts
Status: DELETED
Rationale: Builds the long shared-instructions prompt for CLI agents; v8 builds persona-specific system-prompt slices through the new session/persona modules.

## Quality gates (`src/quality-gates/`)

The whole tree is removed. v6's verification surface combines `verifier-engine.ts` and the quality-gate engine; v8's verification surface is the contract obligation set checked at four points (pre, mid, post-generation, post-merge). Individual gate checks may be reincarnated as obligation handlers in Phase 7, but the gate engine, registry, and config loaders do not survive.

### src/quality-gates/config-loader.ts
Status: DELETED
Rationale: Loads `gates.yaml` config; v8 has no gate engine to configure.

### src/quality-gates/default-config.ts
Status: DELETED
Rationale: Default gate enable/disable map; gone with the engine.

### src/quality-gates/file-utils.ts
Status: DELETED
Rationale: Project-file enumeration helper used only by gates.

### src/quality-gates/gate-runner.ts
Status: DELETED
Rationale: Top-level gate-runner; gone with the engine.

### src/quality-gates/gates/accessibility.ts
Status: DELETED
Rationale: Accessibility gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/gates/duplicate-blocks.ts
Status: DELETED
Rationale: Duplicate-blocks gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/gates/hardcoded-config.ts
Status: DELETED
Rationale: Hardcoded-config gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/gates/readme-claims.ts
Status: DELETED
Rationale: README-claims gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/gates/runtime-checks.ts
Status: DELETED
Rationale: Runs `npm test`/`eslint`/`audit`; v8 surfaces these as contract `build-must-pass`/`test-must-pass` obligations directly.

### src/quality-gates/gates/scaffold-defaults.ts
Status: DELETED
Rationale: Scaffold-defaults gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/gates/test-coverage.ts
Status: DELETED
Rationale: Test-coverage gate; replaced by the planned `coverage-must-exceed` obligation type in Phase 7.

### src/quality-gates/gates/test-file-protection.ts
Status: DELETED
Rationale: Test-file modification detector; replaced by contract obligation expressing the same constraint.

### src/quality-gates/gates/test-isolation.ts
Status: DELETED
Rationale: Test-isolation gate; reincarnates (if at all) as a contract obligation handler.

### src/quality-gates/index.ts
Status: DELETED
Rationale: Barrel re-export of the gate engine; gone with the engine.

### src/quality-gates/registry.ts
Status: DELETED
Rationale: Built-in and project-supplied gate registration; v8 has no gate registry to maintain.

### src/quality-gates/types.ts
Status: DELETED
Rationale: Gate engine types; gone with the engine.

## Top-level core continued

### src/quick-fix-mode.ts
Status: DELETED
Rationale: v6 single-agent fast path; v8 reaches the same shape through a one-candidate tournament.

### src/recipe-loader.ts
Status: DELETED
Rationale: Recipe → `ExecutionPlan` parameterization; per impl guide §12, recipes become contract templates and execute through `swarm v8 run`.

### src/repair-agent.ts
Status: DELETED
Rationale: Per impl guide §2, there is no repair in v8 (inversion two).

### src/repo-analyzer.ts
Status: DELETED
Rationale: Bootstrap-pipeline static analyzer; gone with bootstrap.

### src/report-generator.ts
Status: MODIFIED
Rationale: Builds the structured `RunReport` from artifacts; the input shape becomes the ledger plus contract.
Modification scope:
- Replace `StepSummary[]` with obligation-level summaries.
- Drop `repairAttempts` and `verificationStatus: repaired`.

### src/report-renderer.ts
Status: MODIFIED
Rationale: Renders `RunReport` to text; renderer survives but the input changes shape with `report-generator.ts`.
Modification scope:
- Update for new `RunReport` shape.
- Drop battery-finding-counts section in favor of obligation findings.

### src/requirement-filter.ts
Status: DELETED
Rationale: Maps task type to enforced/recommended/skip requirements for prompt injection; v8's contract obligations are the requirement set, with no separate filtering layer.

## Rules (`src/rules/`)

The rules tree is deliberately retained: the `regression-fixture.schema.json` already declares it is consumed by "the regression falsifier (planned for v8)," and cheat-rule and property-template packs feed verifiers (cheat-detector, property-gate) that survive into v8 as obligation handlers.

### src/rules/loader.ts
Status: KEPT-UNCHANGED
Rationale: Loads validated rule packs (cheat rules, property templates, regression fixtures) used by survivor verification gates and the planned v8 regression falsifier.

### src/rules/schemas.ts
Status: KEPT-UNCHANGED
Rationale: Ajv-backed schema validator for rule artifacts; pure utility, reusable.

### src/rules/schemas/cheat-rule.schema.json
Status: KEPT-UNCHANGED
Rationale: Cheat-rule schema feeds the cheat-detector verification surface, which v8 retains as an obligation handler.

### src/rules/schemas/property-template.schema.json
Status: KEPT-UNCHANGED
Rationale: Property-template schema feeds the property gate, which v8 retains as a `property-must-hold` obligation handler.

### src/rules/schemas/regression-fixture.schema.json
Status: KEPT-UNCHANGED
Rationale: Schema explicitly declares its consumer as the v8 regression falsifier; no change required.

## Top-level core continued

### src/sarif-formatter.ts
Status: KEPT-UNCHANGED
Rationale: SARIF formatter for `Finding`s; v8 still emits Findings from verification, so the formatter survives as a governance/CI integration.

### src/scheduling/dependency-analyzer.ts
Status: DELETED
Rationale: Static plan-step dependency analyzer for the work-stealing queue; v8 has no plan steps and no work queue.

### src/scheduling/work-stealing-queue.ts
Status: DELETED
Rationale: Dependency-aware work queue feeding the scheduler; gone with the scheduler.

### src/secret-redactor.ts
Status: KEPT-UNCHANGED
Rationale: Redacts known secret values from artifacts; useful regardless of orchestration model.

### src/session-executor.ts
Status: DELETED
Rationale: Per impl guide §2, the CLI-subprocess-oriented `SessionExecutor` is replaced with a session manager built around persistent inference sessions in `src/session/`.

### src/session-manager.ts
Status: DELETED
Rationale: This module is the v6 `/share`-transcript import manager, not a session manager; the name is reclaimed by the v8 `src/session/anthropic-session.ts` per impl guide §3.

### src/share-parser.ts
Status: DELETED
Rationale: Parses CLI agent `/share` transcripts into a structured index; v8 reads coordination state from the ledger.

### src/share/transcript-verification.ts
Status: DELETED
Rationale: Heuristic claim-verification over `/share` transcripts; gone with `share-parser`.

### src/spinner.ts
Status: KEPT-UNCHANGED
Rationale: Generic terminal spinner; reusable for v8 long-running operations.

### src/step-runner.ts
Status: DELETED
Rationale: Sequential step runner driving CLI agents through `SessionExecutor`; both the runner and its dependency are deleted.

### src/swarm-orchestrator.ts
Status: DELETED
Rationale: The whole orchestrator file (scheduler, dependency resolution, octopus merge, governance, cost tracking) is v6-pipeline-shaped; per impl guide §2 the greedy scheduler is deleted, and CLAUDE.md confirms the rest of the file's responsibilities are also v6 conductor concerns.

### src/task-classifier.ts
Status: DELETED
Rationale: Keyword-based goal-to-task-type classifier feeds tier maps; v8 lifts goal classification into the contract compiler instead.

### src/test-command-discovery.ts
Status: KEPT-UNCHANGED
Rationale: Discovers a project's full test command from `package.json`; reusable input for the contract compiler when generating `test-must-pass` obligations.

### src/text-similarity.ts
Status: KEPT-UNCHANGED
Rationale: Levenshtein utility used by the knowledge base; pure data utility, reusable.

### src/tier-maps.ts
Status: DELETED
Rationale: Per-task-type requirement classifications feeding `RequirementFilter`; v8 contracts express requirements directly with no tier-map layer.

### src/types.ts
Status: MODIFIED
Rationale: Hosts `ExecutionOptions` and `SessionState`; both are v6-shaped and need v8 equivalents.
Modification scope:
- Replace `ExecutionOptions` with a v8 run-options type.
- Replace `SessionState` with a contract-execution state type, or move state into ledger projections.

### src/types/finding.ts
Status: KEPT-UNCHANGED
Rationale: `Finding` types are the wire format between verifiers and PR/SARIF emitters; v8 retains both producers and consumers.

### src/url-shortener.ts
Status: KEPT-UNCHANGED
Rationale: In-memory URL-shortener primitive; pure utility, no v6 ties.

## Verification (`src/verification/`)

v8 retains and extends the verification engine. Per impl guide §2 the engine moves to multi-point verification (pre-/mid-/post-generation, post-merge). The "battery" wrapper (single end-of-run pass) is v6-specific and is replaced. Underlying gate primitives (cheat-detector, property-gate, mutation-gate, differential-gate) are reusable as obligation handlers and as components of multi-point verification, so they stay.

### src/verification/attestation.ts
Status: MODIFIED
Rationale: Attestation generation/verification survives but the predicate metadata format changes from layer-result-array to contract-obligation-result-set.
Modification scope:
- Update `AttestationLayerResult` to obligation-shaped result.
- Replace `BatteryResult` linkage with ledger entry hash references.

### src/verification/battery-layer-runners.ts
Status: DELETED
Rationale: Dispatches the v6 single-pass battery across cheat/mutation/property/differential/attestation layers; v8 verifies at four temporal points instead.

### src/verification/battery-runner.ts
Status: DELETED
Rationale: Top-level battery runner producing a `BatteryResult`; gone with the battery model.

### src/verification/battery-types.ts
Status: DELETED
Rationale: Battery layer/result types; gone with the battery.

### src/verification/cheat-detector.ts
Status: KEPT-UNCHANGED
Rationale: Semgrep-driven cheat detection over diffs; reusable as a security-reviewer persona's verifier or a contract obligation handler.

### src/verification/command-runner.ts
Status: KEPT-UNCHANGED
Rationale: Generic verification-command spawn primitive (timeout, captured stdout/stderr); reusable across all v8 verification points.

### src/verification/composite-score.ts
Status: DELETED
Rationale: Computes a battery-wide composite score; the battery is the only consumer.

### src/verification/cosign-attestation.ts
Status: KEPT-UNCHANGED
Rationale: Cosign signing/verification primitive; orthogonal to orchestration model.

### src/verification/diff-analysis.ts
Status: KEPT-UNCHANGED
Rationale: Unified-diff parsing and test-file path detection; pure utility, reusable.

### src/verification/differential-gate.ts
Status: KEPT-UNCHANGED
Rationale: Base-vs-patch differential test execution; reusable for `test-must-pass` post-generation verification.

### src/verification/index.ts
Status: MODIFIED
Rationale: Barrel re-exports change as battery types and the test synthesizer are deleted.
Modification scope:
- Drop battery and test-synthesizer exports.
- Add v8 multi-point verification exports.

### src/verification/mutation-findings.ts
Status: KEPT-UNCHANGED
Rationale: Translates mutation-tool output into `Finding`s; reusable as a mutation-obligation handler.

### src/verification/mutation-gate.ts
Status: KEPT-UNCHANGED
Rationale: Mutation-testing gate; reusable as an obligation handler.

### src/verification/property-gate.ts
Status: KEPT-UNCHANGED
Rationale: Property-based-testing gate; reusable as a `property-must-hold` obligation handler.

### src/verification/property-harness.ts
Status: KEPT-UNCHANGED
Rationale: Per-language property-test harness emitter for the property gate; reusable.

### src/verification/property-param-parsing.ts
Status: KEPT-UNCHANGED
Rationale: Lightweight parameter-list parser for the property gate; pure utility.

### src/verification/property-strategies.ts
Status: KEPT-UNCHANGED
Rationale: Maps types to property-test generators; pure utility.

### src/verification/semgrep-normalizer.ts
Status: KEPT-UNCHANGED
Rationale: Normalizes Semgrep output into `Finding`s; pure utility.

### src/verification/source-locations.ts
Status: KEPT-UNCHANGED
Rationale: Extracts source locations from tool output strings; pure utility.

### src/verification/test-framework-detection.ts
Status: KEPT-UNCHANGED
Rationale: Detects pytest/django/unittest test framework shape; reusable input for the contract compiler when emitting `test-must-pass` obligations.

### src/verification/test-synthesizer-io.ts
Status: DELETED
Rationale: Prompt construction and candidate I/O for v6 pre-worker test synthesis; v8 contract compiler subsumes test obligation generation.

### src/verification/test-synthesizer-types.ts
Status: DELETED
Rationale: Type definitions for the v6 test synthesizer; gone with their consumer.

### src/verification/test-synthesizer.ts
Status: DELETED
Rationale: SWE-bench-shaped pre-worker regression-test synthesizer wired to the Claude Code adapter; v8 contract compilation replaces this entry point.

## Verifier engine (`src/verifier-engine.ts` and `src/verifier/`)

### src/verifier-engine.ts
Status: MODIFIED
Rationale: Per impl guide §2, the engine survives but moves to multi-point verification (pre/mid/post-generation, post-merge) instead of post-only.
Modification scope:
- Add pre-generation, mid-generation, and post-merge verification entry points.
- Replace `/share`-transcript-driven checks with ledger-driven checks.
- Decouple from `share-parser` and `verifier/transcript-checks`.

### src/verifier/outcome-checks.ts
Status: MODIFIED
Rationale: Outcome verification helpers (build/test/file-existence) feed the engine and survive in v8, but their inputs and pathspec excludes shift away from the v6 worktree model.
Modification scope:
- Replace `gitPathspecExcludes` (worktree-reserved-paths) with v8-equivalent exclusions or remove the dependency.
- Adapt input options to ledger projections.

### src/verifier/transcript-checks.ts
Status: DELETED
Rationale: Builds verification checks by cross-referencing `ShareIndex` against execution outcomes; v8 has no `/share` transcripts to cross-reference.

### src/verifier/verification-reporters.ts
Status: MODIFIED
Rationale: Generates and commits verification reports; the reporting concept survives but inputs and the commit timing change with multi-point verification.
Modification scope:
- Adapt report shape to multi-point results.
- Drop hook-generator coupling.

## Wave/worktree scheduling (`src/wave-*`, `src/worktree-*`)

### src/wave-resizer.ts
Status: DELETED
Rationale: Splits/merges scheduler waves on rate-limit or quota signals; v8 has no waves and no scheduler.

### src/wave-scheduler.ts
Status: DELETED
Rationale: Builds the dependency graph and identifies parallel-execution waves; gone with waves.

### src/worktree-manager.ts
Status: DELETED
Rationale: Provisions per-step git worktrees for parallel CLI subprocess isolation; v8 runs all personas inside one shared inference session, eliminating worktree-based isolation.

### src/worktree-reserved-paths.ts
Status: DELETED
Rationale: Reserved-path list that worktree-bound commits exclude; gone with worktrees and per-step commits.

## Needs human review

None. All 157 modules were classifiable from the current source plus the v8 architecture documents.
