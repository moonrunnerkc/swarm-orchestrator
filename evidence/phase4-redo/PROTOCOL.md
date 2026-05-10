# Phase 4 redo pre-registered protocol

This document is committed **before** any Phase 4 redo run is executed.
It locks the obligation set, fixture, cost cap, statistical method, and
decision rules so that the result cannot be massaged by post-hoc
protocol changes. Any change to this file after the pre-registration
commit invalidates the run and requires a full restart of the
measurement.

## Why a redo

The original Phase 4 run (`evidence/phase4/`) reused the Phase 3
obligation set (10 `import-graph-must-satisfy` + 10
`function-must-have-signature`). That obligation surface targets
Copilot's specialties; ClaudeCode's strategy is adversarial test
input generation against `property-must-hold` (mirroring Codex's
strategy per `docs/adapter-integration.md` Phase 4). ClaudeCode
showing zero unique yield on a set its strategy does not target is
uninterpretable for the cross-family-diversity question. Concern C1
in DECISIONS.md `### 2026-05-09 — Audit and corrections` documents
this; the original Phase 4 close-out is status-banner INVALIDATED
above; this redo replaces it.

## What Phase 4 redo measures

The Phase 4 question, verbatim from `docs/adapter-integration.md`:

> If it finds nothing the producer's persona race didn't already find,
> that's evidence cross-family diversity is doing the actual work; if
> it finds plenty, the diversity story is weaker than assumed and the
> architecture should be reconsidered.

Phase 4 (and the redo) is **not a ship/no-ship gate**. ClaudeCode
ships regardless of yield, behind its own per-adapter flag
(`includeClaudeCode: true`, default off). The Phase 4 redo measures
a downstream gate input: whether ClaudeCode adds yield over Codex on
the obligation surface ClaudeCode actually targets — i.e. the
like-for-like cross-family test the original run could not run.

## Locked artefacts

- **Obligation set:** `evidence/phase4-redo/obligations.json` — N=20,
  20 × `property-must-hold`, stratified A=8 / B=7 / C=5 (token-content
  / filesystem-shape / compound, mirroring Phase 1 + Phase 2 stratum
  semantics). Disjoint from the Phase 1, Phase 2, and Phase 3 sets by
  predicate, target token, and target file shape.
  Pre-apply contamination guard:
  `test/falsification/phase4-redo-gate-fixture.test.ts`. Locked at
  the SHA cited in the audit-and-corrections DECISIONS.md entry.
- **Fixture:** `evidence/fixtures/phase-1-gate/`. Reused unchanged
  from Phase 1 (also reused by Phase 2). Same fixture supports the
  grep/find-based predicates Phases 1 / 2 / 4-redo all use.
- **Fixture content hash:** recorded in each run's `environment.json`
  so a swapped fixture during `--resume` is detected.
- **Harness:** `scripts/phase4-redo/run-harness.ts` (compiled to
  `dist/scripts/phase4-redo/run-harness.js`).
- **Analysis script:** `scripts/phase4-redo/analyze.py` — passes the
  synthetic-paired-data self-test (`--self-test`).
- **Adapter (NEW):** `ClaudeCodeFalsifier` is extended in this commit
  to handle `property-must-hold`. The property-must-hold path
  *re-uses Codex's prompt body* (`buildCodexPrompt`), Codex's strict
  JSON candidate parser (`parseCodexCandidates`), and Codex's
  predicate runner (`runCandidateAgainstPredicate` +
  `checkPredicateBaseline`). Same task body, different model family —
  exactly the cross-family comparison shape the plan calls for.
  Sandbox flags unchanged from Phase 4 (`-p --output-format json
  --max-budget-usd 1.00 --add-dir <workspace>
  --no-session-persistence --exclude-dynamic-system-prompt-sections`;
  no `--dangerously-skip-permissions`).

## What we measure

Per-obligation, paired across the two configurations on the same
obligation set, on the four pre-registered metrics:

