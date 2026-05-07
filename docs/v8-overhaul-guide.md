# Swarm Orchestrator v8 Overhaul Guide

Status: design specification, pre-implementation
Intended audience: maintainers, contributors, evaluators
Companion document: `v8-implementation-guide.md`

## 1. Why this overhaul exists

The current repository is a verification and governance layer for AI coding agents wearing the vocabulary of a swarm. Pre-v7 was an actual swarm but the substrate (parallel CLI subprocesses, each booting full agent context independently) made it economically untenable for users. v4 through v6 fixed costs by collapsing the swarm into a verified pipeline with parallel branches that don't coordinate. The result is a strong verification engine, not a swarm.

v8 returns to genuine swarm semantics while fixing the cost problem at its actual root. The cost problem was never "swarming is expensive." The cost problem was "N independent CLI agents each rebuild full context from scratch, then retry on failure with no shared state." Different problem, different fix.

## 2. Goals and non-goals

Goals:

- Restore actual swarm behavior: decentralized, stigmergic, emergent specialization, no central scheduler dictating each move.
- Drive per-run cost meaningfully below v6 while improving accuracy.
- Eliminate repair loops as a cost vector. Replace them with discard-and-regenerate from a different agent path.
- Verify before commit, with checks running before, during, and after generation.
- Keep the existing "evidence-based governance" market positioning. Extend it with cost-economic claims that hold up under measurement.

Non-goals:

- v8 is not a model trainer, a fine-tuning system, or a custom inference stack.
- v8 is not a generic multi-agent framework competing with LangGraph, CrewAI, or Microsoft Agent Framework. Its scope is AI coding agents acting on real codebases.
- v8 does not replace the verification engine concept; it expands what verification governs.
- v8 is not a fully autonomous developer. Humans approve contracts before execution.

## 3. Prior art and where v8 sits

Each individual technique v8 uses has prior art. The combination, packaged as a CLI tool and GitHub Action targeting real codebases under a verification-first contract, does not currently exist in deployed form.

Shared KV cache across multi-agent calls is documented in Prompt Choreography (Bai and Eisner, December 2025), KVComm (October 2025), and TokenDance (2026). These are research frameworks, not shipping code-agent orchestrators.

Verifier-guided code synthesis appears in VerMCTS, Agentic Verifier, MapCoder, and CODESIM. These target competitive programming benchmarks, not production codebases.

Contract-aware multi-agent generation is implemented in Veri-Sure, but for RTL/Verilog only.

WASM deterministic transformations combined with tiered model routing are shipped by Ruflo (Agent Booster), reporting roughly 85% API cost reduction. Ruflo's orchestration model is conductor-shaped, not stigmergic.

Production multi-agent orchestrators in 2026 (LangGraph, CrewAI, Microsoft Agent Framework, Swarms, Agency Swarm) all converge on conductor patterns with optional swarm layers. None implement contract-first stigmergic coordination with prompt-caching-native economics.

The validated cost and reliability problems v8 addresses are not contested. Multi-agent systems are documented to consume 4 to 15x more tokens than equivalent single-agent calls when unoptimized. Production case studies report multi-agent deployments costing more than 2x equivalent single-agent for marginal accuracy gains. Industry retry-loop research caps attempts at three because indefinite retry burns budget without improving outcomes; semantic failures rarely recover under retry. Spotify reported a 25% veto rate from a judge layer in production, with only roughly half of vetoed agent changes course-correcting. The economic gap v8 targets is real and measured.

## 4. The three architectural inversions

### 4.1. Inversion one: CLI subprocess to shared inference session with persona switching

Today, each "agent" is a separate CLI invocation (Copilot CLI, Claude Code CLI, Codex CLI). Each invocation boots a fresh agent context, re-loads tool definitions, re-authenticates, and re-derives project understanding from scratch. With N agents in parallel, the cost is N times the per-agent overhead before any useful work happens.

v8 replaces this with a single inference session, hosted via the Anthropic API directly, that hosts multiple personas via system-prompt slicing. The project context (codebase summary, contract, prior ledger entries) is sent once as a cached prefix. Personas are differentiated by system-prompt suffix, sampling temperature, and model tier.

