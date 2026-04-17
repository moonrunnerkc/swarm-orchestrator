#!/usr/bin/env python3
"""
D1: Statistical comparison of producers.

Reads run results from benchmarks/harness/raw_data/runs/<PRODUCER>/run-*/
and performs paired Wilcoxon signed-rank tests on cost-to-completion and
rubric completeness between producers.

Outputs:
  - stat_test_results.json    (machine-readable)
  - stat_test_summary.md      (human-readable)

Usage:
  python3 stat_test.py <results_dir>
  python3 stat_test.py benchmarks/harness/raw_data/runs

Requires: scipy, numpy (install via: pip install scipy numpy)
"""
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

try:
    from scipy import stats as sp_stats
except ImportError:
    print("ERROR: scipy is required. Install with: pip install scipy", file=sys.stderr)
    sys.exit(1)


def load_runs(producer_dir: Path) -> list[dict[str, Any]]:
    """Load all run results for a producer, keyed by task_id."""
    runs: list[dict[str, Any]] = []
    if not producer_dir.is_dir():
        return runs

    for run_dir in sorted(producer_dir.iterdir()):
        if not run_dir.is_dir() or not run_dir.name.startswith("run-"):
            continue

        meta_path = run_dir / "run-meta.json"
        cost_path = run_dir / "cost-attribution.json"
        score_path = run_dir / "rubric-score.json"
        label_path = run_dir / "label.json"

        meta = _safe_json(meta_path)
        cost = _safe_json(cost_path)
        score = _safe_json(score_path)
        label = _safe_json(label_path)

        task_id = meta.get("task_id", "unknown") if meta else "unknown"
        run_label = label.get("label", "COMPLETED") if label else "COMPLETED"

        runs.append({
            "run_dir": str(run_dir),
            "task_id": task_id,
            "label": run_label,
            "premium_requests": _extract_premium_requests(cost),
            "rubric_score": _extract_rubric_score(score),
            "elapsed_seconds": meta.get("elapsed_seconds", None) if meta else None,
        })

    return runs


def _safe_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _extract_premium_requests(cost: dict | None) -> float | None:
    if not cost:
        return None
    return cost.get("totalActualPremiumRequests", cost.get("totalEstimatedPremiumRequests"))


def _extract_rubric_score(score: dict | None) -> float | None:
    if not score:
        return None
    return score.get("rubric_score")


def pair_runs(runs_a: list[dict], runs_b: list[dict]) -> list[tuple[dict, dict]]:
    """Pair runs by task_id in order of appearance (run index matching)."""
    # Group by task_id
    by_task_a: dict[str, list[dict]] = {}
    by_task_b: dict[str, list[dict]] = {}
    for r in runs_a:
        by_task_a.setdefault(r["task_id"], []).append(r)
    for r in runs_b:
        by_task_b.setdefault(r["task_id"], []).append(r)

    pairs = []
    for task_id in by_task_a:
        if task_id not in by_task_b:
            continue
        list_a = by_task_a[task_id]
        list_b = by_task_b[task_id]
        for a, b in zip(list_a, list_b):
            pairs.append((a, b))
    return pairs