1. **Pass rate** — system returns no falsification (no adapter
   reported a counter-example). Binary, paired.
2. **Token-estimate cost** (`dollarsTokenEstimate`) and **API-equivalent
   cost** (`dollarsApiEquivalent`) summed across adapters that ran.
   The audit-and-corrections fix to Concern C3 splits the historical
   single column into two: `dollarsBilled` (real charge) and
   `dollarsApiEquivalent` (like-for-like API rate-card cost). Both are
   reported alongside `dollarsTokenEstimate`.
3. **Wall-clock latency** — milliseconds, end-to-end across all
   adapters that ran for the obligation.
4. **LLM call count** — number of adapter invocations that actually
   spawned the underlying CLI (baseline-skipped calls do not count).

`Config B' — producer + Codex (Copilot declines on
property-must-hold).` Per the production configuration, Copilot is
shipping and will be offered every obligation, but its `handles` list
does not include `property-must-hold` so its `falsify` returns
`strategy-not-applicable` without spawning. The harness omits Copilot
from registration to keep the cost record clean (mirroring the
original Phase 4 harness's pattern of skipping
strategy-not-applicable adapters).

`Config B'' — producer + Codex + ClaudeCode.` Same as B' plus
ClaudeCode. ClaudeCode now handles `property-must-hold` (this commit's
adapter extension); it dispatches sequentially after Codex.

## Cost cap

- **Per-obligation cost cap:** `$0.65` per obligation (mirrors Phase
  2's per-obligation cap; Phase 2's mean per-obligation Codex spend
  was ~$0.16, so $0.65 gives ~4× headroom).
- **Per-Part-C total ceiling:** **$20** — the audit-and-corrections
  brief's hard cap. The harness halts before invoking the next
  obligation when running spend (max of `dollarsApiEquivalent` and
  `dollarsBilled` across adapters) reaches `$20`. The remaining work
  is documented and Part D continues without the run completing.
- **Cost-cap hits (per obligation) are logged, not retried.** A
  `costCapHit: true` flag in `cost.json` marks the obligation as
  completed-with-cap-hit; the count appears in `summary.md` and is
  reported alongside total spend.

Total estimated spend at the locked caps:

- Config B': 20 × $0.16 ≈ **$3.20** (Codex API-billed; Phase 2
  baseline rate).
- Config B'': 20 × $0.16 (Codex) + 20 × $0.10 (ClaudeCode) ≈
  **$5.20**.
- Combined upper bound: **~$8.40** real billed; well inside the $20
  ceiling. ClaudeCode runs under whichever auth tier the operator's
  environment provides at run time (subscription if no
  `ANTHROPIC_API_KEY`; per-token if set).

## Statistical method

Pre-registered in `scripts/phase4-redo/analyze.py` (mirrors the Phase
4 analyzer with comparison axis B' vs B'' and the new
`dollarsApiEquivalent` column).

- **Pass rate (paired binary):** McNemar's test, exact-binomial
  fallback when discordant arms are zero or `b+c < 25`.
- **Token-estimate cost, wall-clock, LLM call count:** Wilcoxon
  signed-rank on per-obligation `B'' − B'` differences, two-sided,
  `zero_method='wilcox'`, no continuity correction.
- **Bonferroni correction across the four comparisons.** Family-wise
  alpha 0.05 → per-comparison alpha 0.0125.
- **95% confidence intervals on every reported number.**
  - Pass rate per arm: Wilson score CI.
  - Pass-rate difference (`B'' − B'`): Newcombe Method 10 CI.
  - Median continuous diff: bootstrap percentile CI, `n=10000`,
    `seed=42`.

## Decision rule (verbatim from `docs/adapter-integration.md` Phase 4)

