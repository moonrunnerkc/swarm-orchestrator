# Adapter Reintegration Implementation Plan

> **FINAL STATUS — closed out 2026-05-09.** The plan below is now
> historical record. The authoritative source for the post-close-out
> architecture is the 2026-05-09 "Adapter integration close-out" entry
> in [`DECISIONS.md`](../DECISIONS.md), mirrored in
> [`docs/falsification-adapters.md`](falsification-adapters.md).
>
> **Per-phase verdicts:**
>
> | Phase | Final outcome |
> |---|---|
> | Phase 0 | Closed (contract + scaffolding shipped). |
> | Phase 1 | Passed dev gate (`evidence/phase1-dev-gate/run-1`). |
> | Phase 2 | C2.1 ship-B: Codex Pareto-dominates on N=28 analyzable. |
> | Phase 3 | Ship-B' (Copilot default-on). Heuristic-confirmed bounds 50–60 catches; all four API-equivalent yield/$ ratios above the Codex baseline. The original 6.5× headline was dropped during the audit-and-corrections sweep in favour of a four-ratio table. |
> | Phase 4 (original) | **INVALIDATED** by obligation-set-mismatch — see `evidence/phase4/analysis.md` status banner. |
> | Phase 4 redo | Cross-family-diversity thesis **not contradicted** on `property-must-hold` (B' caught 18/19 analyzable, ClaudeCode 0 unique). N=1 residual is too small for strong confirmation; ClaudeCode ships behind a per-adapter flag default-off regardless of yield. See the 2026-05-09 "Adapter integration close-out: post-review corrections" entry in `DECISIONS.md`. |
> | Phase 5 | Skipped on operational grounds (two adapters with disjoint obligation types — bandit has nothing to arbitrate). |
> | Phase 6 | Deferred (Phase 2's predicate set lacked high-stakes obligations; gate had no input). |
>
> **Production architecture:** producer + Codex (default on) + Copilot
> (default on); ClaudeCode behind a per-adapter flag (default off); no
> bandit dispatcher. Methodology-fix invariants in place (pre-apply
> baseline check, fixture isolation, dual-column cost reporting:
> `dollarsBilled` + `dollarsApiEquivalent`).
>
> **Branch:** `feat/adapter-reintegration-v8` — does **not** merge to
> `main` from the close-out session; merge timing is the operator's
> separate decision.
>
> Cite: 2026-05-09 "Adapter integration close-out" entry in
> [`DECISIONS.md`](../DECISIONS.md) (and the dated per-phase entries
> immediately above it).

## Implementation status (historical, pre-close-out)

| Phase | Status | Notes |
|---|---|---|
| Phase 0 | shipped on `feat/adapter-reintegration-v8` | Contract, registry, cost schema, failing conformance test that drove Phase 1. See [`docs/falsification-adapters.md`](falsification-adapters.md) and the Adapter Decisions section of [`DECISIONS.md`](../DECISIONS.md). |
| Phase 1 | shipped on `feat/adapter-reintegration-v8`; dev gate gated on a local Codex install | `CodexFalsifier` lands as the Phase 1 adapter. `--falsifiers <on\|off>` flag is parsed by `swarm v8 run` (default `on`). The integration test against the real Codex CLI is gated on `SWARM_E2E_CODEX=1`. The dev gate result is recorded in [`DECISIONS.md`](../DECISIONS.md) once it has been run on 20 obligations. |
| Phase 2 | not started | Empirical comparison N=30. Blocked on the still-open question in [`DECISIONS.md`](../DECISIONS.md) about whether the 48-hour post-merge regression check is necessary. |
| Phase 3+ | not started | Conditional on Phase 2 outcomes. |

The plan below is the authoritative spec for what each phase must
deliver and what its decision gates are. Status above is the only piece
that updates as work lands.

## Context

Swarm Orchestrator v8.0.1 ships a contract-first single-vendor architecture: one cached Anthropic session as the producer, AST-backed verifiers, hash-chained evidence ledger. This plan adds CLI adapters back into the system as falsifiers, not as alternative producers. The producer side is untouched.

The thesis being tested: cross-family model diversity catches failures that single-vendor persona racing plus the existing falsification battery do not. The plan measures that thesis with one adapter before committing to building more, then adds adapters as ablation arms only if the first one earns it. No phase is built until the previous one has shown evidence it earns the next.

## What's Explicitly Out of Scope

To avoid overengineering, the following are deferred until empirical phases validate the basic architecture:

- Plugin SDK for third-party falsifiers
- Multiple falsification strategies per adapter (one strategy per adapter to start)
- Stigmergic evidence board, pheromone propagation, neighbor signaling
- Cross-run posterior persistence for the bandit (in-memory state only)
- Adapter trust boundaries, signature verification, plugin signing
- Dashboard or UI surface
- Auto-installation of adapter CLIs

If any of these become necessary mid-implementation, that's a signal to stop and revisit the plan, not to ship them inline.

## Phase 0: Contract and Scaffolding (1 to 2 days)

Smallest unit of reusable structure the rest of the plan depends on.

Deliverables:
- `FalsifierAdapter` interface in `src/falsification/adapters/types.ts`. Inputs: patch SHA, obligation, contextRefs, time budget. Output: typed `FalsificationResult` (counter-example input, regression fixture, property violation trace, or `no-falsification-found`).
- `AdapterRegistry` map keyed by adapter name. Single-process, no DI framework.
- New section in existing `DECISIONS.md` for recording adapter choices and outcomes. No new top-level decisions file.
- Cost instrumentation path resolved here, not deferred: extend `cost-attribution.json` with per-adapter dollar totals. One file, one schema, picked before Phase 1 starts so Phase 1 lands clean.
- One failing integration test that asserts an adapter contract is followed. Drives Phase 1.

Decision gate: contract reviewable in under 30 minutes by someone unfamiliar with v8. If it isn't, the contract is too complex.

Rollback: revert the directory and type file. Zero blast radius.

## Phase 1: Codex CLI Adapter (3 to 5 days)

Codex first because it's the most architecturally distinct from Sonnet: different model family, OS-enforced sandbox via seatbelt or sandbox-exec, network-disabled by default. One adapter, one strategy, one measurable signal before any other adapter is built.

Deliverables:
- `CodexFalsifier` adapter that spawns `codex` as a subprocess in `workspace-write` sandbox mode with approval policy `never`.
- One strategy: adversarial test input generation targeting `property-must-hold` obligations. The adapter receives the obligation plus patched files and asks Codex to write three failing inputs and run them.
- Falsification yield instrumentation: per-run counter of counter-examples found, false positives, time spent, dollars spent (written to `cost-attribution.json` per Phase 0 decision).
- Sequential dispatch only. No scheduling, no bandit.

Dev gate: on a sample of 20 obligations the existing battery passes, does Codex surface at least one real failure? "Real" means reproducible on hand inspection, not a false positive. If yield is zero across 20 obligations after one strategy iteration, the cross-vendor falsification thesis is in trouble. Iterate the strategy once. If still zero, stop here. Do not build Phase 2's measurement infrastructure or any further adapter. Document the negative result and revert.

Rollback: feature flag `--falsifiers off`. Adapter code stays in tree but isn't dispatched.

## Phase 2: Empirical Gate v1, Codex-Only vs Baseline (3 to 5 days)

The actual go/no-go for whether any of this work earns its slot. Run after Phase 1's dev gate passes and before any second adapter is built.

Configurations on the same stratified obligation set, N=30 minimum:
- A: producer-only, current v8.0.1
- B: producer plus Codex falsifier in sequence

Metrics:
- Obligation pass rate
- Post-merge defect rate (48-hour regression follow-up; see open questions for whether this is necessary)
- Total cost (producer tokens + Codex dollars)
- Wall-clock latency

Statistical method: paired Wilcoxon signed-rank test, Bonferroni correction for the pairwise comparisons. N=30 is the floor for the test to be meaningful, not a target.

Decision rules:
- B Pareto-dominates A on quality without unacceptable cost increase: ship B as default behind a flag, proceed to Phase 3 to test ablation arms.
- B beats A only on a specific obligation slice: ship B gated to that slice, proceed to Phase 3 only if there's reason to believe additional adapters expand the slice.
- B does not beat A: revert adapter code or keep it disabled behind an `experimental` flag. Publish the negative result. Do not build Phases 3 through 6.

Rollback: flag-based. Adapter code stays in tree until next cleanup pass.

## Phase 3: Copilot CLI Adapter as Ablation Arm (CONDITIONAL, 3 to 5 days)

Only built if Phase 2 ships B. Tests whether vendor diversity catches obligation types Codex doesn't, measured as marginal yield on top of an already-shipping Codex-only configuration.

Deliverables:
- `CopilotFalsifier` adapter that spawns `copilot -p` inside a worktree-isolated session with explicit per-tool permissions, not blanket `--allow-all-tools` outside test fixtures.
- One strategy: import-graph perturbation and function-signature drift cases targeting `import-graph-must-satisfy` and `function-must-have-signature`.
- Re-run the Phase 2 measurement with B' = producer + Codex + Copilot. Compare B' against B (not against A). Smaller delta-stats run, not a full re-eval.

Decision gate: marginal yield per dollar from adding Copilot. Compute as additional unique falsifications found by Copilot divided by additional dollars spent. If marginal yield is below the Codex baseline yield from Phase 2, Copilot is redundant for the current obligation mix and the plan freezes here. Ship B (Codex-only) as default; Copilot stays available behind a per-adapter flag for testing.

Rollback: subflag to disable Copilot specifically while keeping Codex enabled.

## Phase 4: Claude Code Control Adapter as Ablation Arm (CONDITIONAL, 2 to 3 days)

Only built if Phase 3 ships B'. Same family as the producer, deliberately. If it finds nothing the producer's persona race didn't already find, that's evidence cross-family diversity is doing the actual work; if it finds plenty, the diversity story is weaker than assumed and the architecture should be reconsidered. Built last, not third, because its specific value is as ablation evidence after cross-vendor signal exists, not before.

Deliverables:
- `ClaudeCodeFalsifier` adapter wrapping `@anthropic-ai/claude-code`.
- Same strategy as the Codex adapter (adversarial test inputs).
- Same dispatch path.
- Delta measurement: B'' = producer + Codex + Copilot + Claude Code, compared against B'.

Decision gate: not a ship/no-ship gate. Measurement input for Phase 5 sizing and for the question "is cross-family diversity load-bearing?" Ship the adapter regardless of yield because both outcomes are signal: low yield validates the cross-family thesis, high yield invalidates it and forces a rethink.

Rollback: same flag pattern.

## Phase 5: Bandit Dispatch (CONDITIONAL, 3 to 5 days)

Only if Phases 3 and 4 collectively show that more than one adapter is earning its slot. Replaces fire-all-adapters with per-obligation-type strategy selection.

Deliverables:
- Thompson sampling over per-obligation-type posterior of falsification yield. Beta priors initialized uniform.
- Cold-start: first 20 runs use uniform random selection across enabled adapters.
- Adapter ejection rule: if an adapter's posterior collapses below a fixed threshold for three consecutive obligations of the same type, skip that adapter for that type with a recorded note.
- In-memory bandit state. Persisted only at session boundaries to a single JSON file. No database.

Decision gate: bandit-driven dispatch matches or beats fire-all on cost-per-falsification without regressing total falsification yield. If yield drops by more than 10%, the bandit is too aggressive and the threshold needs tuning.

Rollback: `--dispatch all|bandit` flag. Default to `all` if bandit underperforms.

## Phase 6: Cross-Vendor Producer Race (CONDITIONAL and Opt-In, 2 to 4 days)

Only if Phase 2 surfaces specific high-stakes obligations where falsification alone is insufficient. This is the only phase that touches the producer architecture, which is why it's last and opt-in. Note: this phase is gated on Phase 2's findings, not on later phases, so it can be revisited even if Phases 3 through 5 conclude with a Codex-only configuration.

Deliverables:
- `--high-stakes-producer-race` flag, off by default.
- Hard budget cap per run, set explicitly, no defaulting.
- Race fires only on obligations tagged with: security-relevant, performance-must-not-regress on declared hot path, or irreversible side effect.
- Loser candidates written to the evidence ledger and discarded.

Decision gate: cost overrun rate. If the budget cap is hit on more than 20% of high-stakes runs, either the cap is wrong or the race is firing on too many obligations.

Rollback: flag off. Default is single-vendor producer.

## Risk Register

**Adapter auth fragility.** One unauthenticated CLI of three should not break a run. The dispatcher catches missing-credential errors per adapter, logs a warning, continues with the remainder. Validated by a CI test simulating a missing API key.

**Hidden vendor cost.** Codex and Copilot burn premium requests at different rates. Instrumented from Phase 1 via `cost-attribution.json`, fail loud if a single run exceeds 2x its estimate.

**Strategy poisoning.** Not a Phase 1 through 4 risk since each adapter has one strategy. Becomes relevant if Phase 5's bandit gives an adapter undue early weight from noisy signals. Mitigation already built in: ejection threshold and uniform cold-start.

**Falsifier as attack vector.** Codex seatbelt and Copilot path-permission are usable, do not bypass them. No `--yolo`, no `--allow-all-tools` defaults outside explicit test fixtures. Document the policy in `DECISIONS.md`.

**Empirical null result.** The plan must be acceptable to ship even if Phase 2 says no. The negative result is publishable: tested cross-vendor falsification on a contract-first orchestrator, found single-vendor plus AST verification sufficient. That's a defensible outcome, not a failure. Phase 2 stopping here costs roughly 7 to 12 days, not the full 17 to 29 day budget.

**Adapter version drift.** Vendor CLIs ship breaking changes. Pin specific CLI versions in CI, run a weekly canary against unpinned versions, alert on breakage. Codex implementation: `.github/workflows/codex-canary.yml` runs the env-gated `codex-falsifier.integration.test.ts` against the unpinned `@openai/codex` weekly (Monday 09:00 UTC) and on `workflow_dispatch`. On schedule failure the workflow opens a labelled issue (`adapter-drift`, `codex`) so a maintainer can update the adapter before the next dev-gate run.

## Open Questions to Resolve Before Starting

- Which obligation type does each adapter target first? Phase 1 defaults Codex to `property-must-hold`. If that's wrong for the current mix, swap before Phase 1 begins.
- Is the 48-hour post-merge regression check necessary for Phase 2, or does the existing battery suffice? Decide before Phase 2 starts, not during.

(Cost instrumentation path is no longer an open question. Resolved in Phase 0: extend `cost-attribution.json`.)

## Effort Summary

Rough total if every phase ships: 17 to 29 working days. Estimates are coarse, not commitments.

Stop conditions and their costs:
- Phase 1 dev gate fails (Codex finds nothing across 20 obligations after one strategy iteration): 4 to 7 days, documented negative result.
- Phase 2 empirical gate fails (Codex-only does not Pareto-dominate baseline on N=30): 7 to 12 days, publishable negative result on the cross-vendor falsification thesis.
- Phase 3 ablation fails (Copilot adds no marginal yield over Codex-only): 10 to 17 days, ship Codex-only as the production configuration.

Phase 2 is the gate that decides whether Phases 3 through 6 happen at all. Phases 3 and 4 are the gates that decide whether Phase 5 (bandit) is worth building. Phase 6 is independently gated on Phase 2's findings about high-stakes obligations.