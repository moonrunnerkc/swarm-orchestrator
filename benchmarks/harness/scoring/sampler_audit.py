#!/usr/bin/env python3
"""
sampler_audit.py — Verify uniform task sampling across benchmark runs.

Loads all run-meta.json files from a runs directory and performs a
chi-square goodness-of-fit test for uniform distribution of task draws.

Usage:
  python3 sampler_audit.py <runs-directory>

Output: sampler_audit_result.json in the runs directory.
"""

import json
import sys
from collections import Counter
from pathlib import Path

try:
    from scipy.stats import chisquare
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def load_task_draws(runs_dir: Path) -> list[str]:
    """Extract task_id from each run-meta.json."""
    draws = []
    for meta_file in sorted(runs_dir.rglob("run-meta.json")):
        with open(meta_file) as f:
            meta = json.load(f)
            task_id = meta.get("task_id") or meta.get("taskId") or meta.get("benchmark_id", "unknown")
            draws.append(str(task_id))
    return draws


def audit_uniformity(draws: list[str]) -> dict:
    """Run chi-square test for uniform distribution."""
    counts = Counter(draws)
    task_ids = sorted(counts.keys())
    observed = [counts[t] for t in task_ids]
    n = sum(observed)
    k = len(task_ids)

    if k == 0:
        return {"error": "No task draws found", "uniform": False}

    expected_per_task = n / k

    # Check if N is a multiple of task count
    is_complete_cycles = n % k == 0

    result = {
        "total_draws": n,
        "num_tasks": k,
        "task_ids": task_ids,
        "observed_counts": dict(zip(task_ids, observed)),
        "expected_per_task": round(expected_per_task, 2),
        "is_complete_cycles": is_complete_cycles,
    }

    if HAS_SCIPY and k > 1:
        stat, p_value = chisquare(observed)
        result["chi_square_statistic"] = round(stat, 4)
        result["p_value"] = round(p_value, 4)
        result["uniform"] = p_value > 0.05
    else:
        # Manual chi-square
        chi2 = sum((o - expected_per_task) ** 2 / expected_per_task for o in observed)
        # For k-1 degrees of freedom, critical value at alpha=0.05:
        # df=7 -> 14.067
        df = k - 1
        crit_table = {1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070, 6: 12.592, 7: 14.067}
        crit = crit_table.get(df, 15.507)
        result["chi_square_statistic"] = round(chi2, 4)
        result["critical_value_0.05"] = crit
        result["uniform"] = chi2 < crit

    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: sampler_audit.py <runs-directory>", file=sys.stderr)
        sys.exit(1)

    runs_dir = Path(sys.argv[1])
    draws = load_task_draws(runs_dir)
    print(f"Found {len(draws)} task draws in {runs_dir}")

    result = audit_uniformity(draws)

    out_path = runs_dir / "sampler_audit_result.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Written: {out_path}")
    print(json.dumps(result, indent=2))

    if not result.get("uniform", False):
        print("WARNING: Task distribution is NOT uniform (p < 0.05)", file=sys.stderr)


if __name__ == "__main__":
    main()
