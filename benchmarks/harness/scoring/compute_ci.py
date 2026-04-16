#!/usr/bin/env python3
"""
compute_ci.py — Compute mean ± 95% confidence intervals from repeated benchmark runs.

Usage:
  python3 compute_ci.py <directory-containing-benchmark-score-json-files>
  python3 compute_ci.py benchmarks/harness/raw_data/

Reads all benchmark-score.json files (or eval-*.json files from SWE-bench)
and produces a statistical summary with mean ± 95% CI for every metric.

Output: JSON to stdout + statistical_summary.json in the input directory.
"""

import json
import math
import sys
from pathlib import Path

try:
    from scipy import stats as scipy_stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def confidence_interval_95(values: list[float]) -> dict:
    """Compute mean ± 95% CI using t-distribution."""
    # Filter out None/null values
    clean = [v for v in values if v is not None and v != "null"]
    n = len(clean)

    if n == 0:
        return {"mean": None, "ci_lower": None, "ci_upper": None, "n": 0, "std": None}
    if n == 1:
        return {"mean": clean[0], "ci_lower": clean[0], "ci_upper": clean[0], "n": 1, "std": 0.0}

    mean = sum(clean) / n
    variance = sum((x - mean) ** 2 for x in clean) / (n - 1)
    std = math.sqrt(variance)
    stderr = std / math.sqrt(n)

    if HAS_SCIPY:
        t_crit = scipy_stats.t.ppf(0.975, df=n - 1)
    else:
        # Lookup table for common sample sizes
        t_table = {
            2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571,
            7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262, 11: 2.228,
            12: 2.201, 13: 2.179, 14: 2.160, 15: 2.145, 20: 2.093,
            25: 2.064, 30: 2.045, 40: 2.021, 60: 2.000, 120: 1.980,
        }
        t_crit = t_table.get(n, 1.96)

    margin = t_crit * stderr

    return {
        "mean": round(mean, 4),
        "ci_lower": round(mean - margin, 4),
        "ci_upper": round(mean + margin, 4),
        "n": n,
        "std": round(std, 4),
    }


def load_scores(data_dir: Path) -> list[dict]:
    """Load all benchmark-score.json and eval-*.json files."""
    scores = []

    # Benchmark harness scores
    for f in sorted(data_dir.rglob("benchmark-score.json")):
        with open(f) as fh:
            data = json.load(fh)
            if "metrics" in data:
                scores.append(data["metrics"])

    # SWE-bench evaluation results
    for f in sorted(data_dir.rglob("eval-*.json")):
        with open(f) as fh:
            data = json.load(fh)
            scores.append({
                "swebench_resolve_pct": data.get("percent_resolved"),
                "swebench_mean_latency": data.get("mean_latency_seconds"),
                "swebench_resolved": data.get("resolved"),
                "swebench_total": data.get("total"),
            })

    return scores


def aggregate_metrics(scores: list[dict]) -> dict:
    """Compute CI for every numeric metric across all runs."""
    if not scores:
        return {"error": "No score files found"}

    # Collect all metric keys
    all_keys = set()
    for s in scores:
        all_keys.update(s.keys())

    summary = {}
    for key in sorted(all_keys):
        values = []
        for s in scores:
            v = s.get(key)
            if isinstance(v, (int, float)):
                values.append(float(v))
        if values:
            summary[key] = confidence_interval_95(values)

    return summary


def render_markdown(summary: dict, num_scores: int) -> str:
    """Render the statistical summary as Markdown."""
    lines = [
        "# Statistical Summary",
        "",
        f"> Generated from {num_scores} scored run(s).",
        f"> Computed on {__import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.",
        "",
        "## Metrics (mean ± 95% CI)",
        "",
        "| Metric | N | Mean | 95% CI Lower | 95% CI Upper | Std Dev |",
        "|--------|---|------|-------------|-------------|---------|",
    ]

    for key, stats in sorted(summary.items()):
        if isinstance(stats, dict) and "mean" in stats:
            mean = stats["mean"] if stats["mean"] is not None else "—"
            lo = stats["ci_lower"] if stats["ci_lower"] is not None else "—"
            hi = stats["ci_upper"] if stats["ci_upper"] is not None else "—"
            std = stats["std"] if stats["std"] is not None else "—"
            n = stats.get("n", 0)
            lines.append(f"| {key} | {n} | {mean} | {lo} | {hi} | {std} |")

    lines.extend([
        "",
        "## Interpretation",
        "",
        "- **N** = number of runs contributing data for that metric.",
        "- **95% CI** = confidence interval computed via t-distribution (exact for small N).",
        "- Metrics with N < 10 should be treated as preliminary.",
        "- A wider CI indicates higher variance across runs (non-determinism).",
        "",
        "## How to Add More Runs",
        "",
        "```bash",
        "# Score a completed run",
        "./benchmarks/harness/scoring/score.sh ./runs/<execution-id>",
        "",
        "# Re-compute summary with all available scores",
        "python3 benchmarks/harness/scoring/compute_ci.py ./runs/",
        "```",
    ])

    return "\n".join(lines) + "\n"


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    scores = load_scores(data_dir)
    print(f"Loaded {len(scores)} score files from {data_dir}")

    if not scores:
        print("No benchmark-score.json or eval-*.json files found.", file=sys.stderr)
        sys.exit(1)

    summary = aggregate_metrics(scores)

    # Write JSON
    output_json = data_dir / "statistical_summary.json"
    with open(output_json, "w") as f:
        json.dump({"num_runs": len(scores), "metrics": summary}, f, indent=2)
    print(f"JSON: {output_json}")

    # Write Markdown
    md_content = render_markdown(summary, len(scores))
    harness_dir = Path(__file__).parent.parent
    md_path = harness_dir / "statistical_summary.md"
    with open(md_path, "w") as f:
        f.write(md_content)
    print(f"Markdown: {md_path}")

    # Also print summary
    print(json.dumps({"num_runs": len(scores), "metrics": summary}, indent=2))


if __name__ == "__main__":
    main()
