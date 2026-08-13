# Swarm Orchestrator v13: Build Guide

Strategic build document. No implementation code here by design: code belongs in the phased build sessions (see the companion prompts file), where each component gets full context. This document defines what to build, why, in what order, and what to refuse to build.

---

## 1. Problem Statement

Coding agents produce work that humans can't efficiently trust. The model says "tests pass" and you either believe it or re-verify everything yourself, which erases the productivity gain. Existing agents log what happened; almost none prove it. Meanwhile drift, laziness, placeholder stubs, and unrelated churn accumulate as silent tech debt.

v13 is a coding agent where every claim of completed work resolves to machine-captured evidence, quality gates enforce and auto-repair standards, and the tool can select the measurably best local model for the user's actual hardware and task. Success looks like: a reviewer can audit any run in minutes from a self-contained, tamper-evident bundle, without installing the tool, and every gate result in that bundle was produced by the harness, not asserted by the model.

Timing matters, and the dates have already moved once. The EU AI Act's logging obligations for high-risk systems (Article 12) were deferred by the 2026 Digital Omnibus to December 2027 for standalone Annex III systems and August 2028 for embedded ones, precisely because the technical logging standards (prEN 18229-1, ISO/IEC 24970, now at FDIS) weren't finished; neither is finalized yet. An evidence format designed now and aligned to those drafts as they harden arrives ahead of the deadline instead of retrofitting under it. Re-verify all three claims before they appear in any README or public page: a stale regulatory claim in a compliance-adjacent tool is worse than no claim.

## 2. Design Principles and Non-Goals

Principles:

1. Model output is a claim. Harness-captured execution output is evidence. Nothing crosses that line.
2. Zero-config default, one optional config file, progressive disclosure. Advanced power never taxes the simple path.
3. Every phase ships something independently useful. No big-bang integration.
4. Deterministic wherever possible; where the model is stochastic, record enough to replay.
5. The smallest verified change wins. Diff size is a cost, not an achievement.

Non-goals for v1 (each one is deliberate debt avoidance):

- No plugin system. Extension points can be carved later from real demand.
- No database. Append-only JSONL ledger plus a content-addressed blob directory.
- No daemon, no web server. Static HTML export for review.
- No multi-agent swarm at the core. One excellent loop; parallelism arrives in phase 6 as worktree workers, not as an architecture.
- No blocking LLM-as-judge gates. Advisory only, because judge noise (verbosity bias, self-preference, position bias) makes blocking judgments unreliable without heavy calibration.
- No custom inference. Ollama and rapid-mlx already solve local serving.
- No retrieval index or embedding search. Context assembly is grep-and-read over the workspace. This is the largest single determinant of coding-agent quality and the tradeoff is real; revisit with evidence from observed failures, not preemptively, and never let phase 1 quietly invent a retrieval layer.

## 3. Theoretical Foundations

These are the concepts that make v13 stronger than a logger with a nice UI. Each is labeled by confidence: established (proven mechanism, widely validated), grounded (real research, newer application), or heuristic (sound reasoning, needs empirical tuning).

### 3.1 Proof-Carrying Patches (established, by analogy)

Proof-carrying code (Necula, 1997) showed that verifying a certificate can be cheap even when producing the artifact was expensive, and that the consumer never has to trust the producer. v13 applies the analogy: every patch ships with a verification transcript (gate outputs, test runs, diffs, hashes) that a reviewer checks instead of trusting the agent. The certificate here is empirical rather than a formal proof, so label it honestly: this is PCC's trust model, not its mathematics.

### 3.2 The Evidence DAG (grounded)

Recent tracing research converges on claim-level tracing as the level that enables verification: linking individual generated claims to supporting, contradicting, or missing evidence, not just recording that steps occurred. v13's final task report is a DAG. Leaves are harness-captured records (a test run, a diff, a lint output, each content-addressed). Interior nodes are claims, and a claim is not free text: it is a structured assertion carrying a machine-checkable predicate against a named record, shaped roughly { predicate: "tests.failed == 0 && tests.collected >= 47", record: "sha256:..." }. The model chooses the record and the predicate; the harness evaluates the predicate against the blob and computes the verdict, so the model can under-claim but cannot over-claim. The fabrication surface is the edge, not the node: a real record with a wrong binding is the dangerous case, and predicate evaluation is what closes it. Free-text narrative lives in a separate field that always renders as unverified prose and can never render green. A claim with no evidence edge, a predicate citing a record that does not exist, and a predicate that fails to parse all render UNVERIFIED, in red, always: each is a display state, not an error that aborts the run. The agent cannot fabricate a green checkmark because green is computed by the harness from predicate evaluation, never emitted by the model.

