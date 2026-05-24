#!/usr/bin/env python3
"""Phase 4 redo statistical analysis (audit-and-corrections, 2026-05-09).

Compares paired per-obligation outcomes from
``evidence/phase4-redo/run/config-bp/`` (producer + Codex; Copilot
declines on property-must-hold) and
``evidence/phase4-redo/run/config-bpp/`` (producer + Codex + ClaudeCode)
on the four pre-registered metrics, applies Bonferroni correction
across the four comparisons, and emits
``evidence/phase4-redo/analysis.md`` with test statistics, p-values
(corrected and uncorrected), 95% confidence intervals, and effect sizes.

Reports ClaudeCode's marginal yield per dollar on **both** cost bases
(audit-and-corrections fix to Concern C3):

- billed-basis: ``Σ dollarsBilled``
- API-equivalent-basis: ``Σ dollarsApiEquivalent``

Both bases are reported because the Phase 3 close-out's 6.5x headline
mixed Codex's API-billed dollars with Copilot's subscription-imputed
dollars; the fix is to surface the comparison on a like-for-like
denominator. Phase 4 redo follows the same pattern.

Phase 4 is **not a ship/no-ship gate**. Both outcomes are signal:

- High ClaudeCode marginal yield (catches things Copilot didn't despite
  being same-family as the producer) -> cross-family-diversity thesis is
  weaker than the architecture assumes; document as a load-bearing
  concern.
- Low or zero ClaudeCode marginal yield -> diversity thesis confirmed;
  document as positive validation.

The Phase 5 gate is keyed off ClaudeCode's marginal yield: positive
yield -> Phase 5 (bandit) is eligible; zero or negative -> Phase 5 is
skipped.

Self-test: ``python3 scripts/phase4/analyze.py --self-test`` exercises
the math against a known-answer dataset.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import scipy.stats as st  # type: ignore[import-not-found]


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_BP = REPO_ROOT / "evidence" / "phase4-redo" / "run" / "config-bp"
DEFAULT_CONFIG_BPP = REPO_ROOT / "evidence" / "phase4-redo" / "run" / "config-bpp"
DEFAULT_OBLIGATIONS = REPO_ROOT / "evidence" / "phase4-redo" / "obligations.json"
DEFAULT_OUT = REPO_ROOT / "evidence" / "phase4-redo" / "analysis.md"

N_COMPARISONS = 4
FAMILY_WISE_ALPHA = 0.05
PER_COMPARISON_ALPHA = FAMILY_WISE_ALPHA / N_COMPARISONS

BOOTSTRAP_ITERS = 10000
BOOTSTRAP_SEED = 42


@dataclass(frozen=True)
class PerObligation:
    obligation_id: str
    stratum: str
    obligation_type: str
    pass_: bool
    counter_examples_found: int
    falsifying_adapters: str  # comma-joined adapter names
    dollars_billed: float
    dollars_token_estimate: float
    dollars_api_equivalent: float
    wall_clock_ms: int
    llm_calls: int
    errored: bool
    error_message: str


def load_obligations(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    obligations = data["obligations"]
    if not isinstance(obligations, list):
        raise ValueError(f"obligations file at {path} has no obligations array")
    return obligations


def load_run(run_dir: Path, obligation_ids: list[str]) -> list[PerObligation]:
    progress_path = run_dir / "runtime-progress.json"
    if not progress_path.exists():
        raise FileNotFoundError(f"missing runtime-progress.json at {progress_path}")

    progress = json.loads(progress_path.read_text())
    outcomes = progress.get("outcomes", [])
    by_id: dict[str, PerObligation] = {}
    for record in outcomes:
        oid = record["id"]
        error_message = record.get("errorMessage") or ""
        falsifying = record.get("falsifyingAdapters") or ""
        by_id[oid] = PerObligation(
            obligation_id=oid,
            stratum=record["stratum"],
            obligation_type=record.get("type", ""),
            pass_=bool(record["pass"]),
            counter_examples_found=int(record.get("counterExamplesFound", 0)),
            falsifying_adapters=falsifying,
            dollars_billed=float(record["dollarsBilled"]),
            dollars_token_estimate=float(record["dollarsTokenEstimate"]),
            dollars_api_equivalent=float(
                record.get("dollarsApiEquivalent", record["dollarsTokenEstimate"])
            ),
            wall_clock_ms=int(record["wallClockMs"]),
            llm_calls=int(record["llmCalls"]),
            errored=(error_message != ""),
            error_message=error_message,
        )

    missing = [oid for oid in obligation_ids if oid not in by_id]
    if missing:
        raise ValueError(f"runtime-progress.json missing obligations: {missing}")
    extras = [oid for oid in by_id if oid not in obligation_ids]
    if extras:
        raise ValueError(f"runtime-progress.json has unexpected obligations: {extras}")

    return [by_id[oid] for oid in obligation_ids]


@dataclass(frozen=True)
class WilsonInterval:
    point: float
    lo: float
    hi: float


def wilson_proportion_ci(successes: int, trials: int, alpha: float = 0.05) -> WilsonInterval:
    if trials == 0:
        return WilsonInterval(point=float("nan"), lo=float("nan"), hi=float("nan"))
    p = successes / trials
    z = st.norm.ppf(1 - alpha / 2)
    denom = 1 + z * z / trials
    centre = (p + z * z / (2 * trials)) / denom
    half = (z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials))) / denom
    return WilsonInterval(point=p, lo=centre - half, hi=centre + half)


@dataclass(frozen=True)
class WilsonDifferenceInterval:
    point: float
    lo: float
    hi: float


def wilson_paired_diff_ci(b: int, c: int, n: int, alpha: float = 0.05) -> WilsonDifferenceInterval:
    if n == 0:
        return WilsonDifferenceInterval(point=float("nan"), lo=float("nan"), hi=float("nan"))
    p_b = b / n
    p_c = c / n
    diff = p_b - p_c
    wb = wilson_proportion_ci(b, n, alpha)
    wc = wilson_proportion_ci(c, n, alpha)
    lo = diff - math.sqrt((p_b - wb.lo) ** 2 + (wc.hi - p_c) ** 2)
    hi = diff + math.sqrt((wb.hi - p_b) ** 2 + (p_c - wc.lo) ** 2)
    return WilsonDifferenceInterval(point=diff, lo=lo, hi=hi)


@dataclass(frozen=True)
class McNemarResult:
    b: int
    c: int
    discordant: int
    p_value: float
    method: str
    diff_ci: WilsonDifferenceInterval


def mcnemar_test(pairs: list[tuple[bool, bool]]) -> McNemarResult:
    n = len(pairs)
    a_only = sum(1 for a, b in pairs if a and not b)
    b_only = sum(1 for a, b in pairs if b and not a)
    discordant = a_only + b_only
    if discordant == 0:
        return McNemarResult(
            b=b_only,
            c=a_only,
            discordant=0,
            p_value=1.0,
            method="trivial (no discordant pairs)",
            diff_ci=wilson_paired_diff_ci(b_only, a_only, n),
        )
    if discordant < 25 or a_only == 0 or b_only == 0:
        k = min(a_only, b_only)
        p_value = float(st.binomtest(k, discordant, p=0.5, alternative="two-sided").pvalue)
        method = "exact binomial (b+c < 25 or one-sided degeneracy)"
    else:
        chi2 = ((abs(a_only - b_only) - 1) ** 2) / discordant
        p_value = float(1 - st.chi2.cdf(chi2, df=1))
        method = "McNemar chi-square (continuity-corrected)"
    return McNemarResult(
        b=b_only,
        c=a_only,
        discordant=discordant,
        p_value=p_value,
        method=method,
        diff_ci=wilson_paired_diff_ci(b_only, a_only, n),
    )


@dataclass(frozen=True)
class WilcoxonResult:
    statistic: float
    p_value: float
    method: str
    median_diff: float
    median_ci_lo: float
    median_ci_hi: float
    n_zero_diffs: int
    n_nonzero: int


def bootstrap_median_ci(values: list[float], iters: int, seed: int) -> tuple[float, float, float]:
    if not values:
        return (float("nan"), float("nan"), float("nan"))
    rng = random.Random(seed)
    medians: list[float] = []
    for _ in range(iters):
        sample = [values[rng.randrange(0, len(values))] for _ in range(len(values))]
        medians.append(statistics.median(sample))
    medians.sort()
    point = statistics.median(values)
    lo = medians[int(0.025 * iters)]
    hi = medians[int(0.975 * iters)]
    return point, lo, hi


def wilcoxon_signed_rank(diffs: list[float]) -> WilcoxonResult:
    nonzero = [d for d in diffs if d != 0]
    n_zero = len(diffs) - len(nonzero)
    if not nonzero:
        return WilcoxonResult(
            statistic=float("nan"),
            p_value=1.0,
            method="trivial (all paired differences are zero)",
            median_diff=0.0,
            median_ci_lo=0.0,
            median_ci_hi=0.0,
            n_zero_diffs=n_zero,
            n_nonzero=0,
        )
    res = st.wilcoxon(nonzero, zero_method="wilcox", correction=False, alternative="two-sided")
    median_diff, median_ci_lo, median_ci_hi = bootstrap_median_ci(diffs, BOOTSTRAP_ITERS, BOOTSTRAP_SEED)
    return WilcoxonResult(
        statistic=float(res.statistic),
        p_value=float(res.pvalue),
        method="paired Wilcoxon signed-rank (two-sided, zero_method='wilcox')",
        median_diff=median_diff,
        median_ci_lo=median_ci_lo,
        median_ci_hi=median_ci_hi,
        n_zero_diffs=n_zero,
        n_nonzero=len(nonzero),
    )


def bonferroni(p: float) -> float:
    return min(1.0, p * N_COMPARISONS)


@dataclass(frozen=True)
class MarginalYieldResult:
    """Phase 4 redo ClaudeCode marginal yield-per-dollar calculation,
    reported on three bases per the audit-and-corrections fix."""
    claudecode_unique_yield: int
    # billed-basis (dollarsBilled) — what was actually charged
    additional_dollars_billed: float
    yield_per_dollar_billed: float
    # token-estimate basis (dollarsTokenEstimate) — preserves the
    # original Phase 3/4 headline surface for back-compat
    additional_dollars_token_estimate: float
    yield_per_dollar_token_estimate: float
    # API-equivalent basis (dollarsApiEquivalent) — like-for-like
    # cross-adapter denominator
    additional_dollars_api_equivalent: float
    yield_per_dollar_api_equivalent: float
    diversity_thesis: str  # "confirmed" | "weakened"
    phase5_gate: str       # "eligible" | "skip"


def _yield_per_dollar(unique: int, additional: float) -> float:
    if additional <= 0:
        return float("inf") if unique > 0 else 0.0
    return unique / additional


def compute_marginal_yield(
    config_bp: list[PerObligation],
    config_bpp: list[PerObligation],
) -> MarginalYieldResult:
    pairs = list(zip(config_bp, config_bpp))
    # Marginal yield: obligations B'' falsified that B' did not.
    # Pass means "no adapter falsified"; B'-only passing AND B''-not
    # passing means ClaudeCode caught what Codex did not.
    claudecode_unique_yield = sum(
        1 for bp, bpp in pairs if bp.pass_ and not bpp.pass_
    )
    bp_billed = sum(o.dollars_billed for o in config_bp)
    bpp_billed = sum(o.dollars_billed for o in config_bpp)
    bp_tok = sum(o.dollars_token_estimate for o in config_bp)
    bpp_tok = sum(o.dollars_token_estimate for o in config_bpp)
    bp_api = sum(o.dollars_api_equivalent for o in config_bp)
    bpp_api = sum(o.dollars_api_equivalent for o in config_bpp)
    add_billed = bpp_billed - bp_billed
    add_tok = bpp_tok - bp_tok
    add_api = bpp_api - bp_api

    if claudecode_unique_yield > 0:
        diversity_thesis = "weakened"
        phase5_gate = "eligible"
    else:
        diversity_thesis = "confirmed"
        phase5_gate = "skip"

    return MarginalYieldResult(
        claudecode_unique_yield=claudecode_unique_yield,
        additional_dollars_billed=add_billed,
        yield_per_dollar_billed=_yield_per_dollar(claudecode_unique_yield, add_billed),
        additional_dollars_token_estimate=add_tok,
        yield_per_dollar_token_estimate=_yield_per_dollar(claudecode_unique_yield, add_tok),
        additional_dollars_api_equivalent=add_api,
        yield_per_dollar_api_equivalent=_yield_per_dollar(claudecode_unique_yield, add_api),
        diversity_thesis=diversity_thesis,
        phase5_gate=phase5_gate,
    )


def render_markdown(
    config_bp: list[PerObligation],
    config_bpp: list[PerObligation],
    pass_test: McNemarResult,
    cost_test: WilcoxonResult,
    wall_test: WilcoxonResult,
    llm_test: WilcoxonResult,
    marginal: MarginalYieldResult,
    discarded: Optional[list[tuple[str, str]]] = None,
    original_n: Optional[int] = None,
) -> str:
    n = len(config_bp)
    if original_n is None:
        original_n = n
    if discarded is None:
        discarded = []
    bp_pass = sum(1 for o in config_bp if o.pass_)
    bpp_pass = sum(1 for o in config_bpp if o.pass_)
    bp_pass_ci = wilson_proportion_ci(bp_pass, n)
    bpp_pass_ci = wilson_proportion_ci(bpp_pass, n)
    bp_cost_total = sum(o.dollars_billed for o in config_bp)
    bpp_cost_total = sum(o.dollars_billed for o in config_bpp)
    bp_token_total = sum(o.dollars_token_estimate for o in config_bp)
    bpp_token_total = sum(o.dollars_token_estimate for o in config_bpp)
    bp_api_total = sum(o.dollars_api_equivalent for o in config_bp)
    bpp_api_total = sum(o.dollars_api_equivalent for o in config_bpp)
    bp_wall_total = sum(o.wall_clock_ms for o in config_bp)
    bpp_wall_total = sum(o.wall_clock_ms for o in config_bpp)
    bp_calls_total = sum(o.llm_calls for o in config_bp)
    bpp_calls_total = sum(o.llm_calls for o in config_bpp)

    out: list[str] = []
    out.append("# Phase 4 redo analysis (audit-and-corrections, 2026-05-09)")
    out.append("")
    out.append(
        "Replaces the original Phase 4 analysis at "
        "`evidence/phase4/analysis.md` (now status-banner INVALIDATED). "
        "The original Phase 4 reused Phase 3's `import-graph` + "
        "`function-signature` obligations, which targeted Copilot's "
        "specialties — uninterpretable for ClaudeCode's "
        "adversarial-test-input strategy. The redo's obligation set is "
        "20 `property-must-hold` obligations disjoint from Phases 1, "
        "2, and 3 (`evidence/phase4-redo/obligations.json`)."
    )
    out.append("")
    out.append(f"- Original N = {original_n}")
    out.append(f"- Discarded (environmental) = {len(discarded)}")
    out.append(f"- Analyzable paired N = {n}")
    out.append(f"- Family-wise alpha = {FAMILY_WISE_ALPHA}")
    out.append(f"- Per-comparison alpha (Bonferroni) = {PER_COMPARISON_ALPHA:.4f}")
    out.append(f"- Comparisons = {N_COMPARISONS}")
    if discarded:
        out.append("")
        out.append("### Discarded obligations (environmental, excluded from paired analysis)")
        out.append("")
        for oid, reason in discarded:
            out.append(f"- `{oid}`: {reason[:240]}")
    out.append("")
    out.append("## Headline metrics")
    out.append("")
    out.append("| Metric | Config B' | Config B'' | Notes |")
    out.append("|---|---|---|---|")
    out.append(
        f"| Pass count | {bp_pass}/{n} ({bp_pass_ci.point:.3f}, 95% CI [{bp_pass_ci.lo:.3f}, {bp_pass_ci.hi:.3f}]) "
        f"| {bpp_pass}/{n} ({bpp_pass_ci.point:.3f}, 95% CI [{bpp_pass_ci.lo:.3f}, {bpp_pass_ci.hi:.3f}]) "
        f"| Pass = no adapter reported a counter-example |"
    )
    out.append(f"| Total billed | ${bp_cost_total:.4f} | ${bpp_cost_total:.4f} | Real-charge USD (`dollarsBilled`); Codex API-billed; ClaudeCode subscription = $0 unless ANTHROPIC_API_KEY set |")
    out.append(f"| Total token-estimate | ${bp_token_total:.4f} | ${bpp_token_total:.4f} | `dollarsTokenEstimate`; for ClaudeCode this equals API rate card |")
    out.append(f"| Total API-equivalent | ${bp_api_total:.4f} | ${bpp_api_total:.4f} | Like-for-like API-rate-card USD (`dollarsApiEquivalent`); audit-and-corrections 2026-05-09 |")
    out.append(f"| Total wall-clock (s) | {bp_wall_total / 1000:.2f} | {bpp_wall_total / 1000:.2f} | |")
    out.append(f"| Total LLM calls | {bp_calls_total} | {bpp_calls_total} | |")
    out.append("")
    out.append("## ClaudeCode marginal yield per dollar — both bases")
    out.append("")
    out.append(f"- ClaudeCode unique yield (B'' falsified, B' did not): **{marginal.claudecode_unique_yield}** (machine-claimed; operator inspection skeleton at `evidence/phase4-redo/run/config-b-prime-prime/inspection.md`).")
    out.append("")
    out.append("**Billed basis:**")
    out.append(f"- Additional `dollarsBilled` spend: **${marginal.additional_dollars_billed:.4f}**")
    if math.isinf(marginal.yield_per_dollar_billed):
        out.append("- ClaudeCode billed-basis yield/$: **infinite** (zero additional billed with positive yield — runs under subscription)")
    else:
        out.append(f"- ClaudeCode billed-basis yield/$: **{marginal.yield_per_dollar_billed:.2f}**")
    out.append("")
    out.append("**API-equivalent basis (the like-for-like surface):**")
    out.append(f"- Additional `dollarsApiEquivalent` spend: **${marginal.additional_dollars_api_equivalent:.4f}**")
    if math.isinf(marginal.yield_per_dollar_api_equivalent):
        out.append("- ClaudeCode API-equivalent yield/$: **infinite** (zero additional spend with positive yield)")
    else:
        out.append(f"- ClaudeCode API-equivalent yield/$: **{marginal.yield_per_dollar_api_equivalent:.2f}**")
    out.append("")
    out.append("**Token-estimate basis (back-compat with original Phase 4 headline shape):**")
    out.append(f"- Additional `dollarsTokenEstimate` spend: **${marginal.additional_dollars_token_estimate:.4f}**")
    if math.isinf(marginal.yield_per_dollar_token_estimate):
        out.append("- ClaudeCode token-estimate yield/$: **infinite**")
    else:
        out.append(f"- ClaudeCode token-estimate yield/$: **{marginal.yield_per_dollar_token_estimate:.2f}**")
    out.append("")
    if marginal.diversity_thesis == "confirmed":
        out.append(
            "**Cross-family diversity thesis: CONFIRMED (machine-claimed; "
            "operator-confirmed pending).** ClaudeCode (same family as "
            "the producer) added zero unique yield over Codex on the "
            "property-must-hold obligation surface ClaudeCode's strategy "
            "actually targets. This is the like-for-like cross-family "
            "test the original Phase 4 attempted but could not run "
            "because the obligation type was wrong (see "
            "`evidence/phase4/analysis.md` status banner). On the "
            "redo's correctly-typed surface the thesis holds: the "
            "cross-family Codex contribution covers what the "
            "same-family ClaudeCode also catches; the same-family "
            "adapter is redundant for the property-must-hold mix."
        )
    else:
        out.append(
            "**Cross-family diversity thesis: WEAKENED.** ClaudeCode "
            "(same family as the producer) added unique yield over the "
            "Codex baseline on the property-must-hold obligation set. "
            "The diversity thesis is weaker than the architecture's "
            "premise assumes — investigate what ClaudeCode caught that "
            "Codex did not, and whether the gap reflects a strategy "
            "ceiling or a model-family advantage. This invalidates the "
            "Phase 5 skip's third-adapter-revisit condition; Phase 5 "
            "becomes worth re-evaluating."
        )
    out.append("")
    out.append(f"**Phase 5 gate (per the operator brief): {marginal.phase5_gate.upper()}.**")
    if marginal.phase5_gate == "skip":
        out.append(
            "ClaudeCode marginal yield is zero on the property-must-hold "
            "obligation surface. The operator brief's tightened gate "
            "(\"if ClaudeCode yield is zero or negative, skip Phase 5\") "
            "fires; Phase 5 stays skipped on operational grounds. A "
            "third-adapter-revisit condition would re-open the decision."
        )
    else:
        out.append(
            "ClaudeCode marginal yield is positive on the property-must-hold "
            "obligation surface; Phase 5 (bandit dispatcher) becomes eligible. "
            "The \"third adapter that earns its slot\" revisit condition has "
            "fired — Phase 5 returns to the table."
        )
    out.append("")
    out.append("## Hypothesis tests")
    out.append("")

    pass_p_corrected = bonferroni(pass_test.p_value)
    cost_p_corrected = bonferroni(cost_test.p_value)
    wall_p_corrected = bonferroni(wall_test.p_value)
    llm_p_corrected = bonferroni(llm_test.p_value)

    out.append("### 1. Pass rate (paired binary)")
    out.append(f"- Method: {pass_test.method}")
    out.append(f"- Discordant pairs: B''-only={pass_test.b}, B'-only={pass_test.c} (N={n})")
    out.append(
        f"- Diff (B'' - B') point = {pass_test.diff_ci.point:.4f}, "
        f"95% CI [{pass_test.diff_ci.lo:.4f}, {pass_test.diff_ci.hi:.4f}]"
    )
    out.append(f"- Uncorrected p = {pass_test.p_value:.6f}")
    out.append(f"- Bonferroni-corrected p = {pass_p_corrected:.6f}")
    out.append(
        f"- Significant at family-wise alpha={FAMILY_WISE_ALPHA}? "
        f"{'YES' if pass_p_corrected < FAMILY_WISE_ALPHA else 'NO'}"
    )
    out.append("")

    out.append("### 2. Token-estimate cost (paired continuous)")
    out.append(f"- Method: {cost_test.method}")
    out.append(f"- Median (B'' - B') = ${cost_test.median_diff:.6f}")
    out.append(
        f"- 95% bootstrap CI for median diff: [${cost_test.median_ci_lo:.6f}, ${cost_test.median_ci_hi:.6f}]"
    )
    out.append(f"- W = {cost_test.statistic:.4f}, n_nonzero = {cost_test.n_nonzero}, n_zero = {cost_test.n_zero_diffs}")
    out.append(f"- Uncorrected p = {cost_test.p_value:.6f}")
    out.append(f"- Bonferroni-corrected p = {cost_p_corrected:.6f}")
    out.append(
        f"- Significant at family-wise alpha={FAMILY_WISE_ALPHA}? "
        f"{'YES' if cost_p_corrected < FAMILY_WISE_ALPHA else 'NO'}"
    )
    out.append("")

    out.append("### 3. Wall-clock (paired continuous)")
    out.append(f"- Method: {wall_test.method}")
    out.append(f"- Median (B'' - B') = {wall_test.median_diff:.0f} ms")
    out.append(
        f"- 95% bootstrap CI for median diff: [{wall_test.median_ci_lo:.0f} ms, {wall_test.median_ci_hi:.0f} ms]"
    )
    out.append(f"- W = {wall_test.statistic:.4f}, n_nonzero = {wall_test.n_nonzero}, n_zero = {wall_test.n_zero_diffs}")
    out.append(f"- Uncorrected p = {wall_test.p_value:.6f}")
    out.append(f"- Bonferroni-corrected p = {wall_p_corrected:.6f}")
    out.append(
        f"- Significant at family-wise alpha={FAMILY_WISE_ALPHA}? "
        f"{'YES' if wall_p_corrected < FAMILY_WISE_ALPHA else 'NO'}"
    )
    out.append("")

    out.append("### 4. LLM call count (paired continuous)")
    out.append(f"- Method: {llm_test.method}")
    out.append(f"- Median (B'' - B') = {llm_test.median_diff:.2f} calls")
    out.append(
        f"- 95% bootstrap CI for median diff: [{llm_test.median_ci_lo:.2f}, {llm_test.median_ci_hi:.2f}]"
    )
    out.append(f"- W = {llm_test.statistic:.4f}, n_nonzero = {llm_test.n_nonzero}, n_zero = {llm_test.n_zero_diffs}")
    out.append(f"- Uncorrected p = {llm_test.p_value:.6f}")
    out.append(f"- Bonferroni-corrected p = {llm_p_corrected:.6f}")
    out.append(
        f"- Significant at family-wise alpha={FAMILY_WISE_ALPHA}? "
        f"{'YES' if llm_p_corrected < FAMILY_WISE_ALPHA else 'NO'}"
    )
    out.append("")
    out.append("## Per-stratum breakdown")
    out.append("")
    for stratum in ("A", "B", "C"):
        bp_stratum = [o for o in config_bp if o.stratum == stratum]
        bpp_stratum = [o for o in config_bpp if o.stratum == stratum]
        if not bp_stratum:
            continue
        bp_pass_s = sum(1 for o in bp_stratum if o.pass_)
        bpp_pass_s = sum(1 for o in bpp_stratum if o.pass_)
        out.append(
            f"- Stratum {stratum} (n={len(bp_stratum)}): "
            f"B' pass = {bp_pass_s}/{len(bp_stratum)}, B'' pass = {bpp_pass_s}/{len(bpp_stratum)}"
        )
    out.append("")
    return "\n".join(out)


def run_real_analysis(args: argparse.Namespace) -> int:
    obligations_path = Path(args.obligations).resolve()
    config_bp_dir = Path(args.config_bp).resolve()
    config_bpp_dir = Path(args.config_bpp).resolve()
    out_path = Path(args.out).resolve()

    obligations = load_obligations(obligations_path)
    obligation_ids = [o["id"] for o in obligations]
    full_config_bp = load_run(config_bp_dir, obligation_ids)
    full_config_bpp = load_run(config_bpp_dir, obligation_ids)
    if [o.obligation_id for o in full_config_bp] != [o.obligation_id for o in full_config_bpp]:
        raise ValueError("config-bp and config-bpp obligation orderings differ")

    discarded: list[tuple[str, str]] = []
    config_bp: list[PerObligation] = []
    config_bpp: list[PerObligation] = []
    for bp, bpp in zip(full_config_bp, full_config_bpp):
        if bp.errored or bpp.errored:
            who = "B'" if bp.errored else "B''"
            why = bp.error_message if bp.errored else bpp.error_message
            discarded.append((bp.obligation_id, f"{who}: {why[:140]}"))
            continue
        config_bp.append(bp)
        config_bpp.append(bpp)

    if not config_bp:
        raise ValueError("no analyzable obligations after discards; cannot run analysis")

    if len(discarded) > 0.10 * len(full_config_bp):
        sys.stderr.write(
            f"WARNING: {len(discarded)}/{len(full_config_bp)} obligations discarded "
            f"({100 * len(discarded) / len(full_config_bp):.1f}%) — "
            f"above the 10% threshold; close-out must cite the elevated discard rate.\n"
        )

    pairs = [(bp.pass_, bpp.pass_) for bp, bpp in zip(config_bp, config_bpp)]
    pass_test = mcnemar_test(pairs)
    cost_diffs = [bpp.dollars_token_estimate - bp.dollars_token_estimate for bp, bpp in zip(config_bp, config_bpp)]
    wall_diffs = [bpp.wall_clock_ms - bp.wall_clock_ms for bp, bpp in zip(config_bp, config_bpp)]
    llm_diffs = [bpp.llm_calls - bp.llm_calls for bp, bpp in zip(config_bp, config_bpp)]
    cost_test = wilcoxon_signed_rank(cost_diffs)
    wall_test = wilcoxon_signed_rank([float(x) for x in wall_diffs])
    llm_test = wilcoxon_signed_rank([float(x) for x in llm_diffs])

    marginal = compute_marginal_yield(config_bp, config_bpp)

    md = render_markdown(
        config_bp,
        config_bpp,
        pass_test,
        cost_test,
        wall_test,
        llm_test,
        marginal,
        discarded=discarded,
        original_n=len(full_config_bp),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md)
    print(
        f"wrote {out_path} (analyzed N={len(config_bp)}, discarded={len(discarded)}, "
        f"diversity_thesis={marginal.diversity_thesis}, phase5_gate={marginal.phase5_gate})"
    )
    return 0


def synthetic_dataset(seed: int, claudecode_unique: int) -> tuple[list[PerObligation], list[PerObligation]]:
    """Synthetic Phase 4 redo paired dataset.

    20 obligations. B' (Codex) falsifies 18 of them. B'' (Codex +
    ClaudeCode) is identical to B' EXCEPT it also catches
    `claudecode_unique` additional obligations that B' missed.
    Per-obligation cost: B' has $0.10 billed (Codex API),
    $0.10 api-equivalent. B'' adds $0.05 token-est ClaudeCode cost on
    every obligation it ran on; under subscription auth that lands as
    `dollarsApiEquivalent` only, with `dollarsBilled` unchanged.
    """
    strata = ["A"] * 8 + ["B"] * 7 + ["C"] * 5
    rng = random.Random(seed)
    bp_misses = set(rng.sample(range(20), 2))
    bpp_misses = set(rng.sample(list(bp_misses), max(0, 2 - claudecode_unique)))
    bp: list[PerObligation] = []
    bpp: list[PerObligation] = []
    for i in range(20):
        oid = f"S{i+1}"
        bp_pass = i in bp_misses
        bpp_pass = i in bpp_misses
        bp.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            obligation_type="property-must-hold",
            pass_=bp_pass,
            counter_examples_found=0 if bp_pass else 1,
            falsifying_adapters="" if bp_pass else "codex",
            dollars_billed=0.10,
            dollars_token_estimate=0.10,
            dollars_api_equivalent=0.10,
            wall_clock_ms=10000,
            llm_calls=1,
            errored=False,
            error_message="",
        ))
        bpp.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            obligation_type="property-must-hold",
            pass_=bpp_pass,
            counter_examples_found=0 if bpp_pass else (2 if not bp_pass else 1),
            falsifying_adapters="" if bpp_pass else ("codex,claude-code" if not bp_pass else "claude-code"),
            dollars_billed=0.10,
            dollars_token_estimate=0.15,
            dollars_api_equivalent=0.15,
            wall_clock_ms=20000,
            llm_calls=2,
            errored=False,
            error_message="",
        ))
    return bp, bpp


def self_test() -> int:
    failures: list[str] = []

    # Case 1: ClaudeCode adds zero unique yield → diversity confirmed,
    # phase 5 skipped.
    bp1, bpp1 = synthetic_dataset(seed=1, claudecode_unique=0)
    m1 = compute_marginal_yield(bp1, bpp1)
    if m1.claudecode_unique_yield != 0:
        failures.append(f"case 1: expected unique yield 0, got {m1.claudecode_unique_yield}")
    if m1.diversity_thesis != "confirmed":
        failures.append(f"case 1: expected diversity confirmed, got {m1.diversity_thesis}")
    if m1.phase5_gate != "skip":
        failures.append(f"case 1: expected phase5 skip, got {m1.phase5_gate}")
    # Billed-basis yield/$ should be 0 (zero unique yield); both bases
    # should agree on direction.
    if m1.yield_per_dollar_billed != 0.0:
        failures.append(f"case 1: expected billed yield/$ 0, got {m1.yield_per_dollar_billed}")
    if m1.yield_per_dollar_api_equivalent != 0.0:
        failures.append(f"case 1: expected api-equiv yield/$ 0, got {m1.yield_per_dollar_api_equivalent}")

    # Case 2: ClaudeCode adds 2 unique yields → diversity weakened,
    # phase 5 eligible. Billed-basis = inf because ClaudeCode is on
    # subscription (no additional billed); api-equivalent finite.
    bp2, bpp2 = synthetic_dataset(seed=2, claudecode_unique=2)
    m2 = compute_marginal_yield(bp2, bpp2)
    if m2.claudecode_unique_yield != 2:
        failures.append(f"case 2: expected unique yield 2, got {m2.claudecode_unique_yield}")
    if m2.diversity_thesis != "weakened":
        failures.append(f"case 2: expected diversity weakened, got {m2.diversity_thesis}")
    if m2.phase5_gate != "eligible":
        failures.append(f"case 2: expected phase5 eligible, got {m2.phase5_gate}")
    if not math.isinf(m2.yield_per_dollar_billed):
        failures.append(
            f"case 2: expected billed-basis yield/$ infinite (subscription), got {m2.yield_per_dollar_billed}"
        )
    expected_api = 2 / 1.0  # 20 × $0.05 = $1.00 additional API-equiv
    if abs(m2.yield_per_dollar_api_equivalent - expected_api) > 1e-9:
        failures.append(
            f"case 2: expected api-equiv yield/$ {expected_api}, got {m2.yield_per_dollar_api_equivalent}"
        )

    if failures:
        print("SELF-TEST FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("SELF-TEST PASSED")
    print(f"  case 1 (zero unique): diversity={m1.diversity_thesis}, phase5={m1.phase5_gate}")
    print(
        f"  case 2 (positive unique): diversity={m2.diversity_thesis}, "
        f"phase5={m2.phase5_gate}, billed yield/$={m2.yield_per_dollar_billed}, "
        f"api-equiv yield/$={m2.yield_per_dollar_api_equivalent:.2f}"
    )
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-bp", default=str(DEFAULT_CONFIG_BP))
    parser.add_argument("--config-bpp", default=str(DEFAULT_CONFIG_BPP))
    parser.add_argument("--obligations", default=str(DEFAULT_OBLIGATIONS))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    return run_real_analysis(args)


if __name__ == "__main__":
    sys.exit(main())
