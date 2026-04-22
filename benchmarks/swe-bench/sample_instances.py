#!/usr/bin/env python3
"""
Produce a stratified, deterministic 50-instance sample from SWE-bench Verified.

The sample is:
  - Stratified by `repo` (so no single project dominates)
  - Deterministic: a documented `seed` drives random.shuffle per stratum
  - Reproducible: re-running with the same seed against the same dataset
    version returns the same 50 instance_ids

Output: writes `instances-50.json` next to this script with:
  {
    "source": "princeton-nlp/SWE-bench_Verified",
    "sample_size": 50,
    "seed": 42,
    "generated_at": "<ISO8601>",
    "per_repo_counts": { "<repo>": <n>, ... },
    "instance_ids": [ "<id>", ... ]
  }

Run inside the eval container:
  docker run --rm -v "$PWD/benchmarks/swe-bench:/app/out" swe-bench-eval:phase4a \
    python3 /app/out/sample_instances.py --out /app/out/instances-50.json
"""
from __future__ import annotations

import argparse
import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path

try:
    from datasets import load_dataset  # type: ignore
except ImportError:
    raise SystemExit(
        "datasets library required. Run inside the swe-bench-eval container "
        "or `pip install datasets`."
    )

DATASET = "princeton-nlp/SWE-bench_Verified"
DEFAULT_SEED = 42
SAMPLE_SIZE = 50


def stratified_sample(records: list[dict], sample_size: int, seed: int) -> list[dict]:
    """Stratify by `repo` column, taking a proportional share from each.

    Fractional shares round via largest-remainders so the total lands exactly
    at sample_size without cherry-picking. Within each repo the selection is
    random.shuffle(seeded), take-first-N.
    """
    total = len(records)
    per_repo: dict[str, list[dict]] = {}
    for rec in records:
        per_repo.setdefault(rec["repo"], []).append(rec)

    # Ideal float share per repo
    shares = {repo: sample_size * len(items) / total for repo, items in per_repo.items()}
    # Floor + remainder
    allocations = {repo: int(math.floor(v)) for repo, v in shares.items()}
    remainders = sorted(
        ((repo, shares[repo] - allocations[repo]) for repo in shares),
        key=lambda kv: (-kv[1], kv[0]),
    )
    while sum(allocations.values()) < sample_size:
        repo, _ = remainders.pop(0)
        allocations[repo] += 1

    rng = random.Random(seed)
    picked: list[dict] = []
    for repo in sorted(per_repo):
        pool = list(per_repo[repo])
        rng.shuffle(pool)
        picked.extend(pool[: allocations[repo]])

    picked.sort(key=lambda r: r["instance_id"])
    return picked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    dataset = load_dataset(DATASET, split="test")
    records = [dict(r) for r in dataset]
    picked = stratified_sample(records, SAMPLE_SIZE, args.seed)

    per_repo_counts: dict[str, int] = {}
    for r in picked:
        per_repo_counts[r["repo"]] = per_repo_counts.get(r["repo"], 0) + 1

    payload = {
        "source": DATASET,
        "dataset_split": "test",
        "sample_size": len(picked),
        "seed": args.seed,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stratification": "proportional by repo, largest-remainders rounding",
        "per_repo_counts": dict(sorted(per_repo_counts.items())),
        "instance_ids": [r["instance_id"] for r in picked],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {args.out} — {len(picked)} instances across {len(per_repo_counts)} repos")


if __name__ == "__main__":
    main()