> Decision gate: not a ship/no-ship gate. Measurement input for Phase
> 5 sizing and for the question "is cross-family diversity
> load-bearing?" Ship the adapter regardless of yield because both
> outcomes are signal: low yield validates the cross-family thesis,
> high yield invalidates it and forces a rethink.

## Operationalization

- **ClaudeCode marginal yield** (machine-claimed): count of
  obligations where B' passed (Codex did not falsify) AND B'' did
  not pass (a B''-only adapter — necessarily ClaudeCode — falsified
  the obligation).
- **Marginal yield per dollar — both bases:**
  - billed-basis: `unique_yield / (Σ B'' dollarsBilled − Σ B' dollarsBilled)`
  - API-equivalent-basis: `unique_yield / (Σ B'' dollarsApiEquivalent − Σ B' dollarsApiEquivalent)`

  Both are reported per the Concern C3 fix; the API-equivalent basis
  is the like-for-like surface for cross-adapter comparison.

- **Diversity-thesis verdict (machine-claimed; operator-confirmed
  pending operator inspection):**
  - Marginal yield = 0 → "confirmed" (cross-family diversity is
    doing the work; same-family adapter is redundant).
  - Marginal yield > 0 → "weakened" (same-family adapter caught
    things cross-family did not; investigate).

- **Phase 5 gate (per the operator brief):**
  - Marginal yield = 0 → Phase 5 skipped per the brief ("If
    ClaudeCode yield is zero or negative, skip Phase 5"). The
    audit-and-corrections DECISIONS.md entry's third-adapter-revisit
    condition does **not** fire.
  - Marginal yield > 0 → Phase 5 (bandit dispatcher) is eligible;
    the third-adapter-revisit condition fires and the Phase 5 skip
    is re-opened.

## Operator inspection scope (Part E STOP)

After this run completes, operator inspection of
`evidence/phase4-redo/run/config-bpp/inspection.md` is required for
the **ClaudeCode-unique catches** (the small set that matters for the
cross-family question). The skeleton is generated by the analysis
script's helper at the end of the run (per Concern C2 fix); operator
verdicts are filled in by hand.

## Reproducibility

The harness re-runs with deterministic inputs:

- Workspace = fresh copy of `evidence/fixtures/phase-1-gate/`.
- Obligations = locked in `evidence/phase4-redo/obligations.json`.
- Codex prompt + sandbox flags = unchanged from Phase 1
  (`src/falsification/adapters/codex/codex-prompt.ts`,
  `codex-falsifier.ts`).
- ClaudeCode prompt + sandbox flags for property-must-hold path =
  Codex prompt re-used verbatim; sandbox flags unchanged from Phase 4
  (`src/falsification/adapters/claude-code/claude-code-falsifier.ts`).
- Stats = `scripts/phase4-redo/analyze.py`, deterministic except for
  bootstrap (seed=42, fixed).

The Codex and Claude CLIs are non-deterministic (the models sample);
per-run spend and yield will vary between executions.

## Restart conditions

Any of the following invalidates the Phase 4 redo run and requires a
fresh restart with a new pre-registration commit:

- Modifying `evidence/phase4-redo/obligations.json` after the
  pre-registration commit.
- Modifying `evidence/fixtures/phase-1-gate/` while a Phase 4 redo
  run is in progress (caught by `fixtureContentHash` mismatch on
  `--resume`).
- Modifying `scripts/phase4-redo/run-harness.ts` or
  `scripts/phase4-redo/analyze.py` after this commit and before the
  run completes.
- Modifying the ClaudeCode `property-must-hold` strategy
  (the new branch in `falsify()`), the Codex prompt body re-used by
  ClaudeCode, or the cost-rate constants after this commit.
- Changing the cost cap, total-spend ceiling, statistical method, or
  decision rule after this commit.

Hot-fixes to harness bugs that would otherwise prevent any obligation
from running are allowed; the audit-and-corrections DECISIONS.md
entry must cite the bug, the fix's commit SHA, and the rationale that
the fix does not change the measurement.