Anthropic prompt caching documents up to 90% input-token cost reduction on cached prefixes. Independent benchmarks on long-horizon agentic tasks measured 41 to 80% total API cost reduction across providers using prompt caching, with 13 to 31% improvements in time-to-first-token. The structural advantage compounds with multi-persona work because all personas share the same project context.

CLI execution is preserved as an opt-in fallback mode for users who specifically want the heavyweight isolation, but it stops being the default substrate.

### 4.2. Inversion two: repair loops to verify-before-commit with cheap rollback

Today, when a step fails verification, a repair agent receives structured failure context and retries. Up to three retries per step is the documented default. Repair amplifies cost: a step that ultimately succeeds may have burned 4x its baseline budget. A step that ultimately fails burns 4x and produces nothing.

VeriMAP's published retry economics (40K tokens per attempt, 3-attempt cap) means a single failing subtask consumes 120K tokens. Augment Code's documentation of VeriMAP defaults notes that semantic failures rarely improve with more retries; the retry budget is mostly wasted on failures that won't converge. Spotify's production data shows roughly half of agent course-corrections succeed after veto, meaning the other half consumed retry budget for no result.

v8 removes the repair loop entirely. Each contract obligation is satisfied by a generation tournament: multiple personas generate candidate diffs in parallel, a cheap verifier scores them against the contract, the top scorer commits, others are discarded. There is no retry. There is no repair. If all candidates fail, the obligation escalates to a different persona configuration with a different sampling regime; this is a fresh tournament, not a retry of failed work.

The economic case is direct. Two cheap parallel candidates from different personas cost less than three sequential repair attempts because of prompt caching shared across the parallel candidates and because failed candidates carry no retry tax. Tournament selection is also empirically sound for code generation: Agentic Verifier (2026) reports +10 to +15% absolute Best@k accuracy gains over single-attempt strong baselines through execution-based candidate selection.

### 4.3. Inversion three: conductor pipeline to stigmergic shared workspace

Today, a greedy scheduler dispatches steps to agents. The scheduler is the brain. Agents are workers. They don't coordinate; they execute and return.

v8 has no scheduler. It has a shared workspace (the evidence ledger) and a population of personas with trigger predicates. A persona wakes when its trigger fires. The trigger fires based on what's in the ledger. The ledger updates based on what personas write. This is stigmergic coordination, the actual swarm pattern from ant colony optimization (Bonabeau, Dorigo, Theraulaz; 1999).

This isn't aesthetic. Direct messaging in multi-agent systems creates O(N²) coordination overhead and a protocol-design problem. Stigmergy is O(N) read plus O(1) write. It also makes the system inspectable: the ledger is the audit trail, the resume point, and the memoization cache, all in one append-only file.

## 5. Architecture, layer by layer

### 5.1. Layer 1: spec-to-contract compilation

Before any persona executes, the user-supplied goal is compiled into a machine-checkable contract. Contract obligations have types: `file-must-exist`, `function-must-have-signature`, `test-must-pass`, `build-must-pass`, `property-must-hold`, `import-graph-must-satisfy`, and so on.

The contract is the goal in machine form. A plan is "what I think needs to happen." A contract is "what must be true at the end." If a goal cannot be compiled to a contract, the user refines the goal before execution starts. There is no planner agent guessing what the user meant; vague specifications are surfaced, not papered over.

Veri-Sure's RTL work establishes the precedent for contract-first multi-agent code generation. v8 generalizes this to general-purpose code agents with extensible contract types.

### 5.2. Layer 2: population manager

A pool of 5 to 20 personas hosted in a single inference session. Personas differ across three axes:

- System-prompt slice: architect, refactorer, test-writer, security reviewer, integration-verifier, documentation-writer, dependency-auditor.
- Sampling regime: temperature, top-p, repetition penalty.
- Model tier: Haiku (cheap, used for the majority), Sonnet (mid-tier), Opus (escalation only, hard count cap per run).

The population manager does not assign tasks. It listens to the ledger and evaluates trigger predicates. Each persona has a predicate of the form: "wake when contract has unsatisfied obligations matching pattern X AND ledger state matches condition Y." Predicates are declarative; the population manager just evaluates them.

The Plan-and-Execute pattern, where a capable model creates strategy and cheaper models execute, is documented to reduce costs by roughly 90% in production deployments compared to using frontier models for everything. v8 applies this aggressively: cheap personas dominate, expensive personas only fire when explicit escalation criteria are met.

