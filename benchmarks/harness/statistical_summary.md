# Statistical Summary

> **Not yet generated.** This file is a placeholder. Run the following after accumulating ≥ 10 runs per producer:
>
> ```bash
> python3 benchmarks/harness/scoring/compute_ci.py benchmarks/harness/raw_data/runs/
> ```
>
> The previous contents (10 orchestrator-only runs from 2026-04-17) were removed because:
> 1. They predated the check-script bug fixes (B1–B5) and rubric-runner path fix.
> 2. The `premium_requests_actual` metric was broken (D5 — always equals completed step count).
> 3. Self-declared-stale data under a file named `statistical_summary.md` gets cited regardless of caveats.
