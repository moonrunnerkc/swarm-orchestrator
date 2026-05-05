# Swarm Orchestrator v8 Implementation Guide

Status: build sequence, pre-implementation
Companion document: `v8-overhaul-guide.md` (architecture and rationale)
Target environment: Node.js 20+, TypeScript 5.x, Linux/macOS first, Windows via WSL

This document is a phased build plan, not an architecture spec. Architecture rationale lives in the overhaul guide. Read that first if you want to know why; this document tells you what to build, in what order, and how to know each phase is done.

## 1. Prerequisites

Before any phase begins:

- Node.js 20 LTS minimum, with native ESM support throughout
- TypeScript 5.x, strict mode, ES2022 target
- Git 2.40+ with worktree support
- Anthropic API access with prompt caching enabled (default for Claude 4 series)
- Optional: OpenAI API key for cross-provider testing
- Optional: WASM runtime (Wasmer or wasmtime) for the deterministic floor

Project conventions, applied throughout:

- Named exports only, no default exports.
- Kebab-case filenames.
- 300-line file ceiling, decompose at threshold.
- Full JSDoc on all public functions.
- Tests validate real behavior, not wiring; integration tests over unit tests where the boundary is the point.
- No `any` types. Schema-validated I/O at all module boundaries.
- Error messages include what failed and what to do about it.

## 2. Module inventory: kept, modified, deleted

Before Phase 0, classify every module in the current `src/` tree.

Likely kept and modified:

- `verifier-engine.ts`: concept survives. Modified to support multi-point verification (pre-generation, mid-generation, post-generation, post-merge) instead of post-only.
- `cost-estimator.ts`: kept. Multipliers updated for prompt-cache-aware pricing. Premium-request budget caps preserved.
- `knowledge-base.ts`: kept as the storage layer beneath the new evidence ledger. The append-only hash-chain semantics are added on top.
- Agent adapters in `src/adapters/`: deprecated to a "CLI fallback mode" code path. Default execution is the new shared-session path. Adapters remain for users who want CLI isolation.
- `cost-attribution.json` output format: kept and extended with per-persona per-obligation breakdown.

Likely deleted:

- The greedy scheduler in `swarm-orchestrator.ts`. Stigmergic coordination has no scheduler.
- `repair-agent.ts`. There is no repair in v8.
- `session-executor.ts` as currently designed (CLI subprocess-oriented). Replaced with a session manager built around persistent inference sessions.
- `plan-generator.ts`. Plans become contracts; the new pipeline lives in the contract compiler.

Reuse audit deliverable: a markdown document in `docs/v8-reuse-audit.md` listing every existing module with a kept/modified/deleted tag and a one-sentence rationale.

## 3. Phase 0: reuse audit and skeleton

Duration estimate: 1 to 2 weeks.

Scope:

- Branch the repo at `v8-dev` from main. v8 is greenfield in spirit but lives in the same repo until release.
- Produce the reuse audit (Section 2 above) as a committed document.
- Stand up the new directory skeleton: `src/contract/`, `src/population/`, `src/ledger/`, `src/verification/`, `src/wasm/`, `src/persona/`, `src/session/`, `src/cli/v8/`.
- Establish CI for v8: lint, typecheck, unit tests, integration tests against a small fixture repo.
- Define the contract schema as a versioned JSON schema in `src/contract/schema/v1.json`. Initial version: 3 obligation types (file-must-exist, build-must-pass, test-must-pass).

Exit criteria:

- v8 skeleton compiles and lints clean.
- CI passes on an empty Phase 0 codebase.
- Reuse audit is committed and reviewed.
- Contract schema v1 is committed.

## 4. Phase 1: contract compiler

Duration estimate: 2 to 3 weeks.

Scope:

The contract compiler is the gating piece. Without a compiled contract, the rest of the system has nothing to verify against.

Deliverables:

- A goal parser that takes a natural-language goal plus optional structured input and produces a draft contract. The parser uses a single LLM call (Sonnet tier) to extract obligations.
- A contract validator that checks the draft contract for internal consistency: no contradictory obligations, no obligations referencing nonexistent files unless the obligation is a creation directive, no unbounded property assertions.
- A user-approval step: the compiled contract is presented to the user, who can edit, approve, or reject before execution starts. CLI command: `swarm v8 compile <goal>`.
- The contract serialization format: JSONL, append-only, hash-referenced from the ledger.

Initial obligation types implemented in this phase:

- `file-must-exist(path: string)`: a file must exist at the given path post-execution.
- `build-must-pass(command: string)`: the named build command must exit zero.
- `test-must-pass(command: string)`: the named test command must exit zero.

