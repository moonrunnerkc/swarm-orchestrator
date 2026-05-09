# Phase 2 pre-registered protocol

This document is committed **before** any Phase 2 run is executed. It
locks the obligation set, fixture, cost cap, statistical method, and
decision rules so that the Phase 2 result cannot be massaged by
post-hoc protocol changes. Any change to this file after the
pre-registration commit invalidates the run and requires a full
restart of the Phase 2 measurement.

The plan that frames Phase 2 is `docs/adapter-integration.md` Phase 2.
This document operationalizes that plan against the v8.0.1 codebase as
it exists on `feat/adapter-reintegration-v8`.

## Locked artefacts

- **Obligation set:** `evidence/phase2/obligations.json` — 30
  property-must-hold obligations, stratified 12 / 11 / 7 across the
  same A / B / C strata used in Phase 1, disjoint from the 20 obligations
  in `evidence/phase1-dev-gate/sample-obligations.json` (no predicate or
  target reused). Locked at the SHA cited in the DECISIONS.md
  pre-registration entry.
- **Fixture:** `evidence/fixtures/phase-1-gate/` — reused unmodified
  from Phase 1. Decision recorded in DECISIONS.md: the new obligations
  do not require shapes the Phase 1 fixture cannot express, so a
  separate Phase 2 fixture would only duplicate the Phase 1 tree.
  Contamination-free for all 30 Phase 2 predicates is enforced by
  `test/falsification/phase2-gate-fixture.test.ts`.
- **Fixture content hash (sha256, computed via the same walker the
  harness uses):**
  `b7f129e7335e96e1a1166828eac6696f24bd140f7378d1fa86199a621feacd25`
  Recorded inside each run's `environment.json` so a swapped fixture
  during `--resume` is detected.
- **Harness:** `scripts/phase2/run-harness.ts`
  (compiled to `dist/scripts/phase2/run-harness.js`).
- **Analysis script:** `scripts/phase2/analyze.py` —
  passes the synthetic-paired-data self-test (`--self-test`).

## What we measure

Per-obligation, paired across the two configurations on the same locked
obligation set, on the four pre-registered metrics:

1. **Pass rate** — system returns no falsification (binary, paired).
2. **Billed cost** — USD `dollarsBilled` from the cost record (real charge).
3. **Wall-clock latency** — milliseconds, end-to-end.
4. **LLM call count** — number of underlying LLM-spawning calls.

Both configs receive the same `FalsificationInput` shape (patch SHA,
obligation, fresh fixture-rooted workspace, `timeBudgetMs`).

`Config A — producer-only (current v8.0.1).`
The "producer" path for property-must-hold at v8.0.1 evaluates the
predicate against the workspace at the patch SHA. The harness runs the
same shell predicate the property-gate layer of the battery runs and
records the exit code. No Codex spawn. Pass = predicate exits 0. Cost
is by construction $0; LLM calls = 0.

`Config B — producer + Codex falsifier in sequence.`
Same predicate evaluation as A, then `CodexFalsifier.falsify(...)` runs
sequentially with a wall-clock budget of `timeBudgetMs`. Codex's
internal baseline check + adversarial-input strategy is unchanged from
Phase 1; the harness captures every counter-example, false positive,
and the billed/token-estimate cost. Pass = predicate exits 0 AND Codex
returns no `counter-example-input`.

The post-merge integration check (`postMergeVerify`) is **not** invoked
inside the harness. The 48-hour question's resolution (DECISIONS.md
2026-05-09) operationalizes "post-merge defect rate" via that check at
end-of-run; for the Phase 2 paired comparison that runs against a
single fixture per obligation, end-of-run post-merge re-runs would
duplicate the per-obligation predicate evaluation and add no signal.

## Cost cap

- **Config A:** `$0.01` per obligation, hard. A has no LLM calls so
  this is a sanity-check cap (a non-zero number in cost.json under
  Config A would indicate a harness defect).
- **Config B:** `$0.65` per obligation, hard. Phase 1's mean
  per-obligation cost was ~`$0.15` (`evidence/phase1-dev-gate/run-1/summary.md`
  total `$2.9989` ÷ 20 obligations); `$0.65` gives 4.3× headroom for
  adversarial outliers while keeping the worst-case Phase 2 spend
  within the operator-approved `$20` ceiling. (Originally proposed at
  `$1.00`; tightened after the operator approved `$20` worst case.
  See DECISIONS.md 2026-05-09 entry "Phase 2 cost cap tightened".)
- **Cost-cap hits are logged, not retried.** When `cost.json` records
  `costCapHit: true` for an obligation, that obligation is treated as
  completed for the run; the cost-cap-hit count appears in
  `summary.md` and is reported alongside total spend. Hitting the cap
  is a separate failure mode from a non-completion.

Total estimated spend at the locked cap:

- Config A: `30 × $0.01 = $0.30` worst case (expected: `$0`).
- Config B: `30 × $0.65 = $19.50` worst case (expected: `~$5` based
  on Phase 1's per-obligation mean).
- Combined upper bound: `$19.80`, within the operator-approved `$20`
  ceiling.

## Statistical method

Pre-registered in `scripts/phase2/analyze.py`.

- **Pass rate (paired binary):** McNemar's test on the 2×2 paired
  table, with exact-binomial fallback when either discordant arm is
  zero or the discordant total is below 25.
- **Billed cost, wall-clock, LLM call count (paired continuous):**
  Wilcoxon signed-rank test on per-obligation `B − A` differences,
  two-sided, `zero_method='wilcox'`, no continuity correction.
- **Bonferroni correction across the four comparisons.** Family-wise
  alpha 0.05 → per-comparison alpha 0.0125. The script reports both
  uncorrected and Bonferroni-corrected p-values; the decision uses the
  corrected value.
- **95% confidence intervals on every reported number.**
  - Pass rate per arm: Wilson score CI on a binomial proportion.
  - Pass-rate difference (`B − A`): Newcombe Method 10 paired-difference
    CI.
  - Median continuous diff (cost / wall-clock / LLM calls):
    bootstrap percentile CI, `n=10000`, `seed=42`.
- **Effect sizes.** Pass-rate difference is the discordance-driven
  effect; continuous metrics report the median paired difference and
  its bootstrap CI as the effect size.

## Decision rules (verbatim from `docs/adapter-integration.md`)

> - B Pareto-dominates A on quality without unacceptable cost increase:
>   ship B as default behind a flag, proceed to Phase 3 to test ablation arms.
> - B beats A only on a specific obligation slice: ship B gated to that
>   slice, proceed to Phase 3 only if there's reason to believe additional
>   adapters expand the slice.
> - B does not beat A: revert adapter code or keep it disabled behind an
>   `experimental` flag. Publish the negative result. Do not build
>   Phases 3 through 6.

## Operationalization of "Pareto-dominates A on quality without unacceptable cost increase"

For Phase 2 to take the C2.1 (ship B) branch, **all** of the following
must hold against the analysis output. Any one failure forces C2.2
(slice-gated) or C2.3 (do-not-ship), assessed in the order listed.

1. **Quality strictly better, or tied with operator-flagged real
   yield.** McNemar/exact-binomial on pass rate is significant after
   Bonferroni (corrected p < 0.05) **and** the discordance favours B
   (i.e., B catches more counter-examples than A misses) **and** the
   B-only counter-examples are operator-confirmed as real (not all
   adversarial inputs are interesting; we keep Phase 1's
   "predicate-gaming-without-real-violation" exclusion).
2. **No statistically significant regression on any other metric in
   B's disfavour.** "B has higher median cost / wall-clock / LLM calls
   than A" is by-design and does not count as a regression; the test
   is two-sided, but the decision treats only operationally-meaningful
   regressions (e.g., B has LOWER pass rate, or LOWER wall-clock-utility
   than A) as blockers.
3. **Cost increase is within the pre-registered ceiling.** The
   ceiling is operationalized as **median per-obligation billed-cost
   difference (B − A) ≤ $0.50** AND **total billed-cost difference
   across the 30 obligations ≤ $15.00**. Rationale: $0.50/obligation is
   ~3.3× Phase 1's per-obligation mean; raising the ceiling above that
   converts what is meant to be a falsifier into a discretionary
   spend, undermining the "earn its slot" frame of the plan. Total
   $15.00 caps the overall budget at roughly Phase 1's spend × 5.
4. **The operator confirms the proposed cost ceiling at the Part A
   STOP**, or supplies a different number with rationale that
   replaces (3) before Part B begins. If the operator overrides
   downward, the ceiling tightens; upward overrides require a
   DECISIONS.md entry citing the rationale.

C2.2 (slice) triggers if (1) holds for at least one stratum but not
overall, **and** (2) and (3) hold within that stratum. The slice is
defined by the stratum boundary in `obligations.json`; if a finer
slice (e.g., "A but not A* compound predicates") is needed, the
DECISIONS.md entry must justify the bisection rather than picking it
post-hoc.

C2.3 triggers if neither C2.1 nor C2.2 holds.

## Reproducibility

The harness re-runs with deterministic inputs:

- Workspace = fresh copy of `evidence/fixtures/phase-1-gate/`.
- Predicates = locked in `evidence/phase2/obligations.json`.
- Codex prompt + sandbox flags = unchanged from Phase 1
  (`src/falsification/adapters/codex/codex-prompt.ts`,
  `codex-falsifier.ts`).
- Stats = `scripts/phase2/analyze.py`, deterministic except for
  bootstrap (seed=42, fixed).

The Codex CLI itself is non-deterministic (the model samples). Per-run
spend and yield will vary between executions. Phase 2's decision uses
a single execution per config; if the operator wants robustness to
sampling variance, run config B twice and report both — but that
requires its own DECISIONS.md entry tightening the protocol *before*
the second run, not after.

## Restart conditions

Any of the following invalidates the Phase 2 run and requires a fresh
restart with a new pre-registration commit:

- Modifying `evidence/phase2/obligations.json` after the pre-registration
  commit.
- Modifying `evidence/fixtures/phase-1-gate/` while a Phase 2 run is in
  progress (caught by `fixtureContentHash` mismatch on `--resume`).
- Modifying `scripts/phase2/run-harness.ts` or `scripts/phase2/analyze.py`
  after this commit and before the run completes.
- Changing the cost cap, statistical method, or decision rules after this
  commit.

Hot-fixes to harness bugs that would otherwise prevent any obligation
from running may be made; the DECISIONS.md entry must cite the bug, the
fix's commit SHA, and the rationale that the fix does not change the
measurement (e.g., a missing-import fix vs a result-affecting metric
change).