### 3.3 Tamper-Evident Ledger with a Transparency-Log Upgrade Path (established)

Every action appends a hash-chained record (each record carries the previous record's hash). This is the Crosby-Wallach tamper-evident logging lineage that Certificate Transparency and sigstore made industrial. v1 ships the plain hash chain plus an ed25519 signature over the chain head at bundle export. Be precise about what that signature proves: with the key held on the machine the agent runs on, a compromised run (including via the injection section 3.4 defends against) can rewrite the chain and re-sign it. The signature is tamper-evidence against modification after the bundle leaves the machine and against transport tampering; it is not evidence against a malicious producer. The reserved upgrade path to a Merkle history tree (efficient inclusion and consistency proofs, anchored outside the machine) is what closes that gap, and it is reserved in the record format now so it costs nothing later. The signing key lives in the OS keychain, never in the workspace. Every bundle embeds a dependency-free verifier script: anyone can check chain integrity and signature without installing v13.

### 3.4 Execution Provenance and Taint Tagging (grounded)

Provenance tracking research (the Agent-Sentry line) tracks the sources of values flowing into tool arguments to detect untrusted influence. v13 tags every value entering a tool call with its origin: user, model, tool-output, or file. Tags alone cannot detect derivation: everything emerging from the model carries the model tag, including a command copied verbatim out of a file it just read. The implementable mechanism is a heuristic match, substring or normalized n-gram overlap, between tool-call arguments and untrusted content read within a recent window, with the window and threshold named as tunable. A match flags the call or routes it through confirmation. This is a heuristic with a measurable false-positive rate, not an information-flow guarantee, and both the docs and the bundle present it as such. The payoffs stand: injection resistance and richer evidence (the bundle shows not just what ran but what plausibly influenced it).

### 3.5 Deterministic Replay (established)

Record/replay debugging (the rr lineage) applied to agent runs: because every tool input and output is captured content-addressed, and model calls record model id, parameters, prompt digest, and full response, a run can be replayed from the ledger without touching the network or filesystem. Replay is transcript replay, without qualification: batched GPU inference is nondeterministic regardless of temperature (batch composition, KV-cache splits, floating-point reduction order all vary, on Ollama and MLX alike), so re-running the model is never asserted to reproduce the transcript. Instead every model call records a prompt digest and a response digest, and an optional rerun compares digests and reports divergence rather than claiming reproduction. Divergence reporting is the feature: it shows a reviewer exactly where a rerun stops matching the record. Transcript replay verifies internal consistency and lets a reviewer step through the run, which is the property regulators are starting to ask for by name.

### 3.6 Quality Gates as Monotone Fixed-Point Search (established math, heuristic application)

The auto-resolve loop is a search for a fixed point: a codebase state where all gates pass. The trap is oscillation, where fixing lint breaks a test and fixing the test breaks lint. v13 imposes a ratchet: a monotonicity constraint borrowed from quality-ratchet practice in large codebases, and it compares numbers, not booleans, because a boolean gate can be held green by deleting the four tests that were failing, which is exactly the patch a capped retry loop under gate-output pressure is tuned to produce. Each gate run records numeric measures, and the ratchet enforces: tests collected (not merely passed) non-decreasing; assertions in touched test files non-decreasing; coverage of changed lines non-decreasing; skip markers (.skip, xit, @pytest.mark.skip, t.Skip, and language equivalents) non-increasing. A retry that regresses a previously green gate, or trades any numeric in the wrong direction, is rejected outright and the attempt counter still increments. These numerics are ledger records like any other, so the ratchet's own decisions are evidence. One escape hatch, from v12's re-specification refuter: a submitted test that fails on the base commit is a new specification, not a tampered one, and does not trip the ratchet; without it, legitimate test changes get rejected and the model is driven toward workarounds. This converts a random walk into monotone progress or fast escalation. Cap attempts (default 3), then escalate to the human with the full evidence bundle. The ratchet is also the anti-slop mechanism: previously verified behavior can't be silently sacrificed.

### 3.7 Minimal-Change Discipline (heuristic)

An MDL-flavored gate: diff size and file-touch count get budgets scaled to task class. Exceeding budget doesn't block, it demands justification, which lands in the evidence bundle as a claim the reviewer sees. Paired with two deterministic slop detectors that do block. First, file-set membership: "unrelated to the task" is a semantic judgment needing a judge, which is a non-goal, so the planner declares its intended file set up front as a ledger record and the check is set membership; expanding the set requires an explicit recorded amendment that appears in the bundle as a claim the reviewer sees. Second, no TODO, FIXME, placeholder, or stub markers introduced. These three cheap checks catch the majority of what people call AI slop. Label heuristic: budgets need tuning against real usage.

### 3.8 Model Routing as a Bandit (established math, grounded application)

After calibration picks a starting local model, treat per-task-class model choice as a UCB bandit problem where reward is gate outcome weighted by cost and latency. Two corrections keep that signal honest. First, the reward depends on the section 3.6 numeric ratchet: unratcheted gate-pass-rate rewards whichever model is best at weakening tests, so the ratchet numerics ride along in every reward record and a pass earned by erosion scores as a failure. Second, the router selects the model, so the estimate feeds on its own output; a small epsilon of random assignment (roughly 10%) keeps it unbiased, since UCB's exploration term and self-declared task class are only thin compensation. With both in place, every real task produces usable ground truth (did the gates honestly pass, in how many attempts) and the routing table improves for free as the tool is used. This carries your Counterfactual Court UCB budget-allocator concept into a new domain. v1 ships the reward logging; the actual bandit switch-over activates in phase 5 once enough samples exist, because a bandit on five data points is astrology.

### 3.9 Calibration as Measurement, Not Vibes (established methodology)

Model selection follows evaluation-design-first discipline: define the scoring dimensions before building. Dimensions scored independently, never collapsed to one number: tool-call validity rate, patch-apply success, gate-pass rate, tokens per second, time to first token, peak memory. Report distributions and variance, not averages. The calibration task set is a small stratified golden set (edit task, multi-file task, test-fixing task, tool-heavy task) that grows permanently whenever a real-world failure is observed, so it cannot silently regress. The calibration report is itself an evidence bundle: the model choice is proven the same way the code is.

### 3.10 Design Inputs from v12 (read before phase 3)

v12 solved a strictly harder version of the section 3.6 problem and the findings were expensive. All of it is readable from the v12 repo without restoring anything: git show main:\<path\>. Three inputs and a fixture source: (1) src/audit/cheat-detector/coverage-erosion.ts and assertion-strip.ts hold the numeric monotonicity checks section 3.6 requires, already tuned against false positives on legitimate feature PRs. (2) src/audit/cheat-detector/no-op-fix.ts, no-op-fix-helpers.ts, and src/audit/execution-grounded/no-op-fix-restoration.ts encode a distinction v13's diff-budget and slop checks need: a change is not provably a no-op unless the affected tests execute every reverted changed line, and untested is not the same as cheating (that distinction resolved three false positives on real PRs). (3) The re-specification refuter is the section 3.6 escape hatch. (4) benchmarks/falsification-corpus/v10-synthetic-corpus/ holds roughly 1059 synthetic broken diffs across coverage-erosion, assertion-strip, and related patterns, directly reusable as fixtures the gates must reject.

## 4. Architecture

### 4.1 Stack

- TypeScript, Node 22+, strict mode, ESM.
- Vercel AI SDK as the provider abstraction: the 2026 default for TypeScript agents, model-agnostic, typed tool calling and agent loops in one surface. Covers Anthropic, OpenAI, and Google natively, and its OpenAI-compatible provider covers both Ollama and rapid-mlx with one adapter.
- Ink for the TUI (the Claude Code and Gemini CLI lineage, mature ecosystem, React mental model).
- Vitest for tests, Biome for lint and format (one tool, fast, fewer deps than ESLint plus Prettier).
- Zod for every boundary schema: config, ledger records, bundle manifest, provider responses.
- Tradeoff accepted: Rust with Ratatui would start faster and ship a single static binary, but costs iteration speed and ecosystem access. Revisit only if TUI performance measurably suffers.

### 4.2 Components

**Core loop** (src/core). Plan, act, verify. The loop asks the model for the next action, executes tools through the tool layer, feeds results back, and terminates on completion claim or budget exhaustion. Termination conditions are explicit: max steps, max tokens, max wall time, user interrupt. All stochastic inputs (clock, randomness, model) are injected, never imported, so the core is testable and replayable.

**Tool layer** (src/tools). read, write, edit, shell, search, list. Every tool call passes through one chokepoint that (a) records the ledger entry, (b) applies provenance tags, (c) enforces the workspace sandbox: no path escapes, shell allowlist with confirmation fallback, and a default read-denylist (.env*, *.pem, *.key, .git/config, ~/.aws, ~/.ssh), with each denial itself recorded as evidence, because a workspace .env with live keys is the ordinary case, not the exotic one. Tools are boring on purpose; the chokepoint is the product.

**Evidence ledger** (src/evidence). The session ledger and blob store live outside the workspace (~/.swarm/sessions/\<id\>/ or equivalent), and the sandbox explicitly denies tool writes to that path. This is an invariant, not an implementation detail: the threat model assumes a deceptive or compromised model, and evidence the subject can reach is not evidence. Append-only JSONL per session. Record fields: sequence number, previous-record hash, timestamp, record type, actor (model id or harness), payload digest, provenance tags. Full payloads live in a content-addressed blob directory keyed by SHA-256. Bundle export assembles the chain, blobs, evidence DAG, ed25519 signature, embedded verifier script, and a static HTML review page (claims left, linked evidence right, unverified claims in red).

**Gates engine** (src/gates). Detects project type from manifests (package.json, pyproject.toml, Cargo.toml, go.mod) and assembles the gate set: typecheck, lint, format, tests, secret scan, file-set check (declared-set membership per section 3.7), placeholder check, diff budget. Runs gates, captures raw output as evidence, drives the auto-resolve loop under the ratchet constraint, escalates on cap. Gate definitions are data (command, parser, blocking or advisory), so adding a gate never touches engine logic.

**Provider layer** (src/providers). Registry of frontier endpoints and local endpoints. Local discovery: probe localhost for Ollama and rapid-mlx default ports, list served models. Records model id, parameters, and prompt digest for every call. Prefer rapid-mlx on Apple Silicon (verified agent tool-calling, prompt cache, roughly 4x Ollama throughput on M-series); Ollama everywhere else. A fixture provider that replays canned response sequences ships in phase 1 as the deterministic test substrate for the loop, termination, and sandbox; phase 2's replay builds on it, so it is a first-class provider, not throwaway scaffolding.

**Model selection** (src/select). Stage one, static fit: probe RAM, VRAM, GPU, platform; map against a versioned shortlist JSON fetched from the project repo (curated coding models per hardware tier, so updates need no release). Stage two, calibration: the section 3.9 micro-eval, 5 to 10 minutes, optionally against the user's own repo. Stage three, online: bandit routing per section 3.8.

**TUI** (src/tui). One screen: plan pane, live action stream, gate status strip, evidence counter, attempt counter during auto-resolve. Every displayed status derives from ledger records, never from model text. Non-TTY fallback: plain line output, machine-readable with a flag.

**Config** (src/config). Zero-config default. One optional swarm.toml: provider keys and endpoints, gate overrides, budgets, model pins. Zod-validated with actionable error messages.

### 4.3 Data Flow

Happy path: user task in, planner emits plan (recorded), loop executes tool calls (each recorded with provenance), model claims completion, gates engine runs (outputs recorded), evidence DAG assembled linking claims to records, all claims resolve, bundle exported, TUI shows verified summary.

Failure paths: gate fails, raw output returns to the model, retry under ratchet, cap reached, escalate with bundle. Tool fails, error is evidence too, loop decides retry or replan. Provider fails, exponential backoff, then fallback model if configured, and the fallback is recorded because a model swap mid-task is exactly what a reviewer wants to know. Injection suspicion (derivation-heuristic match on a shell argument), block and require confirmation, confirmation recorded. Ledger write failure is fatal by design: no evidence, no execution.

## 5. Operational Considerations

- Performance: ledger appends are a few hundred bytes; blobs write once. Hashing is negligible next to model latency. TUI renders from an in-memory projection of the ledger, no re-reads.
- Security: workspace-jailed file access with the read-denylist, shell allowlist, heuristic-gated confirmations, known-pattern scrubbing at the chokepoint before any payload write.
- Privacy: scrubbing happens at write time, before anything reaches the ledger or blob store; export runs a second scan as defense in depth, because once the blob directory is shared or backed up, export-time alone is too late. Name the guarantee honestly everywhere: known-pattern scrubbing, not secrets removed.
- Maintenance: the versioned model shortlist JSON is the only component needing routine care; everything else changes on release cadence. Ledger format carries a schema version from day one.
- Cost: token counts per call recorded in the ledger, so per-task cost reporting falls out for free and feeds the bandit reward.
- Retention: content-addressed blobs plus verbose test output grow unbounded across sessions. Ship a retention and prune policy (age and size caps on the session store) from the start; cross-session dedupe is already free from content addressing.

### 5.1 Package Identity Collision (open decision, required before prompt 0)

swarm-orchestrator@12.1.1 is published with three bins (swarm, swarm-audit, swarm-orchestrator) and a GitHub Action at action.yml. v13 takes the swarm binary and means something entirely different by it; shipping v13 as a major bump of the same package silently breaks every consumer of the Action and the CLI. Three viable resolutions: (a) new package name, v12 frozen and archived; (b) same package, major break, swarm audit retained as a deprecated shim printing a migration notice; (c) new name for v13, v12 keeping the old one. The README, the Pages site, and the Action description all still describe the auditor and must move together with whichever choice is made. This is a human call; the builder must not pick.

## 6. Implementation Sequence

Each phase independently shippable, each with a decision gate. Rollback rule for every phase: the previous phase's test suite is the golden set and must stay green.

- **Phase 0, scaffold.** Repo, strict TS, Biome, Vitest, CI, CLAUDE.md, empty module boundaries. Gate: all gates run green on empty project.
- **Phase 1, an agent that codes.** Provider layer (frontier plus one local via OpenAI-compat, plus the fixture provider), tool layer with chokepoint stub, core loop, minimal TUI. Gate: loop, termination, and sandbox tests pass deterministically against the fixture provider in CI, and a real small task completes end to end in a scratch repo.
- **Phase 2, evidence.** Ledger, blobs, provenance tags, DAG, bundle export, embedded verifier, HTML review page, replay command. Gate: exported bundle verifies on a machine without v13 installed; a tampered record fails verification; a claim whose predicate is false against its genuine cited record, and a claim citing a record that does not exist, both render UNVERIFIED.
- **Phase 3, gates and auto-resolve.** Gates engine, numeric ratchet loop, slop detectors, diff budget, escalation. Gate: an injected failing test gets auto-resolved within cap, with the full attempt history in the bundle; an injected oscillation escalates instead of looping; a retry that holds the tests gate green by deleting the failing tests is rejected by the numeric ratchet.
- **Phase 4, hardware fit.** Probe, shortlist fetch, static recommendation with reasoning shown. Gate: sensible recommendations on at least three real hardware profiles.
- **Phase 5, calibration and routing.** Micro-eval harness, calibration bundle, reward logging, bandit activation threshold. Gate: calibration produces a distribution-aware report whose pick is justified by the measured dimensions; where calibration and static picks differ, the measurements explain the difference; where they agree, the agreement is reported as corroboration of the shortlist.
- **Phase 6, optional scale-out.** Parallel workers over git worktrees with a merge queue (workers propose, gates arbitrate merges sequentially), and bundle-format alignment with prEN 18229-1 / ISO 24970 once those standards finalize. Gate: two parallel tasks land without conflict corruption; deferred without guilt if single-agent serves.

## 7. Risks

- Judge-free verification limits: gates prove mechanical quality, not design quality. Mitigation: the bundle makes human design review fast; that's the honest division of labor, and the docs should say so plainly.
- Local model tool-calling variance across Ollama models. Mitigation: calibration measures tool-call validity per model rather than trusting model cards.
- Vercel AI SDK breaking changes ship on a fast cadence. Mitigation: the provider layer is the only module allowed to import it.
- Shortlist staleness. Mitigation: versioned remote JSON, plus calibration catches a stale pick empirically.
- Scope creep back toward swarm-first architecture. Mitigation: section 2 non-goals are load-bearing; CLAUDE.md enforces them on the building agent itself.
