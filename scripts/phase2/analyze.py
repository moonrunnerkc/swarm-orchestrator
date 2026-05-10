#!/usr/bin/env python3
"""Phase 2 statistical analysis.

Compares paired per-obligation outcomes from
``evidence/phase2/run/config-a/`` and ``evidence/phase2/run/config-b/``
on the four pre-registered metrics (pass rate, cost, wall-clock, LLM call
count), applies Bonferroni correction across the four comparisons, and
emits ``evidence/phase2/analysis.md`` with test statistics, p-values
(corrected and uncorrected), 95% confidence intervals, and effect sizes.

Test choices (locked in PROTOCOL.md):
- Pass rate (paired binary outcome): McNemar's test, with exact-binomial
  fallback when ``b + c < 25`` or one arm is zero.
- Cost / wall-clock / LLM calls (paired continuous): Wilcoxon signed-rank
  test on the per-obligation B-A differences. Two-sided.
- 95% CIs:
    * Pass-rate diff: Wilson score CI on (b - c) / N.
    * Median diff: bootstrap percentile CI (n=10000, seed=42).
- Bonferroni: alpha=0.05 / 4 = 0.0125 per comparison.

Self-test: when invoked with ``--self-test``, runs a synthetic paired
dataset where the answer is known (B systematically catches more
counter-examples and costs $0.20 more per obligation than A) and asserts
the script returns the expected sign/significance.

Real test note: ``--self-test`` exercises the math against a known answer.
The Phase 2 protocol pre-registers this self-test as the validation gate
before applying the script to real run data.

Usage:
    python3 scripts/phase2/analyze.py
        [--config-a PATH] [--config-b PATH]
        [--obligations PATH] [--out PATH]

    python3 scripts/phase2/analyze.py --self-test
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
DEFAULT_CONFIG_A = REPO_ROOT / "evidence" / "phase2" / "run" / "config-a"
DEFAULT_CONFIG_B = REPO_ROOT / "evidence" / "phase2" / "run" / "config-b"
DEFAULT_OBLIGATIONS = REPO_ROOT / "evidence" / "phase2" / "obligations.json"
DEFAULT_OUT = REPO_ROOT / "evidence" / "phase2" / "analysis.md"

# Bonferroni: 4 pre-registered comparisons (pass-rate, cost, wall-clock,
# LLM call count). Family-wise alpha 0.05 -> per-comparison alpha 0.0125.
N_COMPARISONS = 4
FAMILY_WISE_ALPHA = 0.05
PER_COMPARISON_ALPHA = FAMILY_WISE_ALPHA / N_COMPARISONS

BOOTSTRAP_ITERS = 10000
BOOTSTRAP_SEED = 42


@dataclass(frozen=True)
class PerObligation:
    obligation_id: str
    stratum: str
    pass_: bool
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
    """Load per-obligation outcomes from runtime-progress.json.

    runtime-progress.json is the structured canonical record of the run
    (see scripts/phase2/run-harness.ts: PerObligationOutcome, RuntimeProgress).
    summary.tsv is a derived flat view; we prefer JSON because the TSV
    can break when an obligation's errorMessage contains tabs or
    newlines (codex stderr embedded verbatim).
    """
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
            pass_=bool(record["pass"]),
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
    """Wilson score CI for a binomial proportion. Stable at boundary values."""
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
    """Newcombe's method 10 for paired-proportions difference CI.

    For paired binary outcomes, the proportion difference is
    (b - c) / n. We use the score-derived asymptotic CI from
    Newcombe (1998). Robust at boundary cases compared to the naive
    normal-approximation formula.
    """
    if n == 0:
        return WilsonDifferenceInterval(point=float("nan"), lo=float("nan"), hi=float("nan"))
    p_b = b / n
    p_c = c / n
    diff = p_b - p_c
    # Wilson interval components for each arm.
    wb = wilson_proportion_ci(b, n, alpha)
    wc = wilson_proportion_ci(c, n, alpha)
    # Phi: tetrachoric correlation approximation (a, b, c, d cells).
    # Without a full 2x2 we approximate by zero correlation; the
    # resulting CI is conservative for our discordant-only case.
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
    """Paired-binary test. Falls back to exact binomial when discordant pairs are sparse."""
    n = len(pairs)
    # b: A failed AND B passed (in our framing, "A flagged" vs "B flagged"
    # is symmetrical; we score a "yield" as "system found falsification").
    # We compute discordances on the boolean pass_ values.
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
        # Exact binomial on the smaller of (a_only, b_only) under H0:
        # discordances split 50/50.
        k = min(a_only, b_only)
        p_value = float(st.binomtest(k, discordant, p=0.5, alternative="two-sided").pvalue)
        method = "exact binomial (b+c < 25 or one-sided degeneracy)"
    else:
        # Mid-p McNemar with continuity correction.
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
    # zero_method='wilcox' is the classic. Fall back to 'pratt' if scipy
    # complains; with non-zero filter above we should be safe with 'wilcox'.
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


def render_markdown(
    config_a: list[PerObligation],
    config_b: list[PerObligation],
    pass_test: McNemarResult,
    cost_test: WilcoxonResult,
    wall_test: WilcoxonResult,
    llm_test: WilcoxonResult,
    discarded: Optional[list[tuple[str, str]]] = None,
    original_n: Optional[int] = None,
) -> str:
    n = len(config_a)
    if original_n is None:
        original_n = n
    if discarded is None:
        discarded = []
    a_pass = sum(1 for o in config_a if o.pass_)
    b_pass = sum(1 for o in config_b if o.pass_)
    a_pass_ci = wilson_proportion_ci(a_pass, n)
    b_pass_ci = wilson_proportion_ci(b_pass, n)
    a_cost_total = sum(o.dollars_billed for o in config_a)
    b_cost_total = sum(o.dollars_billed for o in config_b)
    a_token_total = sum(o.dollars_token_estimate for o in config_a)
    b_token_total = sum(o.dollars_token_estimate for o in config_b)
    a_wall_total = sum(o.wall_clock_ms for o in config_a)
    b_wall_total = sum(o.wall_clock_ms for o in config_b)
    a_calls_total = sum(o.llm_calls for o in config_a)
    b_calls_total = sum(o.llm_calls for o in config_b)

    out: list[str] = []
    out.append("# Phase 2 analysis")
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
    out.append("| Metric | Config A | Config B | Notes |")
    out.append("|---|---|---|---|")
    out.append(
        f"| Pass count | {a_pass}/{n} ({a_pass_ci.point:.3f}, 95% CI [{a_pass_ci.lo:.3f}, {a_pass_ci.hi:.3f}]) "
        f"| {b_pass}/{n} ({b_pass_ci.point:.3f}, 95% CI [{b_pass_ci.lo:.3f}, {b_pass_ci.hi:.3f}]) "
        f"| Pass = system returns no falsification |"
    )
    out.append(
        f"| Total billed | ${a_cost_total:.4f} | ${b_cost_total:.4f} | Real-charge USD |"
    )
    out.append(
        f"| Total token-estimate | ${a_token_total:.4f} | ${b_token_total:.4f} | API-rate-card USD |"
    )
    out.append(
        f"| Total wall-clock (s) | {a_wall_total / 1000:.2f} | {b_wall_total / 1000:.2f} | |"
    )
    out.append(
        f"| Total LLM calls | {a_calls_total} | {b_calls_total} | |"
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
    out.append(f"- Discordant pairs: B-only={pass_test.b}, A-only={pass_test.c} (N={n})")
    out.append(
        f"- Diff (B - A) point = {pass_test.diff_ci.point:.4f}, "
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
    out.append(f"- Median (B - A) = ${cost_test.median_diff:.6f}")
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
    out.append(f"- Median (B - A) = {wall_test.median_diff:.0f} ms")
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
    out.append(f"- Median (B - A) = {llm_test.median_diff:.2f} calls")
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
        a_stratum = [o for o in config_a if o.stratum == stratum]
        b_stratum = [o for o in config_b if o.stratum == stratum]
        if not a_stratum:
            continue
        a_pass_s = sum(1 for o in a_stratum if o.pass_)
        b_pass_s = sum(1 for o in b_stratum if o.pass_)
        out.append(
            f"- Stratum {stratum} (n={len(a_stratum)}): "
            f"A pass = {a_pass_s}/{len(a_stratum)}, B pass = {b_pass_s}/{len(b_stratum)}"
        )
    out.append("")
    return "\n".join(out)


def run_real_analysis(args: argparse.Namespace) -> int:
    obligations_path = Path(args.obligations).resolve()
    config_a_dir = Path(args.config_a).resolve()
    config_b_dir = Path(args.config_b).resolve()
    out_path = Path(args.out).resolve()

    obligations = load_obligations(obligations_path)
    obligation_ids = [o["id"] for o in obligations]
    full_config_a = load_run(config_a_dir, obligation_ids)
    full_config_b = load_run(config_b_dir, obligation_ids)
    if [o.obligation_id for o in full_config_a] != [o.obligation_id for o in full_config_b]:
        raise ValueError("config-a and config-b obligation orderings differ")

    # Filter out paired pairs where either arm is an environmental discard
    # (errored). Documented in PROTOCOL.md and DECISIONS.md: discards are
    # logged and excluded from the paired analysis. The discard count is
    # reported alongside the analyzable N so the dataset's
    # post-discard size is auditable from the analysis output alone.
    discarded: list[tuple[str, str]] = []
    config_a: list[PerObligation] = []
    config_b: list[PerObligation] = []
    for a, b in zip(full_config_a, full_config_b):
        if a.errored or b.errored:
            who = "A" if a.errored else "B"
            why = a.error_message if a.errored else b.error_message
            discarded.append((a.obligation_id, f"{who}: {why[:140]}"))
            continue
        config_a.append(a)
        config_b.append(b)

    if not config_a:
        raise ValueError("no analyzable obligations after discards; cannot run analysis")

    if len(discarded) > 0.10 * len(full_config_a):
        sys.stderr.write(
            f"WARNING: {len(discarded)}/{len(full_config_a)} obligations discarded "
            f"({100 * len(discarded) / len(full_config_a):.1f}%) — "
            f"above the 10% threshold; analysis still proceeds, but the close-out "
            f"must cite the elevated discard rate as a caveat on the result.\n"
        )

    pairs = [(a.pass_, b.pass_) for a, b in zip(config_a, config_b)]
    pass_test = mcnemar_test(pairs)
    cost_diffs = [b.dollars_billed - a.dollars_billed for a, b in zip(config_a, config_b)]
    wall_diffs = [b.wall_clock_ms - a.wall_clock_ms for a, b in zip(config_a, config_b)]
    llm_diffs = [b.llm_calls - a.llm_calls for a, b in zip(config_a, config_b)]
    cost_test = wilcoxon_signed_rank(cost_diffs)
    wall_test = wilcoxon_signed_rank([float(x) for x in wall_diffs])
    llm_test = wilcoxon_signed_rank([float(x) for x in llm_diffs])

    md = render_markdown(
        config_a,
        config_b,
        pass_test,
        cost_test,
        wall_test,
        llm_test,
        discarded=discarded,
        original_n=len(full_config_a),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md)
    print(f"wrote {out_path} (analyzed N={len(config_a)}, discarded={len(discarded)})")
    return 0


def synthetic_dataset(seed: int) -> tuple[list[PerObligation], list[PerObligation]]:
    """Build a synthetic paired dataset where the answer is known.

    Construction:
    - 30 obligations, 12A/11B/7C strata.
    - Config A: every obligation passes (100% pass rate, $0, ~6ms wall-clock, 0 LLM calls).
    - Config B: 12 obligations flipped to fail (40% yield), every obligation
      costs $0.20 billed, $0.30 token-est, ~120000 ms wall-clock, 1 LLM call.

    Expected results:
    - Pass-rate diff (B - A) point = -0.40 (B passes less often → catches more).
    - Wilcoxon on cost: significant positive median ($0.20 increase).
    - Wilcoxon on wall-clock: significant positive median (~120000 ms increase).
    - Wilcoxon on LLM calls: significant positive median (1 call increase).
    - All four comparisons should reject H0 even after Bonferroni.
    """
    strata = ["A"] * 12 + ["B"] * 11 + ["C"] * 7
    rng = random.Random(seed)
    fail_ids = set(rng.sample(range(30), 12))
    a: list[PerObligation] = []
    b: list[PerObligation] = []
    for i in range(30):
        oid = f"S{i+1}"
        a.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            pass_=True,
            dollars_billed=0.0,
            dollars_token_estimate=0.0,
            wall_clock_ms=6,
            llm_calls=0,
            errored=False,
            error_message="",
        ))
        b.append(PerObligation(
            obligation_id=oid,
            stratum=strata[i],
            pass_=(i not in fail_ids),
            dollars_billed=0.20,
            dollars_token_estimate=0.30,
            wall_clock_ms=120000,
            llm_calls=1,
            errored=False,
            error_message="",
        ))
    return a, b


def self_test() -> int:
    a, b = synthetic_dataset(seed=42)
    pairs = [(x.pass_, y.pass_) for x, y in zip(a, b)]
    pass_test = mcnemar_test(pairs)
    cost_diffs = [y.dollars_billed - x.dollars_billed for x, y in zip(a, b)]
    wall_diffs = [float(y.wall_clock_ms - x.wall_clock_ms) for x, y in zip(a, b)]
    llm_diffs = [float(y.llm_calls - x.llm_calls) for x, y in zip(a, b)]
    cost_test = wilcoxon_signed_rank(cost_diffs)
    wall_test = wilcoxon_signed_rank(wall_diffs)
    llm_test = wilcoxon_signed_rank(llm_diffs)

    failures: list[str] = []

    # Expected: B fails 12 times, A fails 0 times → b=0, c=12.
    if pass_test.b != 0 or pass_test.c != 12:
        failures.append(f"pass_test discordant counts wrong: b={pass_test.b}, c={pass_test.c}, expected b=0, c=12")
    if pass_test.diff_ci.point != -12 / 30:
        failures.append(f"pass_test diff point wrong: {pass_test.diff_ci.point}, expected -0.4")
    # 12 / 12 splits 12-0 under exact binomial: p = 2 * 0.5 ** 12 = 4.88e-4
    if not (pass_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"pass_test p_value not significant: {pass_test.p_value}")
    if not (bonferroni(pass_test.p_value) < FAMILY_WISE_ALPHA):
        failures.append(f"pass_test Bonferroni-corrected p not significant: {bonferroni(pass_test.p_value)}")

    # Cost diff median = 0.20.
    if abs(cost_test.median_diff - 0.20) > 1e-9:
        failures.append(f"cost median diff wrong: {cost_test.median_diff}, expected 0.20")
    if not (cost_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"cost p_value not significant: {cost_test.p_value}")

    # Wall-clock diff median ≈ 119994 (120000 - 6).
    if abs(wall_test.median_diff - (120000 - 6)) > 1:
        failures.append(f"wall-clock median diff wrong: {wall_test.median_diff}")
    if not (wall_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"wall-clock p_value not significant: {wall_test.p_value}")

    # LLM-calls diff median = 1.
    if abs(llm_test.median_diff - 1) > 1e-9:
        failures.append(f"llm median diff wrong: {llm_test.median_diff}")
    if not (llm_test.p_value < PER_COMPARISON_ALPHA):
        failures.append(f"llm p_value not significant: {llm_test.p_value}")

    if failures:
        print("SELF-TEST FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("SELF-TEST PASSED")
    print(f"  pass-rate B-A = {pass_test.diff_ci.point:+.4f}, p={pass_test.p_value:.6f} -> Bonferroni p={bonferroni(pass_test.p_value):.6f}")
    print(f"  cost median  B-A = ${cost_test.median_diff:+.4f}, p={cost_test.p_value:.6e} -> Bonferroni p={bonferroni(cost_test.p_value):.6e}")
    print(f"  wall median  B-A = {wall_test.median_diff:+.0f} ms, p={wall_test.p_value:.6e} -> Bonferroni p={bonferroni(wall_test.p_value):.6e}")
    print(f"  llm median   B-A = {llm_test.median_diff:+.2f} calls, p={llm_test.p_value:.6e} -> Bonferroni p={bonferroni(llm_test.p_value):.6e}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-a", default=str(DEFAULT_CONFIG_A))
    parser.add_argument("--config-b", default=str(DEFAULT_CONFIG_B))
    parser.add_argument("--obligations", default=str(DEFAULT_OBLIGATIONS))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    return run_real_analysis(args)


if __name__ == "__main__":
    sys.exit(main())