### 5.3. Layer 3: speculative synthesis tree

For each contract obligation that requires synthesis (not deterministic transformation), the population manager initiates a tournament. Multiple personas generate candidate diffs in parallel. A cheap verifier persona scores each candidate against the obligation's contract assertions.

Tournament parameters are tunable per obligation type:

- Number of candidates: typically 2 to 4. More candidates raise success probability but cost more in aggregate.
- Diversity budget: controls how different candidates must be from each other.
- Verifier escalation: if all candidates score below threshold, the next round uses different personas, different temperatures, or escalates to a higher model tier.

Prompt caching makes the N parallel candidates economically efficient: most input tokens are shared, only the persona-specific suffix varies. The total token cost of N candidates is approximately the cost of one candidate plus the variable portion times N.

HDLFORGE's two-stage adaptive escalation pattern (primary solver, then ultra-large model on failure) demonstrates the cost-effectiveness of this approach in formal verification contexts. v8 generalizes the pattern across all contract obligation types.

### 5.4. Layer 4: evidence ledger

A single append-only file (`./swarm/ledger.jsonl`), hash-chained, where every persona action is recorded.

Each entry contains:

- Timestamp and persona identity
- Contract obligation targeted
- Action type (synthesis attempt, verification result, commit, escalation, decline)
- Token cost and model used
- Cryptographic hash of prior entries (chained)
- Optional payload reference (diff hash, test output ID, etc.)

The ledger does quadruple duty. It is the swarm's coordination environment (personas read the ledger to decide what to do). It is the audit trail (governance use case directly relevant to Aftermath Technologies positioning under EU AI Act and NIST AI RMF compliance frameworks). It is the memoization cache (if an obligation has been satisfied, no persona retries it; if two personas propose identical diffs, the second is a free skip). It is the rollback primitive (any prior state is reproducible from the ledger plus initial repository state).

This layer reuses Brad's existing IRONROOT primitives for the hash-chained append-only structure. No reinvention of a verified-memory system; the existing personal OSS work plugs in directly.

### 5.5. Layer 5: outcome-based verification, multi-point

The current `verifier-engine.ts` runs verification only after generation completes. v8 verifies at four points:

- Pre-generation: is this obligation already satisfied per the ledger? If yes, skip entirely. Free.
- Mid-generation: for streaming generations, sample partial output every N tokens and abort early on contract violations. Saves the remaining generation cost on doomed branches.
- Post-generation, pre-commit: existing checks (git diff against base, build execution, test execution, file existence).
- Post-merge: integration verification across all merged contracts together.

Mid-generation streaming verification is the novel piece. OmniVerifier-TTS (October 2025) demonstrates verifier-guided test-time sequential scaling with interleaved generation and local edits, validating that mid-stream verification is technically sound. No production code-agent orchestrator currently implements it.

### 5.6. Layer 6: WASM deterministic floor

Many obligations don't need an LLM. Examples:

- Import sorting and dead-import removal.
- Code formatting (Prettier, Black, gofmt invocations).
- Mechanical refactors: rename symbol, extract method, inline variable, move function.
- Type annotation insertion where types are inferable.
- Boilerplate scaffolding from templates.
- License header insertion, file naming convention enforcement.

These run as WASM modules, invoked by the contract compiler when an obligation is tagged as `deterministic-eligible`. Zero token cost, sub-millisecond execution.

Ruflo's published Agent Booster pattern reports 352x speedup and zero LLM cost on similar deterministic operations, contributing to their 85% overall API cost reduction. v8 adopts the pattern with a different orchestration substrate beneath it.

The contract compiler is responsible for tagging obligations correctly. A misclassification (treating a synthesis-required obligation as deterministic-eligible) fails fast at the WASM module level and re-routes to synthesis.

## 6. Cost model (illustrative)

For a typical 8-obligation goal, comparing v6 (current architecture) to v8 (proposed):

v6 estimate:

- 8 CLI invocations × roughly 40K input tokens per invocation (full context boot per CLI call) = 320K input tokens
- 8 × roughly 3K output tokens = 24K output
- Assume 30% step failure rate, 3 retries per failed step = 7 extra retry cycles
- 7 × 30K input + 7 × 3K output = 210K input + 21K output additional
- Total: roughly 530K input, 45K output

