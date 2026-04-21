#!/usr/bin/env python3
"""
Per-pattern pass-rate breakdown for constraint-binding runs.

Input: a results directory containing one subdir per producer (ORCHESTRATOR/,
SINGLE_SHOT/, LADDER/, ...). Each subdir contains run-*/ directories with a
constraint-binding-score.json artifact written by the harness.

Output (stdout): a markdown table, pass-rate per (pattern, producer), plus the
overall rate per producer. Exits nonzero if the input directory is empty or
malformed.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def load_scores(results_dir: Path) -> list[dict]:
    rows: list[dict] = []
    for producer_dir in sorted(p for p in results_dir.iterdir() if p.is_dir()):
        for run_dir in sorted(r for r in producer_dir.iterdir() if r.is_dir()):
            score_path = run_dir / "constraint-binding-score.json"
            if not score_path.exists():
                continue
            try:
                score = json.loads(score_path.read_text())
            except json.JSONDecodeError as err:
                print(
                    f"WARN: invalid JSON in {score_path}: {err}",
                    file=sys.stderr,
                )
                continue
            rows.append(
                {
                    "producer": producer_dir.name,
                    "run": run_dir.name,
                    "task_id": score.get("task_id", "?"),
                    "pattern": score.get("pattern", "?"),
                    "passed": bool(score.get("passed")),
                }
            )
    return rows


def render(rows: list[dict]) -> str:
    if not rows:
        return "No constraint-binding scores found."
    # group counts: (pattern, producer) -> (pass, total)
    per_cell: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        cell = per_cell[(r["pattern"], r["producer"])]
        cell[1] += 1
        if r["passed"]:
            cell[0] += 1

    patterns = sorted({r["pattern"] for r in rows})
    producers = sorted({r["producer"] for r in rows})

    out: list[str] = []
    header = "| pattern | " + " | ".join(producers) + " |"
    sep = "|---" * (len(producers) + 1) + "|"
    out.append(header)
    out.append(sep)
    for pat in patterns:
        cells = []
        for prod in producers:
            p, t = per_cell.get((pat, prod), [0, 0])
            cells.append(f"{p}/{t} ({(p / t * 100) if t else 0:.0f}%)")
        out.append("| " + pat + " | " + " | ".join(cells) + " |")

    out.append("")
    overall: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        ov = overall[r["producer"]]
        ov[1] += 1
        if r["passed"]:
            ov[0] += 1
    out.append("### Overall")
    for prod in producers:
        p, t = overall[prod]
        pct = (p / t * 100) if t else 0
        out.append(f"- **{prod}**: {p}/{t} ({pct:.1f}%)")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results_dir", type=Path)
    parser.add_argument(
        "--json", action="store_true", help="emit machine-readable JSON instead of markdown",
    )
    args = parser.parse_args()

    if not args.results_dir.is_dir():
        print(f"ERROR: not a directory: {args.results_dir}", file=sys.stderr)
        return 2

    rows = load_scores(args.results_dir)
    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        print(render(rows))
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
