#!/usr/bin/env python3
"""
Collect and aggregate results from multiple SWE-bench evaluation runs.

Usage:
  python3 collect_results.py [results_dir]

Reads all eval-*.json files from the results directory and produces
an aggregated summary with per-metric mean ± 95% confidence intervals.
"""

import json
import math
import sys
from pathlib import Path

# scipy may not be available in minimal environments
try:
    from scipy import stats as scipy_stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def load_runs(results_dir: Path) -> list[dict]:
    """Load all evaluation result files.

    D10: Warns when docker_image_digest is missing (indicates the run
    may not have been produced in a controlled Docker environment).
    """
    files = sorted(results_dir.glob("eval-*.json"))
    runs = []
    for f in files:
        with open(f) as fh:
            data = json.load(fh)
        if "docker_image_digest" not in data:
            print(f"WARNING: {f.name} has no docker_image_digest — "
                  "provenance cannot be verified. Consider re-running "
                  "under Docker.", file=sys.stderr)
        runs.append(data)
    return runs


def confidence_interval_95(values: list[float]) -> tuple[float, float, float]:
    """Return (mean, ci_lower, ci_upper) for 95% CI using t-distribution."""
    n = len(values)
    if n < 2:
        mean = values[0] if values else 0.0
        return mean, mean, mean

    mean = sum(values) / n
    variance = sum((x - mean) ** 2 for x in values) / (n - 1)
    stderr = math.sqrt(variance / n)

    if HAS_SCIPY:
        t_crit = scipy_stats.t.ppf(0.975, df=n - 1)
    else:
        # Approximation for small n (fallback without scipy)
        t_table = {2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571,
                   7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262, 15: 2.145,
                   20: 2.093, 30: 2.045, 60: 2.000, 120: 1.980}
        t_crit = t_table.get(n, 1.96)

    margin = t_crit * stderr
    return round(mean, 4), round(mean - margin, 4), round(mean + margin, 4)


def aggregate(runs: list[dict]) -> dict:
    """Aggregate metrics across runs."""
    if not runs:
        return {"error": "No runs found"}

    pct_resolved = [r["percent_resolved"] for r in runs]
    latencies = [r["mean_latency_seconds"] for r in runs]

    # Per-task resolution rates
    task_ids = set()
    for r in runs:
        for t in r.get("tasks", []):
            task_ids.add(t["instance_id"])

    task_resolution = {}
    for tid in sorted(task_ids):
        resolved_count = sum(
            1 for r in runs
            for t in r.get("tasks", [])
            if t["instance_id"] == tid and t.get("resolved")
        )
        total_count = sum(
            1 for r in runs
            for t in r.get("tasks", [])
            if t["instance_id"] == tid
        )
        task_resolution[tid] = {
            "resolved_runs": resolved_count,
            "total_runs": total_count,
            "rate": round(resolved_count / max(total_count, 1), 4),
        }

    pct_mean, pct_lo, pct_hi = confidence_interval_95(pct_resolved)
    lat_mean, lat_lo, lat_hi = confidence_interval_95(latencies)

    return {
        "num_runs": len(runs),
        "dataset": runs[0].get("dataset", "unknown"),
        "mode": runs[0].get("mode", "unknown"),
        "tool": runs[0].get("tool", "unknown"),
        "model": runs[0].get("model", "unknown"),
        "percent_resolved": {
            "mean": pct_mean,
            "ci_95_lower": pct_lo,
            "ci_95_upper": pct_hi,
        },
        "mean_latency_seconds": {
            "mean": lat_mean,
            "ci_95_lower": lat_lo,
            "ci_95_upper": lat_hi,
        },
        "per_task": task_resolution,
    }


def main():
    results_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/app/results")
    runs = load_runs(results_dir)
    print(f"Loaded {len(runs)} evaluation runs from {results_dir}")

    summary = aggregate(runs)

    output_file = results_dir / "aggregated_summary.json"
    with open(output_file, "w") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))
    print(f"\nWritten to {output_file}")


if __name__ == "__main__":
    main()
