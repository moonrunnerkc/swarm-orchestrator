# Phase 3 pre-registered protocol

This document is committed **before** any Phase 3 run is executed. It
locks the obligation set, fixture, cost cap, statistical method, and
decision rules so that the Phase 3 result cannot be massaged by
post-hoc protocol changes. Any change to this file after the
pre-registration commit invalidates the run and requires a full restart
of the Phase 3 measurement.

The plan that frames Phase 3 is `docs/adapter-integration.md` Phase 3.
This document operationalizes that plan against the v8.0.1 codebase as
it exists on `feat/adapter-reintegration-v8` after the Phase 2 close-out.

## What Phase 3 measures

The Phase 3 question, verbatim from `docs/adapter-integration.md`:
"Tests whether vendor diversity catches obligation types Codex doesn't,
measured as marginal yield on top of an already-shipping Codex-only
configuration."

Codex (Phase 1/2) targets `property-must-hold`. Phase 3's Copilot
adapter targets the disjoint pair `import-graph-must-satisfy` and
`function-must-have-signature`. By construction, every Copilot
falsification on a Phase 3 obligation is unique to Copilot — Codex
contributes zero yield because it does not handle the obligation type.
Phase 3's "marginal yield" therefore reduces to "Copilot's total yield";
"additional spend" reduces to "Copilot's total spend." The decision
metric is yield-per-dollar.

## Locked artefacts

- **Obligation set:** `evidence/phase3/obligations.json` — N=20
  obligations, 10 `import-graph-must-satisfy` (5 `no-upward-imports` +
  5 `no-cycles`) + 10 `function-must-have-signature`. Disjoint from the
  Phase 1 and Phase 2 sets by obligation type. Locked at the SHA cited
  in the DECISIONS.md pre-registration entry.
- **Fixture:** `evidence/fixtures/phase-3/` — purpose-built tree with
  named TS functions and cycle-free import scopes. Built fresh for
  Phase 3 because the Phase 1/2 fixture lacked the AST-backed surface
  the Phase 3 obligation types require. Contamination-free against all
  20 Phase 3 obligations is enforced by
  `test/falsification/phase3-gate-fixture.test.ts`.
- **Fixture content hash:** recorded in each run's `environment.json` so
  a swapped fixture during `--resume` is detected.
- **Harness:** `scripts/phase3/run-harness.ts` (compiled to
  `dist/scripts/phase3/run-harness.js`).
- **Analysis script:** `scripts/phase3/analyze.py` — passes the
  synthetic-paired-data self-test (`--self-test`).
- **Adapter:** `src/falsification/adapters/copilot/copilot-falsifier.ts`,
  built with the default per-tool permission set
  (`--allow-tool view`, `--allow-all-paths`, no `--allow-all-tools`),
  spawning the real `copilot` CLI via `-p <prompt>` in non-interactive
  mode.

## What we measure

Per-obligation, paired across the two configurations on the same locked
obligation set, on the four pre-registered metrics:

1. **Pass rate** — system returns no falsification (binary, paired).
2. **Billed cost** — USD `dollarsBilled` from the cost record. For
   subscription-only adapters (Copilot) this is 0; the comparison
   primary surface is `dollarsTokenEstimate`.
3. **Wall-clock latency** — milliseconds, end-to-end.
4. **LLM call count** — number of underlying LLM-spawning calls.

Both configs receive the same `FalsificationInput` shape (patch SHA,
obligation, fresh fixture-rooted workspace, `timeBudgetMs`).

`Config B — producer + Codex (Phase 2's shipped configuration).`
Codex's strategy targets `property-must-hold` only and is not registered
against the Phase 3 obligation types. The harness runs the AST-backed
verifier against the bare fixture; Codex never spawns. Pass = the
obligation is satisfied by construction. Cost = $0; LLM calls = 0.

`Config B' — producer + Codex + Copilot.`
Same as B except the Copilot falsifier is registered. For every Phase 3
obligation the dispatcher routes to Copilot (Codex declines on
strategy-not-applicable). Pass = predicate satisfied AND Copilot
returns no `counter-example-input`.

The post-merge integration check is **not** invoked inside the harness;
same rationale as Phase 2 (DECISIONS.md 2026-05-09 — 48-hour question:
skip for Phase 2). The `postMergeVerify` re-run would duplicate the
per-obligation verifier evaluation and add no signal.

## Cost cap

- **Config B:** `$0.01` per obligation, hard. B has no LLM calls so
  this is a sanity-check cap.
- **Config B':** `$0.65` per obligation, hard. Mirrors Phase 2's
  per-obligation cap. Worst-case Phase 3 spend: `20 × $0.65 = $13.00`,
  inside the operator's `$20` Phase 3 ceiling.