Phase 1 does not implement obligation types beyond these three. Expansion happens in Phase 7.

Exit criteria:

- A user can run `swarm v8 compile "add a health check endpoint"` and get a draft contract containing at minimum a `file-must-exist` for the new endpoint, a `build-must-pass`, and a `test-must-pass`.
- The user can edit the draft contract in their editor before approval.
- The contract is hash-stable: identical input produces identical contract output (within the LLM extraction step, accept stochasticity but record the seed).
- Tests cover at least 20 goal-to-contract transformations with expected obligations.

## 5. Phase 2: single-session population manager

Duration estimate: 2 to 3 weeks.

Scope:

This phase introduces the substrate but not the swarm. One persona at a time, single-session, prompt-caching enabled. The goal is to validate cost economics on the new substrate before adding tournament parallelism.

Deliverables:

- `src/session/anthropic-session.ts`: a session manager that maintains a long-lived Anthropic API session with proper cache breakpoint placement. Static project context placed first; dynamic per-call content placed last.
- `src/persona/persona-registry.ts`: a registry of personas. Each persona is a system-prompt slice plus a sampling configuration plus a model-tier preference. Phase 2 ships 3 personas: `architect`, `implementer`, `verifier`.
- A trigger predicate evaluator. Phase 2 supports simple predicates: "wake when contract has unsatisfied obligation of type X." More complex predicates come in Phase 3.
- A run command: `swarm v8 run <contract-path>`. This drives the population manager through obligations sequentially, one persona at a time.

Cost benchmarking is a Phase 2 deliverable, not a Phase 7 deferral.

- Build a benchmark suite: 5 small goals, 3 medium goals, 2 large goals (defined as obligation count: small ≤ 3, medium 4-8, large > 8).
- Run each goal under v6 and v8 (single-persona mode). Capture token counts (input, output, cached input separately), wall time, and pass rate.
- Publish results in `docs/v8-phase-2-benchmark.md`. Refuse to ship this phase if v8 cost is not at least 30% lower than v6 on the benchmark, holding pass rate within 5%.

Exit criteria:

- Benchmark hits the 30% cost reduction floor.
- Pass rate within 5% of v6 (no quality regression).
- Cache hit rate measurable and exposed in run output (Anthropic returns this as response metadata).

## 6. Phase 3: speculative synthesis tournament

Duration estimate: 2 weeks.

Scope:

Add parallelism. Multiple personas race per obligation; cheap verifier picks the winner.

Deliverables:

- `src/population/tournament.ts`: orchestrates N parallel candidate generations per obligation.
- `src/persona/verifier-persona.ts`: a Haiku-tier persona that scores candidate diffs against contract assertions. Output is a structured score plus a brief rationale.
- Tournament configuration per obligation type: number of candidates, diversity budget, model tier for candidates, model tier for verifier, escalation rules.
- Discard semantics: losing candidates are logged to the ledger with full diff hash but never applied. Their token cost is captured for cost attribution.

Diversity injection:

- For tournament rounds where all candidates fail verification, the next round must use different sampling parameters (different temperature) and may use different personas.
- Hard cap on rounds per obligation: 3. After 3 failed tournament rounds, escalate to user with all candidate diffs and verifier scores.

Exit criteria:

- A tournament run on a deliberately tricky obligation (e.g., "add a function that handles all edge cases of timezone conversion") shows multiple candidates, verifier picks the best, top candidate commits.
- Cost benchmark refreshed: tournament mode versus single-persona mode versus v6. Tournament should be no more than 1.5x single-persona cost while showing measurably better pass rate on tricky obligations.

## 7. Phase 4: evidence ledger with hash chain

Duration estimate: 1 week.

Scope:

The ledger has been present in primitive form since Phase 1 (contract storage). This phase adds the full hash-chain semantics, integrates with IRONROOT primitives, and adds memoization.

Deliverables:

- `src/ledger/ledger.ts`: append-only JSONL with hash chaining. Each entry includes the hash of the prior entry. Tampering is detectable; replay is reproducible.
- `src/ledger/memoization.ts`: before any tournament, query the ledger for prior obligations with matching contract assertions. If a satisfied identical obligation exists, skip synthesis. If two candidates are diff-identical, the second is a free skip.
- IRONROOT integration: use existing IRONROOT primitives for the hash-chain implementation. No reimplementation.
- Run resumption: a partially-completed run can resume from its ledger state. The CLI command `swarm v8 resume <run-id>` reconstructs population state and continues.

Exit criteria:

- A run that completes 5 obligations, gets killed mid-6th, can be resumed and finish without redoing work.
- Memoization measurably reduces cost on a goal that contains repeated obligation patterns (e.g., "add health checks to 4 services" should share work).
- Ledger tamper detection passes: a manually edited ledger entry is detected and run aborts.

