#!/usr/bin/env python3
"""Phase 3 statistical analysis.

Compares paired per-obligation outcomes from
``evidence/phase3/run/config-b/`` (producer + Codex) and
``evidence/phase3/run/config-bp/`` (producer + Codex + Copilot) on the
four pre-registered metrics (pass rate, cost, wall-clock, LLM call
count), applies Bonferroni correction across the four comparisons, and
emits ``evidence/phase3/analysis.md`` with test statistics, p-values
(corrected and uncorrected), 95% confidence intervals, and effect sizes.

In addition to the paired tests, the script computes Copilot's
**marginal yield per dollar** — the Phase 3 decision metric. Because
Codex's strategy does not handle the Phase 3 obligation types (Codex
targets property-must-hold; Phase 3 targets import-graph-must-satisfy
and function-must-have-signature), every Copilot falsification is by
construction unique to Copilot, so Copilot's marginal yield equals its
total yield and additional spend equals its total spend. The comparison
target is Codex's Phase 2 baseline yield-per-dollar:

    26 confirmed yields / $4.3994 token-estimate ≈ 5.91 yields per USD.

Phase 3 decision rule (locked in PROTOCOL.md):
- P3.5.a (ship B'): Copilot's yield/$ >= Codex's Phase 2 baseline yield/$.
- P3.5.b (freeze): Copilot's yield/$ < Codex's Phase 2 baseline yield/$.

The cost basis for the comparison is ``dollarsTokenEstimate``, because
Copilot CLI billing is subscription-only (``dollarsBilled = 0`` always)
while Codex's Phase 2 was per-token (``dollarsBilled == dollarsTokenEstimate``);
``dollarsTokenEstimate`` is the apples-to-apples surface.

Self-test: ``python3 scripts/phase3/analyze.py --self-test`` exercises the
math against a synthetic dataset where the answer is known.

Usage:
    python3 scripts/phase3/analyze.py
        [--config-b PATH] [--config-bp PATH]
        [--obligations PATH] [--out PATH]

    python3 scripts/phase3/analyze.py --self-test
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
DEFAULT_CONFIG_B = REPO_ROOT / "evidence" / "phase3" / "run" / "config-b"
DEFAULT_CONFIG_BP = REPO_ROOT / "evidence" / "phase3" / "run" / "config-bp"
DEFAULT_OBLIGATIONS = REPO_ROOT / "evidence" / "phase3" / "obligations.json"
DEFAULT_OUT = REPO_ROOT / "evidence" / "phase3" / "analysis.md"

# Bonferroni: 4 pre-registered comparisons (pass-rate, cost, wall-clock,
# LLM calls). Family-wise alpha 0.05 -> per-comparison alpha 0.0125.
N_COMPARISONS = 4
FAMILY_WISE_ALPHA = 0.05
PER_COMPARISON_ALPHA = FAMILY_WISE_ALPHA / N_COMPARISONS

# Codex Phase 2 baseline yield-per-dollar, used as the Phase 3 ship/no-ship
# threshold. Source: evidence/phase2/analysis.md (26 confirmed yields,
# $4.3994 total billed cost). Locked at Phase 2 close-out.
CODEX_PHASE2_YIELD = 26
CODEX_PHASE2_DOLLARS = 4.3994
CODEX_PHASE2_YIELD_PER_DOLLAR = CODEX_PHASE2_YIELD / CODEX_PHASE2_DOLLARS

BOOTSTRAP_ITERS = 10000
BOOTSTRAP_SEED = 42


@dataclass(frozen=True)
class PerObligation:
    obligation_id: str
    stratum: str
    obligation_type: str
    pass_: bool
    counter_examples_found: int
    dollars_billed: float
    dollars_token_estimate: float
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
        result_kind = record.get("resultKind") or ""
        by_id[oid] = PerObligation(
            obligation_id=oid,
            stratum=record["stratum"],
            obligation_type=record.get("type", ""),
            pass_=bool(record["pass"]),
            counter_examples_found=int(record.get("counterExamplesFound", 0)),
            dollars_billed=float(record["dollarsBilled"]),
            dollars_token_estimate=float(record["dollarsTokenEstimate"]),
            wall_clock_ms=int(record["wallClockMs"]),
            llm_calls=int(record["llmCalls"]),
            errored=(result_kind == "errored" or error_message != ""),
            error_message=error_message,
        )

    missing = [oid for oid in obligation_ids if oid not in by_id]
    if missing:
        raise ValueError(f"runtime-progress.json at {progress_path} missing obligations: {missing}")
    extras = [oid for oid in by_id if oid not in obligation_ids]
    if extras:
        raise ValueError(f"runtime-progress.json at {progress_path} has unexpected obligations: {extras}")

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
    """Phase 3 marginal yield-per-dollar calculation."""
    copilot_unique_yield: int
    additional_dollars: float
    yield_per_dollar: float
    codex_baseline_yield_per_dollar: float
    decision: str  # "ship-bp" | "freeze"
    rationale: str


def compute_marginal_yield(
    config_b: list[PerObligation],
    config_bp: list[PerObligation],
) -> MarginalYieldResult:
    # Codex (Config B) does not handle Phase 3 obligation types. Every
    # Copilot falsification on a Phase 3 obligation is therefore unique
    # to Copilot — Codex contributes zero yield by construction.
    pairs = list(zip(config_b, config_bp))
    copilot_unique_yield = sum(
        1 for b, bp in pairs if (not bp.pass_) and b.pass_
    )
    # Additional dollars = sum over all Phase 3 obligations of
    # (B' tokenEstimate - B tokenEstimate). B's tokenEstimate is $0 for
    # every Phase 3 obligation (Codex doesn't run), so this collapses to
    # the total Copilot tokenEstimate spend.
    additional_dollars = sum(bp.dollars_token_estimate for bp in config_bp) - sum(
        b.dollars_token_estimate for b in config_b
    )
    if additional_dollars <= 0:
        # Defensive: a zero-or-negative additional spend with positive
        # yield would be a "free lunch" worth a $0-denominator special
        # case in the report; for the decision we treat $0 spend with
        # any positive yield as ship-eligible.
        yield_per_dollar = float("inf") if copilot_unique_yield > 0 else 0.0
    else:
        yield_per_dollar = copilot_unique_yield / additional_dollars

    if yield_per_dollar >= CODEX_PHASE2_YIELD_PER_DOLLAR:
        decision = "ship-bp"
        rationale = (
            f"Copilot marginal yield/$ ({yield_per_dollar:.2f}) >= "
            f"Codex Phase 2 baseline ({CODEX_PHASE2_YIELD_PER_DOLLAR:.2f}); P3.5.a applies."
        )
    else:
        decision = "freeze"
        rationale = (
            f"Copilot marginal yield/$ ({yield_per_dollar:.2f}) < "
            f"Codex Phase 2 baseline ({CODEX_PHASE2_YIELD_PER_DOLLAR:.2f}); P3.5.b applies."
        )

    return MarginalYieldResult(
        copilot_unique_yield=copilot_unique_yield,
        additional_dollars=additional_dollars,
        yield_per_dollar=yield_per_dollar,
        codex_baseline_yield_per_dollar=CODEX_PHASE2_YIELD_PER_DOLLAR,
        decision=decision,
        rationale=rationale,
    )


def render_markdown(
    config_b: list[PerObligation],
    config_bp: list[PerObligation],
    pass_test: McNemarResult,
    cost_test: WilcoxonResult,
    wall_test: WilcoxonResult,
    llm_test: WilcoxonResult,
    marginal: MarginalYieldResult,
    discarded: Optional[list[tuple[str, str]]] = None,
    original_n: Optional[int] = None,
) -> str:
    n = len(config_b)
    if original_n is None:
        original_n = n
    if discarded is None:
        discarded = []
    b_pass = sum(1 for o in config_b if o.pass_)
    bp_pass = sum(1 for o in config_bp if o.pass_)
    b_pass_ci = wilson_proportion_ci(b_pass, n)
    bp_pass_ci = wilson_proportion_ci(bp_pass, n)
    b_cost_total = sum(o.dollars_billed for o in config_b)
    bp_cost_total = sum(o.dollars_billed for o in config_bp)
    b_token_total = sum(o.dollars_token_estimate for o in config_b)
    bp_token_total = sum(o.dollars_token_estimate for o in config_bp)
    b_wall_total = sum(o.wall_clock_ms for o in config_b)
    bp_wall_total = sum(o.wall_clock_ms for o in config_bp)
    b_calls_total = sum(o.llm_calls for o in config_b)
    bp_calls_total = sum(o.llm_calls for o in config_bp)

    out: list[str] = []
    out.append("# Phase 3 analysis")
    out.append("")
    out.append(f"- Original N = {original_n}")
    out.append(f"- Discarded (environmental) = {len(discarded)}")
    out.append(f"- Analyzable paired N = {n}")
    out.append(f"- Family-wise alpha = {FAMILY_WISE_ALPHA}")
    out.append(f"- Per-comparison alpha (Bonferroni) = {PER_COMPARISON_ALPHA:.4f}")
    out.append(f"- Comparisons = {N_COMPARISONS} (pass-rate, billed cost, wall-clock, LLM calls)")
    if discarded:
        out.append("")
        out.append("### Discarded obligations (environmental, excluded from paired analysis)")
        out.append("")
        for oid, reason in discarded:
            collapsed = " ".join(reason.split())[:240]
            out.append(f"- `{oid}`: {collapsed}")
    out.append("")
    out.append("## Headline metrics")
    out.append("")
    out.append("| Metric | Config B | Config B' | Notes |")
    out.append("|---|---|---|---|")
    out.append(
        f"| Pass count | {b_pass}/{n} ({b_pass_ci.point:.3f}, 95% CI [{b_pass_ci.lo:.3f}, {b_pass_ci.hi:.3f}]) "
        f"| {bp_pass}/{n} ({bp_pass_ci.point:.3f}, 95% CI [{bp_pass_ci.lo:.3f}, {bp_pass_ci.hi:.3f}]) "
        f"| Pass = system returns no falsification |"
    )
    out.append(f"| Total billed | ${b_cost_total:.4f} | ${bp_cost_total:.4f} | Real-charge USD |")
    out.append(
        f"| Total token-estimate | ${b_token_total:.4f} | ${bp_token_total:.4f} | API/per-request rate-card USD |"
    )
    out.append(
        f"| Total wall-clock (s) | {b_wall_total / 1000:.2f} | {bp_wall_total / 1000:.2f} | |"
    )
    out.append(f"| Total LLM calls | {b_calls_total} | {bp_calls_total} | |")
    out.append("")
    out.append("## Marginal yield per dollar (Phase 3 decision metric)")
    out.append("")
    out.append(
        f"- Copilot unique yield (B' falsified, B did not): **{marginal.copilot_unique_yield}**"
    )
    out.append(f"- Additional spend (B' tokenEstimate − B tokenEstimate): **${marginal.additional_dollars:.4f}**")
    if math.isinf(marginal.yield_per_dollar):
        out.append(f"- Copilot yield/$: **infinite** (zero additional spend with positive yield)")
    else:
        out.append(f"- Copilot yield/$: **{marginal.yield_per_dollar:.2f}**")
    out.append(
        f"- Codex Phase 2 baseline yield/$ (locked): **{CODEX_PHASE2_YIELD_PER_DOLLAR:.2f}** "
        f"({CODEX_PHASE2_YIELD} yields ÷ ${CODEX_PHASE2_DOLLARS:.4f})"
    )
    out.append(f"- **Decision: {marginal.decision.upper()}** — {marginal.rationale}")
    out.append("")
    out.append("## Hypothesis tests")
    out.append("")

    pass_p_corrected = bonferroni(pass_test.p_value)
    cost_p_corrected = bonferroni(cost_test.p_value)
    wall_p_corrected = bonferroni(wall_test.p_value)
    llm_p_corrected = bonferroni(llm_test.p_value)

    out.append("### 1. Pass rate (paired binary)")
    out.append(f"- Method: {pass_test.method}")
    out.append(f"- Discordant pairs: B'-only={pass_test.b}, B-only={pass_test.c} (N={n})")
    out.append(
        f"- Diff (B' - B) point = {pass_test.diff_ci.point:.4f}, "
        f"95% CI [{pass_test.diff_ci.lo:.4f}, {pass_test.diff_ci.hi:.4f}]"
    )
    out.append(f"- Uncorrected p = {pass_test.p_value:.6f}")
    out.append(f"- Bonferroni-corrected p = {pass_p_corrected:.6f}")
    out.append(
        f"- Significant at family-wise alpha={FAMILY_WISE_ALPHA}? "
        f"{'YES' if pass_p_corrected < FAMILY_WISE_ALPHA else 'NO'}"
    )
    out.append("")

    out.append("### 2. Billed cost (paired continuous)")
    out.append(f"- Method: {cost_test.method}")
    out.append(f"- Median (B' - B) = ${cost_test.median_diff:.6f}")
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
    out.append(f"- Median (B' - B) = {wall_test.median_diff:.0f} ms")
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
    out.append(f"- Median (B' - B) = {llm_test.median_diff:.2f} calls")
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
    for stratum in ("I", "F"):
        b_stratum = [o for o in config_b if o.stratum == stratum]
        bp_stratum = [o for o in config_bp if o.stratum == stratum]
        if not b_stratum:
            continue
        b_pass_s = sum(1 for o in b_stratum if o.pass_)
        bp_pass_s = sum(1 for o in bp_stratum if o.pass_)
        out.append(
            f"- Stratum {stratum} (n={len(b_stratum)}): "
            f"B pass = {b_pass_s}/{len(b_stratum)}, B' pass = {bp_pass_s}/{len(bp_stratum)}"
        )
    out.append("")
    return "\n".join(out)


def run_real_analysis(args: argparse.Namespace) -> int:
    obligations_path = Path(args.obligations).resolve()
    config_b_dir = Path(args.config_b).resolve()
    config_bp_dir = Path(args.config_bp).resolve()
    out_path = Path(args.out).resolve()

    obligations = load_obligations(obligations_path)
    obligation_ids = [o["id"] for o in obligations]
    full_config_b = load_run(config_b_dir, obligation_ids)
    full_config_bp = load_run(config_bp_dir, obligation_ids)
    if [o.obligation_id for o in full_config_b] != [o.obligation_id for o in full_config_bp]:
        raise ValueError("config-b and config-bp obligation orderings differ")

    discarded: list[tuple[str, str]] = []
    config_b: list[PerObligation] = []
    config_bp: list[PerObligation] = []
    for b, bp in zip(full_config_b, full_config_bp):
        if b.errored or bp.errored:
            who = "B" if b.errored else "B'"
            why = b.error_message if b.errored else bp.error_message
            discarded.append((b.obligation_id, f"{who}: {why[:140]}"))
            continue
        config_b.append(b)
        config_bp.append(bp)

    if not config_b:
        raise ValueError("no analyzable obligations after discards; cannot run analysis")

    if len(discarded) > 0.10 * len(full_config_b):
        sys.stderr.write(
            f"WARNING: {len(discarded)}/{len(full_config_b)} obligations discarded "
            f"({100 * len(discarded) / len(full_config_b):.1f}%) — "
            f"above the 10% threshold; close-out must cite the elevated discard rate.\n"
        )

    pairs = [(b.pass_, bp.pass_) for b, bp in zip(config_b, config_bp)]
    pass_test = mcnemar_test(pairs)
    cost_diffs = [bp.dollars_billed - b.dollars_billed for b, bp in zip(config_b, config_bp)]
    wall_diffs = [bp.wall_clock_ms - b.wall_clock_ms for b, bp in zip(config_b, config_bp)]
    llm_diffs = [bp.llm_calls - b.llm_calls for b, bp in zip(config_b, config_bp)]
    cost_test = wilcoxon_signed_rank(cost_diffs)
    wall_test = wilcoxon_signed_rank([float(x) for x in wall_diffs])
    llm_test = wilcoxon_signed_rank([float(x) for x in llm_diffs])

    marginal = compute_marginal_yield(config_b, config_bp)

    md = render_markdown(
        config_b,
        config_bp,
        pass_test,
        cost_test,
        wall_test,
        llm_test,
        marginal,
        discarded=discarded,
        original_n=len(full_config_b),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md)
    print(
        f"wrote {out_path} (analyzed N={len(config_b)}, discarded={len(discarded)}, "
        f"decision={marginal.decision})"
    )
    return 0


def synthetic_dataset(seed: int) -> tuple[list[PerObligation], list[PerObligation]]:
    """Synthetic Phase 3 paired dataset where the answer is known.

    20 obligations (10 I + 10 F). Config B passes all (Codex doesn't run
    on Phase 3 types). Config B' falsifies a deterministic 14 of them at
    a per-obligation token-estimate cost of $0.05. Expected results:
    - B-only=14, B'-only=0 → pass-rate diff ≈ -0.70.
    - Cost median diff = $0.05.
    - Wall-clock median diff = +25000 ms.
    - LLM-calls median diff = +1.
    - Marginal yield/$: 14 yields / (20 * $0.05) = 14 / $1.00 = 14/$ —
      well above the Codex Phase 2 baseline of ~5.91/$, so decision = ship-bp.
    """
    strata = ["I"] * 10 + ["F"] * 10
    rng = random.Random(seed)
    fail_idxs = set(rng.sample(range(20), 14))
    b: list[PerObligation] = []
    bp: list[PerObligation] = []
    for i in range(20):
        oid = f"S{i+1}"
        b.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            obligation_type="dummy",
            pass_=True,
            counter_examples_found=0,
            dollars_billed=0.0,
            dollars_token_estimate=0.0,
            wall_clock_ms=5,
            llm_calls=0,
            errored=False,
            error_message="",
        ))
        bp.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            obligation_type="dummy",
            pass_=(i not in fail_idxs),
            counter_examples_found=(2 if i in fail_idxs else 0),
            dollars_billed=0.0,  # Copilot subscription auth → $0 billed.
            dollars_token_estimate=0.05,
            wall_clock_ms=25000,
            llm_calls=1,
            errored=False,
            error_message="",
        ))
    return b, bp


def self_test() -> int:
    b, bp = synthetic_dataset(seed=42)
    pairs = [(x.pass_, y.pass_) for x, y in zip(b, bp)]
    pass_test = mcnemar_test(pairs)
    cost_diffs = [y.dollars_token_estimate - x.dollars_token_estimate for x, y in zip(b, bp)]
    wall_diffs = [float(y.wall_clock_ms - x.wall_clock_ms) for x, y in zip(b, bp)]
    llm_diffs = [float(y.llm_calls - x.llm_calls) for x, y in zip(b, bp)]
    cost_test = wilcoxon_signed_rank(cost_diffs)
    wall_test = wilcoxon_signed_rank(wall_diffs)
    llm_test = wilcoxon_signed_rank(llm_diffs)
    marginal = compute_marginal_yield(b, bp)

    failures: list[str] = []

    if pass_test.b != 0 or pass_test.c != 14:
        failures.append(
            f"pass_test discordant counts wrong: b={pass_test.b}, c={pass_test.c}, expected b=0, c=14"
        )
    if not (pass_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"pass_test p_value not significant: {pass_test.p_value}")

    if abs(cost_test.median_diff - 0.05) > 1e-9:
        failures.append(f"cost median diff wrong: {cost_test.median_diff}, expected 0.05")
    if not (cost_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"cost p_value not significant: {cost_test.p_value}")

    if abs(wall_test.median_diff - (25000 - 5)) > 1:
        failures.append(f"wall-clock median diff wrong: {wall_test.median_diff}")
    if not (wall_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"wall-clock p_value not significant: {wall_test.p_value}")

    if abs(llm_test.median_diff - 1) > 1e-9:
        failures.append(f"llm median diff wrong: {llm_test.median_diff}")

    if marginal.copilot_unique_yield != 14:
        failures.append(f"marginal unique yield wrong: {marginal.copilot_unique_yield}, expected 14")
    if abs(marginal.additional_dollars - 1.0) > 1e-9:
        failures.append(f"marginal additional dollars wrong: {marginal.additional_dollars}, expected 1.00")
    if abs(marginal.yield_per_dollar - 14.0) > 1e-9:
        failures.append(f"marginal yield/$ wrong: {marginal.yield_per_dollar}, expected 14.0")
    if marginal.decision != "ship-bp":
        failures.append(f"marginal decision wrong: {marginal.decision}, expected ship-bp")

    if failures:
        print("SELF-TEST FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("SELF-TEST PASSED")
    print(f"  pass-rate B'-B = {pass_test.diff_ci.point:+.4f}, p={pass_test.p_value:.6e}")
    print(f"  cost median  B'-B = ${cost_test.median_diff:+.4f}, p={cost_test.p_value:.6e}")
    print(f"  marginal yield/$ = {marginal.yield_per_dollar:.2f} vs Codex baseline {CODEX_PHASE2_YIELD_PER_DOLLAR:.2f}")
    print(f"  decision = {marginal.decision}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-b", default=str(DEFAULT_CONFIG_B))
    parser.add_argument("--config-bp", default=str(DEFAULT_CONFIG_BP))
    parser.add_argument("--obligations", default=str(DEFAULT_OBLIGATIONS))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    return run_real_analysis(args)


if __name__ == "__main__":
    sys.exit(main())