- **Cost-cap hits are logged, not retried.** When `cost.json` records
  `costCapHit: true` for an obligation, that obligation is treated as
  completed for the run; the count appears in `summary.md` and is
  reported alongside total spend.

Total estimated spend at the locked cap:

- Config B: `20 × $0.01 = $0.20` worst case (expected: `$0`).
- Config B': `20 × $0.65 = $13.00` worst case (expected: `~$2`,
  scaling Phase 1's per-obligation mean for Codex into Copilot's
  per-request rate).
- Combined upper bound: `$13.20`, inside the $20 Phase 3 ceiling.

## Statistical method

Pre-registered in `scripts/phase3/analyze.py` (mirrors Phase 2's
analyzer with the comparison axis flipped to B vs B').

- **Pass rate (paired binary):** McNemar's test on the 2×2 paired
  table, with exact-binomial fallback when either discordant arm is
  zero or the discordant total is below 25.
- **Billed cost, wall-clock, LLM call count (paired continuous):**
  Wilcoxon signed-rank test on per-obligation `B' − B` differences,
  two-sided, `zero_method='wilcox'`, no continuity correction.
- **Bonferroni correction across the four comparisons.** Family-wise
  alpha 0.05 → per-comparison alpha 0.0125.
- **95% confidence intervals on every reported number.**
  - Pass rate per arm: Wilson score CI on a binomial proportion.
  - Pass-rate difference (`B' − B`): Newcombe Method 10
    paired-difference CI.
  - Median continuous diff (cost / wall-clock / LLM calls):
    bootstrap percentile CI, `n=10000`, `seed=42`.

## Decision rule (verbatim from `docs/adapter-integration.md` Phase 3)

> Decision gate: marginal yield per dollar from adding Copilot. Compute
> as additional unique falsifications found by Copilot divided by
> additional dollars spent. If marginal yield is below the Codex
> baseline yield from Phase 2, Copilot is redundant for the current
> obligation mix and the plan freezes here. Ship B (Codex-only) as
> default; Copilot stays available behind a per-adapter flag for
> testing.

## Operationalization

- **Codex Phase 2 baseline yield-per-dollar (locked):**
  `26 confirmed yields / $4.3994 token-estimate ≈ 5.91 yields/$.`
  Source: `evidence/phase2/analysis.md`. The denominator uses
  `dollarsTokenEstimate` (which equals `dollarsBilled` under Codex's
  API auth) because Copilot is subscription-only and the apples-to-
  apples comparison surface is the rate-card-derived token estimate,
  not the subscription-flat `dollarsBilled = 0`.

- **Copilot marginal yield-per-dollar:**
  `(Copilot unique yield) / (Σ B' tokenEstimate − Σ B tokenEstimate)`.
  By construction Codex does not handle the Phase 3 obligation types,
  so unique yield = total yield and additional dollars = total Copilot
  spend.

- **P3.5.a (ship B') triggers iff** Copilot yield/$ ≥ 5.91.
- **P3.5.b (freeze) triggers otherwise.** Copilot stays available
  behind the `includeCopilot: true` opt-in path on
  `defaultAdapterRegistry`.

## Reproducibility

The harness re-runs with deterministic inputs:

- Workspace = fresh copy of `evidence/fixtures/phase-3/`.
- Obligations = locked in `evidence/phase3/obligations.json`.
- Copilot prompt + sandbox flags = unchanged from this commit
  (`src/falsification/adapters/copilot/copilot-prompt.ts`,
  `copilot-falsifier.ts`).
- Stats = `scripts/phase3/analyze.py`, deterministic except for
  bootstrap (seed=42, fixed).

The Copilot CLI itself is non-deterministic (the model samples).
Per-run spend and yield will vary between executions. Phase 3's
decision uses a single execution per config; if the operator wants
robustness to sampling variance, run B' twice and report both — but
that requires its own DECISIONS.md entry tightening the protocol
*before* the second run, not after.

## Restart conditions

Any of the following invalidates the Phase 3 run and requires a fresh
restart with a new pre-registration commit:

- Modifying `evidence/phase3/obligations.json` after the pre-registration
  commit.
- Modifying `evidence/fixtures/phase-3/` while a Phase 3 run is in
  progress (caught by `fixtureContentHash` mismatch on `--resume`).
- Modifying `scripts/phase3/run-harness.ts` or
  `scripts/phase3/analyze.py` after this commit and before the run
  completes.
- Modifying the Copilot prompt, the per-tool permission default, or
  the cost-rate constants after this commit.
- Changing the cost cap, statistical method, or decision rule after
  this commit.

Hot-fixes to harness bugs that would otherwise prevent any obligation
from running may be made; the DECISIONS.md entry must cite the bug, the
fix's commit SHA, and the rationale that the fix does not change the
measurement (e.g., a missing-import fix vs a result-affecting metric
change).