## 8. Phase 5: WASM deterministic floor

Duration estimate: 2 weeks.

Scope:

Many obligations don't need an LLM. This phase adds the deterministic execution path.

Deliverables:

- `src/wasm/wasm-runtime.ts`: a sandboxed WASM execution layer. Wasmer or wasmtime as the runtime; choice deferred to phase implementation based on platform support.
- A library of first-party WASM modules covering common operations:
  - Code formatters (Prettier wrapper, Black wrapper, gofmt wrapper). These run native binaries; WASM is for the orchestration logic, not the formatter itself.
  - Import sorter and dead-import remover (per-language).
  - Simple AST-based renames using tree-sitter parsers compiled to WASM.
  - License header insertion and file naming convention enforcement.
  - Boilerplate scaffolding from registered templates.
- The contract compiler is updated to tag deterministic-eligible obligations. New tag in the contract schema: `deterministic-strategy: <strategy-name>`.
- Population manager dispatches deterministic-eligible obligations to the WASM runtime instead of the tournament. Verification runs as normal post-execution.

Misclassification recovery:

- If a WASM module fails to satisfy its obligation, the obligation re-routes to synthesis. No retry of the WASM module.
- WASM module failures are logged to the ledger. Repeated failures of the same module on the same project type are flagged for the user; a likely cause is a misclassification heuristic in the contract compiler.

Exit criteria:

- A goal containing at least one deterministic-eligible obligation completes that obligation with zero LLM tokens consumed.
- Cost benchmark refreshed. Goals dominated by deterministic obligations should cost dramatically less in v8 than in v6.
- Three first-party WASM modules ship: formatter wrapper, import sorter, scaffolding template engine.

## 9. Phase 6: streaming verification

Duration estimate: 1 to 2 weeks.

Scope:

Verification at multiple points, including mid-generation early-abort.

Deliverables:

- `src/verification/streaming-verifier.ts`: receives partial generation output from the Anthropic streaming API at intervals. Evaluates contract assertions that are checkable on partial output (e.g., "imports must include X" can be checked once the imports section is generated).
- Early abort signal: when streaming verification detects a contract violation that can't be repaired by continuing, the generation is canceled. Tokens generated to that point are still billed; tokens not generated are saved.
- Pre-generation verification: skip obligations already satisfied. Implemented in Phase 4 memoization, formalized here.
- Post-merge verification: a final integration check after all obligations have committed. Runs the full contract suite end-to-end. If post-merge verification fails, the entire run is marked failed and rolled back.

Exit criteria:

- A run with a deliberately doomed obligation (e.g., "import a package that doesn't exist") aborts mid-generation rather than completing the doomed diff.
- Token savings on aborted generations measurable in run output.
- Post-merge verification catches at least one class of integration failure not catchable by per-obligation verification (e.g., two obligations that individually pass but together produce a broken build).

## 10. Phase 7: persona library expansion and contract type expansion

Duration estimate: ongoing.

Scope:

Iterative expansion of personas and contract obligation types based on real-world usage.

Persona library expansion targets (priority order):

1. `security-reviewer`: scores diffs for common vulnerability patterns; integrates with Semgrep or similar SAST tools as verification.
2. `dependency-auditor`: handles obligations involving package manifests, lockfiles, and security advisories.
3. `documentation-writer`: targets obligations involving README, API docs, comment generation.
4. `migration-specialist`: targets cross-language and cross-framework migrations.
5. `test-author`: specializes in test generation; works alongside `implementer` to produce coverage.

Contract type expansion targets:

1. `function-must-have-signature(file, name, signature)`: type-level check against the AST.
2. `property-must-hold(predicate, target)`: property-based testing integration.
3. `import-graph-must-satisfy(constraint)`: dependency-graph constraints (no cycles, no upward imports).
4. `coverage-must-exceed(threshold, scope)`: test coverage assertions.
5. `performance-must-not-regress(benchmark, threshold)`: performance regression checks.

Exit criteria:

- This phase is open-ended. A "phase 7 complete enough for v8.0 release" milestone requires at least 7 personas in the library and at least 8 contract obligation types. Beyond that, expansion is post-release roadmap.

## 11. Testing strategy

Per-phase test discipline:

- Unit tests cover individual module behavior. Strict no-mocks rule for things that can be tested directly. Mocks acceptable for outbound API calls (Anthropic, OpenAI) where deterministic test fixtures are essential.
- Integration tests cover phase-level behavior against fixture repositories. Each phase ships at least 5 integration tests.
- End-to-end tests cover a small set of representative goals, run against real repositories under controlled cost budgets. End-to-end tests are gated behind an `E2E=1` environment flag because they consume real API credits.
- Cost benchmarks are a separate test category. They run on a schedule (e.g., weekly) against a fixed benchmark suite, with results tracked over time in `docs/benchmarks/v8-history.jsonl`.

Test coverage targets:

- Unit test coverage: minimum 85% line coverage per module.
- Integration test coverage: minimum 1 integration test per public CLI command per phase.
- Regression tests: every bug fix ships with a test that fails before the fix and passes after.

## 12. Migration plan from v6 to v8

v8 ships as a new major version. v6 is supported for a deprecation window.

Migration path for users:

- v8 is opt-in via the `--v8` flag during the transition period. Default remains v6.
- After Phase 4, v8 becomes opt-out: default switches to v8, `--v6` flag preserves old behavior.
- After v8.1, v6 is removed.

Migration path for contributors:

- v8 lives in a separate branch (`v8-dev`) until Phase 6 completion.
- v8 merges to main as the new default after Phase 6, with v6 code preserved under `src/legacy/v6/`.
- Legacy v6 code is removed two minor releases after v8 default.

Recipes (the existing parameterized plan templates) translate to contracts:

- A recipe parameter set becomes a contract template.
- Recipe execution becomes contract compilation followed by v8 execution.
- All current recipes (add-tests, add-auth, add-ci, migrate-to-ts, add-api-docs, security-audit, refactor-modularize) ship as contract templates in v8.

The GitHub Action surface remains compatible. The `swarm` action accepts the same inputs (goal, tool, recipe, plan, pr) plus new optional inputs (`contract-only` for compile-without-execute, `cost-cap` for hard cost ceilings).

## 13. Definition of done per phase

Each phase is "done" only when all three conditions hold:

1. All exit criteria for the phase, as listed in that phase's section, are met.
2. Documentation is updated: README references the phase's capabilities (when shipped), per-module JSDoc is complete, and the architecture document reflects any deviations from the original plan.
3. CI is green on the v8-dev branch.

## 14. Risk-ordered build sequence justification

Why this phase ordering, and not something else:

- Phase 1 (contract compiler) first because the contract is the verification surface. Without it, every later phase is building on guesswork.
- Phase 2 (population manager) next because the cost-economic claim must be validated on the new substrate before adding parallelism complexity. If single-persona on the new substrate isn't 30%+ cheaper than v6, the architecture is wrong and earlier rework is cheaper.
- Phase 3 (tournaments) once the substrate is proven, because tournaments are the swarm. Earlier, they would multiply unproven cost.
- Phase 4 (full ledger) before WASM because the ledger enables memoization, which interacts with deterministic execution paths.
- Phase 5 (WASM) after the ledger because deterministic operations need to be auditable in the ledger like everything else.
- Phase 6 (streaming verification) last among core phases because it requires Anthropic streaming API integration, which is the most operationally complex piece. Building it earlier risks blocking on streaming-API issues that aren't load-bearing for the core architecture.
- Phase 7 (expansion) is open-ended because it's iterative product work, not foundational architecture.

## 15. References

For architectural rationale and research grounding behind these phases, see `v8-overhaul-guide.md`. The implementation guide does not duplicate citations; the architecture document is authoritative.

Specific technical references useful during implementation:

- Anthropic API documentation, prompt caching: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- Anthropic API documentation, streaming: https://docs.claude.com/en/api/streaming
- IRONROOT (personal OSS, hash-chained verified memory primitives): https://github.com/moonrunnerkc/ironroot
- Tree-sitter parser library (for AST-based deterministic transformations): https://tree-sitter.github.io
- Wasmer runtime: https://wasmer.io
- Wasmtime runtime: https://wasmtime.dev
- VeriMAP retry-budget research (cited in overhaul guide): Augment Code documentation.

## 16. Open questions deferred to implementation

These are intentionally unresolved at the spec level and require implementation experiments:

- Optimal number of personas in the default population. Current placeholder: 5 to 7. Real number determined by Phase 3 benchmarking.
- Optimal verifier model tier. Current placeholder: Haiku. May upgrade to Sonnet for security-critical contract obligations.
- Cache TTL handling across runs. Anthropic's 5-minute default may require batching strategies. Phase 2 will measure cache hit rate at typical run durations and inform the strategy.
- Whether to support OpenAI as a first-class provider in v8.0 or defer to v8.1. Current default: Anthropic-only at v8.0. OpenAI support follows once Anthropic is stable.
- Local model support (via Ollama or similar). Deferred to post-v8.0 unless implementation reveals a natural integration point.