def wilcoxon_test(
    pairs: list[tuple[dict, dict]],
    metric: str,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Run paired Wilcoxon signed-rank test on a metric.

    Returns dict with statistic, p_value, n, significant, and effect size (r).
    """
    diffs = []
    for a, b in pairs:
        va = a.get(metric)
        vb = b.get(metric)
        if va is not None and vb is not None:
            diffs.append(va - vb)

    n = len(diffs)
    if n < 6:
        return {
            "metric": metric,
            "n": n,
            "error": f"Insufficient paired observations ({n} < 6 minimum for Wilcoxon)",
            "statistic": None,
            "p_value": None,
            "significant": False,
            "effect_size_r": None,
        }

    arr = np.array(diffs)
    try:
        result = sp_stats.wilcoxon(arr, alternative="two-sided")
        statistic = float(result.statistic)
        p_value = float(result.pvalue)
    except ValueError as e:
        return {
            "metric": metric,
            "n": n,
            "error": str(e),
            "statistic": None,
            "p_value": None,
            "significant": False,
            "effect_size_r": None,
        }

    # Effect size: r = Z / sqrt(N)  where Z = (W - mean) / std of W under H0
    # Approximation: r = statistic / (n * (n+1) / 2) ... simpler: use Z from p
    from scipy.stats import norm
    z_score = float(norm.ppf(1 - p_value / 2)) if p_value < 1.0 else 0.0
    effect_size_r = z_score / np.sqrt(n) if n > 0 else 0.0

    return {
        "metric": metric,
        "n": n,
        "statistic": statistic,
        "p_value": p_value,
        "significant": p_value < alpha,
        "effect_size_r": round(float(effect_size_r), 4),
        "mean_diff": round(float(np.mean(arr)), 4),
        "median_diff": round(float(np.median(arr)), 4),
    }


def bonferroni_correct(results: list[dict], num_comparisons: int) -> list[dict]:
    """Apply Bonferroni correction to p-values."""
    for r in results:
        if r.get("p_value") is not None:
            r["p_value_bonferroni"] = min(1.0, r["p_value"] * num_comparisons)
            r["significant_bonferroni"] = r["p_value_bonferroni"] < 0.05
    return results


def descriptive_stats(runs: list[dict], metric: str) -> dict[str, Any]:
    """Compute mean, median, std, 95% CI for a metric."""
    values = [r.get(metric) for r in runs if r.get(metric) is not None]
    if not values:
        return {"n": 0, "mean": None, "median": None, "std": None, "ci_95": None}

    arr = np.array(values)
    n = len(arr)
    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else 0.0
    ci_margin = 1.96 * std / np.sqrt(n) if n > 1 else 0.0

    return {
        "n": n,
        "mean": round(mean, 4),
        "median": round(float(np.median(arr)), 4),
        "std": round(std, 4),
        "ci_95": [round(mean - ci_margin, 4), round(mean + ci_margin, 4)],
    }


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <results_dir>", file=sys.stderr)
        sys.exit(1)

    results_dir = Path(sys.argv[1])
    producers = sorted([
        d.name for d in results_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    ])

    if len(producers) < 2:
        print(f"Need at least 2 producers in {results_dir}, found: {producers}", file=sys.stderr)
        sys.exit(1)

    print(f"Producers found: {producers}")

    # Load all runs
    all_runs: dict[str, list[dict]] = {}
    for p in producers:
        all_runs[p] = load_runs(results_dir / p)
        print(f"  {p}: {len(all_runs[p])} runs")

    # Pairwise comparisons
    metrics = ["premium_requests", "rubric_score", "elapsed_seconds"]
    comparisons = []
    for i, pa in enumerate(producers):
        for pb in producers[i + 1:]:
            comparisons.append((pa, pb))

    num_tests = len(comparisons) * len(metrics)
    all_results: list[dict] = []

    for pa, pb in comparisons:
        pairs = pair_runs(all_runs[pa], all_runs[pb])
        print(f"\n{pa} vs {pb}: {len(pairs)} paired observations")

        for metric in metrics:
            result = wilcoxon_test(pairs, metric)
            result["producer_a"] = pa
            result["producer_b"] = pb
            all_results.append(result)

    # Bonferroni correction
    bonferroni_correct(all_results, num_tests)

    # Descriptive stats per producer
    desc_stats: dict[str, dict] = {}
    for p in producers:
        desc_stats[p] = {}
        for metric in metrics:
            desc_stats[p][metric] = descriptive_stats(all_runs[p], metric)

    # Write JSON output
    output = {
        "producers": producers,
        "pairwise_tests": all_results,
        "descriptive_stats": desc_stats,
        "bonferroni_num_comparisons": num_tests,
        "minimum_recommended_n": 30,
        "notes": [
            "Wilcoxon signed-rank test (two-sided) on paired observations matched by task_id",
            "Bonferroni correction applied for multiple comparisons",
            "Effect size r = Z / sqrt(N); small=0.1, medium=0.3, large=0.5",
            "N >= 30 per producer per task recommended for reliable inference",
        ],
    }

    out_path = results_dir / "stat_test_results.json"
    out_path.write_text(json.dumps(output, indent=2))
    print(f"\nWrote: {out_path}")

    # Write markdown summary
    md_path = results_dir / "stat_test_summary.md"
    md_lines = [
        "# Statistical Test Summary",
        "",
        f"Generated: {__import__('datetime').datetime.now(tz=__import__('datetime').timezone.utc).isoformat()}",
        "",
        "## Descriptive Statistics",
        "",
    ]

    for p in producers:
        md_lines.append(f"### {p}")
        md_lines.append("")
        md_lines.append("| Metric | N | Mean | Median | Std | 95% CI |")
        md_lines.append("|--------|---|------|--------|-----|--------|")
        for metric in metrics:
            s = desc_stats[p][metric]
            ci = f"[{s['ci_95'][0]}, {s['ci_95'][1]}]" if s["ci_95"] else "—"
            md_lines.append(
                f"| {metric} | {s['n']} | {s['mean']} | {s['median']} | {s['std']} | {ci} |"
            )
        md_lines.append("")

    md_lines.extend([
        "## Pairwise Comparisons (Wilcoxon Signed-Rank)",
        "",
        f"Bonferroni correction applied for {num_tests} tests.",
        "",
        "| A vs B | Metric | N | W | p (raw) | p (Bonf.) | Sig? | Effect r | Mean Δ |",
        "|--------|--------|---|---|---------|-----------|------|----------|--------|",
    ])

    for r in all_results:
        sig = "✓" if r.get("significant_bonferroni") else "✗"
        w = r.get("statistic", "—")
        p_raw = f"{r['p_value']:.4f}" if r.get("p_value") is not None else "—"
        p_bonf = f"{r['p_value_bonferroni']:.4f}" if r.get("p_value_bonferroni") is not None else "—"
        eff = r.get("effect_size_r", "—")
        md = r.get("mean_diff", "—")
        err = f" ({r['error']})" if r.get("error") else ""
        md_lines.append(
            f"| {r['producer_a']} vs {r['producer_b']} | {r['metric']} | "
            f"{r['n']} | {w} | {p_raw} | {p_bonf} | {sig} | {eff} | {md}{err} |"
        )

    md_lines.extend([
        "",
        "## Interpretation Guide",
        "",
        "- **Significant (Bonferroni)**: p < 0.05 after correction for multiple comparisons",
        "- **Effect size r**: small (0.1), medium (0.3), large (0.5)",
        "- **Mean Δ**: A minus B; negative = A is lower (better for cost, worse for score)",
        "- Minimum recommended: N ≥ 30 paired observations per comparison",
        "",
        "## Risks",
        "",
        "- Non-determinism: LLM outputs vary across runs. Confidence intervals reflect this.",
        "- Stall-deaths inflate elapsed_seconds. Filter by run label for clean comparisons.",
        "- Cost is an estimate (premium request count), not a dollar figure.",
    ])

    md_path.write_text("\n".join(md_lines))
    print(f"Wrote: {md_path}")


if __name__ == "__main__":
    main()