v8 estimate:

- Contract: 10K input as cached prefix, charged at full price once
- 8 obligations × 2 candidates per tournament = 16 generation calls
- Each call: 10K cached input (90% discount per Anthropic documented rates = roughly 1K effective) + 3K obligation-specific = 4K effective input
- 16 calls × 4K = 64K effective input + 16 × 3K = 48K output
- Cheap Haiku verifier: 16 × 2K input + 16 × 0.5K output = 32K input + 8K output
- WASM handles roughly 30% of obligations at zero cost (revise above downward by 30%)
- No repair loops, no retry tax
- Total: roughly 70 to 90K effective input, 40 to 50K output

Structural cost reduction: roughly 5 to 6x on input, comparable output.

Real-world measurements will diverge. The structural advantage is large enough that even pessimistic numbers favor v8 by 3 to 4x. Cost benchmarking is a Phase 2 deliverable in the implementation guide.

## 7. What v8 deliberately does not solve

Scoping discipline matters more than features.

- v8 does not write production code with no human review. The contract step is human-approved. The output is human-merged (or auto-merged behind a CI gate, by user choice).
- v8 does not handle adversarial codebases. The verification surface assumes the project's build, test, and lint configuration is trustworthy.
- v8 does not solve the "ambiguous goal" problem. Goals that don't compile to contracts are surfaced to the user, not papered over.
- v8 does not provide its own LLM. It uses Anthropic, OpenAI, or local models via adapter; it does not host inference.
- v8 does not promise correctness on tasks where the contract underspecifies the outcome. Contract validation is the user's responsibility; v8 enforces what the contract says, not what the user wished.

## 8. Risk register

### 8.1. Contract under-specification

The contract passes but the actual goal isn't met. Likely cause: user-written contract is too loose. Mitigation: contract validation step where the user reviews the compiled contract before execution starts. The contract is visible, not magic. A future extension could include an LLM-assisted contract review persona that flags likely under-specification.

### 8.2. Stigmergy stagnation

No persona's trigger predicate fires; everything is "satisfied" but the goal isn't done. Likely cause: trigger predicates miss a real obligation, or the contract has unreachable assertions. Mitigation: a watchdog timer plus an escalation persona that diagnoses gaps and either refines a predicate, edits the contract (with user approval), or surfaces the issue.

### 8.3. Speculative tournament thrashing

All N candidates fail similarly across multiple rounds. Likely cause: contract assertion is impossible to satisfy, or all personas share a blind spot. Mitigation: diversity injection (force different personas, different temperatures, different model tiers across rounds) plus a hard total-candidate budget per obligation. After exhaustion, escalate to user with the failed candidates and verifier output for human diagnosis.

### 8.4. Cache invalidation cascade

Mid-run contract changes invalidate the cached prefix and bust everyone's economics. Mitigation: contracts are immutable once execution starts. Changes require a new run. A future extension could support contract-extension semantics (additive only) to allow some mid-run growth without busting cache.

### 8.5. Provider lock-in via prompt caching specifics

Anthropic's caching behavior, TTL (5 minutes as of early 2026), and breakpoint mechanics differ from OpenAI's automatic prefix detection. Mitigation: cache strategy is provider-pluggable. A v8 abstraction layer normalizes cache breakpoint placement and TTL handling. Loss of optimal cache behavior on a non-Anthropic provider is acceptable; correctness must be provider-agnostic.

### 8.6. WASM module supply chain

WASM modules for deterministic operations are a supply-chain concern. Untrusted WASM running on user code is a real risk. Mitigation: only ship first-party WASM modules in v8 core. Third-party WASM is opt-in with explicit user consent and signature verification.

### 8.7. Cost claims under audit

Marketing v8 on cost reduction creates pressure to overclaim. Mitigation: measured benchmarks against v6 published in the repo, methodology open for inspection, with stated assumptions and conditions. Refuse to make headline cost claims that aren't backed by reproducible runs.

## 9. Positioning and market frame

The current pitch is "verification and governance for AI coding agents." v8 keeps this and adds "evidence-based swarm coordination at sub-CLI cost."

Differentiation:

- Conductor frameworks (LangGraph, CrewAI, Microsoft Agent Framework): they manage agents. v8 coordinates a swarm.
- Repair-loop frameworks (most current orchestrators): they retry until pass. v8 commits only proven work; failures are discarded, not retried.
- CLI-multiplied frameworks (current swarm-orchestrator, Codename Goose, others): every agent boots fresh. v8 runs in shared inference sessions with cache reuse.
- WASM-augmented frameworks (Ruflo): they share the deterministic floor concept but ship a conductor pattern. v8 ships swarm semantics on top.

The architectural commitments are deeply different, not feature-different. Differentiation holds up under technical scrutiny because the cost model and verification model are structurally different, not configurable variations of the same pattern.

This aligns with Aftermath Technologies' positioning as a verification, governance, and compliance tooling company for AI coding agents. v8 is positioned as a personal OSS project under moonrunnerkc; it is not a product of Aftermath Technologies.

## 10. References

Architecture and orchestration patterns:

- Bai, T., and Eisner, J. (December 2025). Accelerating Language Model Workflows with Prompt Choreography. arxiv:2512.23049.
- Online Cross-context KV-cache Communication (KVComm). arxiv:2510.12872 (October 2025).
- TokenDance: Scaling Multi-Agent LLM Serving via Collective KV Cache Sharing. arxiv:2604.03143 (2026).
- Veri-Sure: A Contract-Aware Multi-Agent Framework with Temporal Tracing and Formal Verification for Correct RTL Code Generation. arxiv:2601.19747.
- VerMCTS: Synthesizing Multi-Step Programs using a Verifier, a Large Language Model, and Tree Search. arxiv:2402.08147.
- HDLFORGE: A Two-Stage Multi-Agent Framework for Efficient Verilog Code Generation with Adaptive Model Escalation. arxiv:2603.04646.
- Scaling Agentic Verifier for Competitive Coding. arxiv:2602.04254 (2026).
- MapCoder: Multi-Agent Code Generation for Competitive Problem Solving. arxiv:2405.11403.
- CODESIM: Multi-Agent Code Generation and Problem Solving through Simulation-Driven Planning and Debugging. arxiv:2502.05664.
- A Survey on Code Generation with LLM-based Agents. arxiv:2508.00083 (July 2025).

Prompt caching and cost economics:

- Anthropic. Prompt caching with Claude. https://www.anthropic.com/news/prompt-caching (general availability December 2024; 5-minute default TTL effective early 2026).
- Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon Agentic Tasks. arxiv:2601.06007 (February 2026). Measured 41 to 80% cost reduction, 13 to 31% TTFT improvement across providers.
- Amazon Bedrock prompt caching documentation. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
- Cerebras Inference prompt caching documentation. https://inference-docs.cerebras.ai/capabilities/prompt-caching
- Token optimization 2026: saving up to 80% LLM costs. Obvious Works (multi-agent token consumption 4 to 15x baseline when unoptimized).
- Multi-Agent Orchestration Economics: When Single Agents Win 2026. Iterathon (production case study, $47K vs $22.7K monthly cost differential).

Production verification and repair-loop economics:

- Spotify: Building Reliable Background Coding Agents with Verification Loops. ZenML LLMOps Database (25% veto rate, ~50% course-correction success).
- Coordinator-Implementor-Verifier pattern (VeriMAP defaults: 3 attempts, 5 replanning iterations, 40K tokens per attempt). Augment Code documentation.

Swarm intelligence foundations:

- Bonabeau, E., Dorigo, M., and Theraulaz, G. (1999). Swarm Intelligence: From Natural to Artificial Systems. Oxford University Press.

Cost-reduction patterns in production:

- Plan-and-Execute pattern with documented 90% cost reduction vs frontier-model-everywhere. Machine Learning Mastery, January 2026.
- Ruflo Agent Booster (WASM deterministic transformations, 352x speedup, contributing to 85% API cost reduction). byteiota Agent Orchestration Frameworks 2026.

Production multi-agent orchestrator landscape (cited for competitive scoping):

- LangGraph, CrewAI, Microsoft Agent Framework, OpenAI Agents SDK, Google ADK, Swarms (kyegomez), Agency Swarm.
- The AI Agent Framework Landscape in 2025 (Trung Hieu Tran, Medium, November 2025).
- Best Multi-Agent Frameworks in 2026 (gurusup.com).
