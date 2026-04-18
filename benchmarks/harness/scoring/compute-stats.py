#!/usr/bin/env python3
"""
compute-stats.py — Compute mean, std, and 95% bootstrap CI from a metrics.jsonl.

Bootstrap CI is used instead of the t-distribution because:
  * We do not assume normality.
  * Small-n estimates from a skewed wall-clock distribution benefit from
    resampling more than from the t-approximation.

Usage:
  python3 compute-stats.py <path-to-metrics.jsonl> [--out <markdown-file>]

Outputs a markdown table to stdout and (if --out given) writes a full
statistical summary markdown file including an appendix with every per-run
raw value.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from pathlib import Path


METRIC_KEYS = [
    "wall_clock_ms",
    "exit_status",
    "completed_steps",
    "total_steps",
    "commit_count",
    "actual_premium_requests",
    "estimated_premium_requests",
]


def load_runs(path: Path) -> list[dict]:
    runs = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            runs.append(json.loads(line))
    return runs


def bootstrap_ci(values: list[float], iters: int = 10_000, alpha: float = 0.05,
                 seed: int = 1) -> tuple[float, float]:
    """Percentile bootstrap CI for the mean."""
    if not values:
        return (float("nan"), float("nan"))
    if len(values) == 1:
        return (values[0], values[0])
    rng = random.Random(seed)
    n = len(values)
    means: list[float] = []
    for _ in range(iters):
        sample = [values[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    lo_idx = max(0, int(math.floor(iters * (alpha / 2))))
    hi_idx = min(iters - 1, int(math.ceil(iters * (1 - alpha / 2))) - 1)
    return (means[lo_idx], means[hi_idx])


def summarize(values: list[float]) -> dict:
    clean = [v for v in values if isinstance(v, (int, float))]
    n = len(clean)
    if n == 0:
        return {"n": 0}
    mean = statistics.fmean(clean)
    std = statistics.pstdev(clean) if n == 1 else statistics.stdev(clean)
    ci_lo, ci_hi = bootstrap_ci(clean)
    return {
        "n": n,
        "mean": round(mean, 4),
        "std": round(std, 4),
        "ci95_lower": round(ci_lo, 4),
        "ci95_upper": round(ci_hi, 4),
        "min": min(clean),
        "max": max(clean),
    }


def fmt_table(stats: dict[str, dict]) -> str:
    lines = ["| Metric | n | Mean | Std | 95% CI (bootstrap) | Min | Max |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for k, s in stats.items():
        if s.get("n", 0) == 0:
            lines.append(f"| {k} | 0 | — | — | — | — | — |")
            continue
        lines.append(
            f"| {k} | {s['n']} | {s['mean']} | {s['std']} | "
            f"[{s['ci95_lower']}, {s['ci95_upper']}] | {s['min']} | {s['max']} |"
        )
    return "\n".join(lines)


def fmt_appendix(runs: list[dict]) -> str:
    cols = ["run_index", "wall_clock_ms", "exit_status", "completed_steps",
            "total_steps", "commit_count", "actual_premium_requests",
            "estimated_premium_requests"]
    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    rows = []
    for r in runs:
        rows.append("| " + " | ".join(str(r.get(c, "")) for c in cols) + " |")
    return "\n".join([header, sep, *rows])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("--out", type=Path, help="write markdown summary to this path")
    ap.add_argument("--benchmark", type=str, default="", help="label shown in the summary")
    args = ap.parse_args()

    runs = load_runs(args.jsonl)
    if not runs:
        print(f"ERROR: no runs in {args.jsonl}", file=sys.stderr)
        return 1

    stats = {k: summarize([r.get(k) for r in runs]) for k in METRIC_KEYS}
    table = fmt_table(stats)

    print(table)

    if args.out:
        n = len(runs)
        lines: list[str] = []
        lines.append(f"# Statistical Summary — {args.benchmark or args.jsonl.stem}")
        lines.append("")
        lines.append(f"- Source: `{args.jsonl}`")
        lines.append(f"- Runs (N): **{n}**")
        lines.append(f"- CI method: percentile bootstrap, 10,000 resamples, α = 0.05")
        lines.append(f"- Why bootstrap: no normality assumption; wall-clock and retry counts are skewed in practice.")
        lines.append("")
        lines.append("## Aggregate metrics")
        lines.append("")
        lines.append(table)
        lines.append("")
        lines.append("## Notes")
        lines.append("")
        lines.append("- `wall_clock_ms` is the full `swarm demo demo-fast` wall time (spawn → merge).")
        lines.append("- `completed_steps` / `total_steps`: counts of steps that produced a recorded per-step cost entry.")
        lines.append("- `commit_count`: unique commits attributed by the metrics collector (agent commits only).")
        lines.append("- `actual_premium_requests` comes from the D5 parser fix (parseCopilotRequestCount) — billing-accurate count.")
        lines.append("- `estimated_premium_requests` is the CostEstimator's pre-run estimate for the plan.")
        lines.append("")
        lines.append("## Appendix: per-run raw values")
        lines.append("")
        lines.append(fmt_appendix(runs))
        lines.append("")
        args.out.write_text("\n".join(lines))
        print(f"\nWrote: {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
