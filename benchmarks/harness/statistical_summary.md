# Statistical Summary — demo-fast (N=10)

- **Benchmark:** `demo-fast` (two-step hello-world swarm, one wave, no dependencies between steps)
- **Source:** `benchmarks/harness/raw_data/demo-fast/metrics.jsonl` (10 lines, one per run)
- **Runs (N):** **10** per-benchmark
- **CI method:** percentile bootstrap, 10,000 resamples, α = 0.05
- **Harness:** `benchmarks/harness/run-n.sh demo-fast 10` → `benchmarks/harness/scoring/compute-stats.py`
- **Hardware:** single workstation, wall-clock only (no sandboxed reproducibility lab)
- **Generated:** 2026-04-18, after the P0 auth fix and P3 parser fix landed

## Why bootstrap, not t-distribution

The existing `compute_ci.py` uses a t-distribution, which assumes the sample
mean is approximately normal. For small-n runs of a real benchmark that
includes LLM inference latency, git operations, and npm-install I/O, the
wall-clock distribution is right-skewed (a slow outlier pulls the mean). A
percentile bootstrap makes no normality assumption; it just reports what the
empirical sample-mean distribution actually looks like. With N=10 that's the
honest choice. The t-based `compute_ci.py` still exists and is fine for the
SWE-bench pipeline where N is much larger.

## Why N=10 for demo-fast only

The P2 task asked for N≥10 on at least one benchmark and permitted lower N
for more expensive benchmarks. `demo-fast` is the cheapest scenario in the
repo (2 trivial steps, ~80 seconds wall clock, 2 premium requests on
Copilot). Running N=10 fit in a single budget-bounded session (~14 min of
billable Copilot time). The three-producer `run_fresh.sh` SWE-bench and
ladder pipelines remain at their respective target N values in
[benchmarks/harness/run_fresh.sh](run_fresh.sh) — they are not padded here.
No synthetic runs. Every row in the appendix below is a real `swarm demo
demo-fast --yes --no-dashboard` execution.

## Aggregate metrics

| Metric | n | Mean | Std | 95% CI (bootstrap) | Min | Max |
| --- | --- | --- | --- | --- | --- | --- |
| wall_clock_ms | 10 | 84272.2 | 10628.3421 | [78446.5, 90931.2] | 71216 | 102401 |
| exit_status | 10 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 0 |
| completed_steps | 10 | 2.0 | 0.0 | [2.0, 2.0] | 2 | 2 |
| total_steps | 10 | 2.0 | 0.0 | [2.0, 2.0] | 2 | 2 |
| commit_count | 10 | 2.2 | 0.6325 | [1.8, 2.6] | 1 | 3 |
| actual_premium_requests | 10 | 2.0 | 0.0 | [2.0, 2.0] | 2 | 2 |
| estimated_premium_requests | 10 | 3.0 | 0.0 | [3.0, 3.0] | 3 | 3 |

### Reading the table

- **wall_clock_ms:** end-to-end `swarm demo demo-fast` time, from CLI
  invocation to final cleanup. Mean 84.3s with a 95% CI of [78.4, 90.9].
  Variance is dominated by Copilot inference latency and a small amount
  of git-merge overhead. Min 71s and max 102s bracket a ~44% spread.
- **exit_status:** 0 on every run after the P0 auth fix. Pre-fix this
  metric was 2-fails-out-of-2-always.
- **completed_steps / total_steps:** both flat at 2 — the plan had two
  independent steps and both were consistently reported as completed.
- **commit_count:** the metrics collector only records agent-attributed
  commits. Demo-fast agents produce 1-2 each, with occasional merge
  commits bumping total to 3. CI [1.8, 2.6].
- **actual_premium_requests:** Copilot reports 1 per session on these
  tasks; two steps × 1 = 2. Parsed by the new `parseCopilotRequestCount`
  (P3/D5) from the "Requests N Premium" stderr line, not hardcoded.
- **estimated_premium_requests:** constant 3 — the CostEstimator adds a
  15% retry buffer on top of the 2 steps.

## Known limitations of this dataset

- **N=10 is still small.** With bootstrap at α=0.05, the CI for wall-clock
  is [78.4s, 90.9s] — a real one-shot run outside that window is plausible.
- **Only one benchmark.** The harness supports more (`run-n.sh` takes the
  benchmark name) but only `demo-fast` is wired. Adding `api-quick` at N=3-5
  is the natural next step once there's budget for ~15 minutes of extra
  Copilot time.
- **Single machine, single time window.** Network latency variance to
  GitHub's Copilot backend contributes to wall-clock variance and is
  uncontrolled.
- **Trivial task → flat success metrics.** completed_steps, exit_status,
  and total_steps all have std=0 because demo-fast is designed as a
  smoke test. A harder benchmark would surface failure modes.

## How to reproduce

```bash
# Rebuild (the D5 fix lives in dist/)
npm run build

# Run N=10
bash benchmarks/harness/run-n.sh demo-fast 10

# Recompute stats + write the summary
python3 benchmarks/harness/scoring/compute-stats.py \
  benchmarks/harness/raw_data/demo-fast/metrics.jsonl \
  --benchmark demo-fast \
  --out benchmarks/harness/statistical_summary.md
```

Each run leaves its artifacts under
`benchmarks/harness/raw_data/demo-fast/run-<i>/` (stdout log + copies of
the run's `metrics.json` and `cost-attribution.json`), so any individual
data point can be re-examined.

## Appendix: per-run raw values

| run_index | wall_clock_ms | exit_status | completed_steps | total_steps | commit_count | actual_premium_requests | estimated_premium_requests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 76916 | 0 | 2 | 2 | 2 | 2 | 3 |
| 2 | 71216 | 0 | 2 | 2 | 3 | 2 | 3 |
| 3 | 83131 | 0 | 2 | 2 | 2 | 2 | 3 |
| 4 | 102401 | 0 | 2 | 2 | 3 | 2 | 3 |
| 5 | 76115 | 0 | 2 | 2 | 2 | 2 | 3 |
| 6 | 76300 | 0 | 2 | 2 | 2 | 2 | 3 |
| 7 | 84448 | 0 | 2 | 2 | 3 | 2 | 3 |
| 8 | 90082 | 0 | 2 | 2 | 2 | 2 | 3 |
| 9 | 80903 | 0 | 2 | 2 | 2 | 2 | 3 |
| 10 | 101210 | 0 | 2 | 2 | 1 | 2 | 3 |

### Run directories (for drill-down)

| run_index | run_dir |
| --- | --- |
| 1 | `/tmp/swarm-demo-demo-fast-vQaKJJ/runs/swarm-2026-04-18T22-20-17-497Z` |
| 2 | `/tmp/swarm-demo-demo-fast-JLJZhT/runs/swarm-2026-04-18T22-21-34-474Z` |
| 3 | `/tmp/swarm-demo-demo-fast-ozXipR/runs/swarm-2026-04-18T22-22-45-880Z` |
| 4 | `/tmp/swarm-demo-demo-fast-U4YWBR/runs/swarm-2026-04-18T22-24-09-688Z` |
| 5 | `/tmp/swarm-demo-demo-fast-G8i79K/runs/swarm-2026-04-18T22-25-51-417Z` |
| 6 | `/tmp/swarm-demo-demo-fast-osWkVC/runs/swarm-2026-04-18T22-27-07-559Z` |
| 7 | `/tmp/swarm-demo-demo-fast-rPY4D6/runs/swarm-2026-04-18T22-28-23-863Z` |
| 8 | `/tmp/swarm-demo-demo-fast-FWRmaV/runs/swarm-2026-04-18T22-29-48-392Z` |
| 9 | `/tmp/swarm-demo-demo-fast-4IEZ8t/runs/swarm-2026-04-18T22-31-18-539Z` |
| 10 | `/tmp/swarm-demo-demo-fast-bP0iRB/runs/swarm-2026-04-18T22-32-39-494Z` |

The run directories are on the local workstation; each contains
`metrics.json`, `cost-attribution.json`, per-step share transcripts, and
verification outputs. Copies of `metrics.json` and `cost-attribution.json`
are preserved under the repo at `benchmarks/harness/raw_data/demo-fast/run-<i>/`.

---

# Statistical Summary — api-quick (N=5)

- **Benchmark:** `api-quick` (3-step REST API with tests and Dockerfile; 2 waves with dependency ordering)
- **Source:** `benchmarks/harness/raw_data/api-quick/metrics.jsonl` (5 lines)
- **Runs (N):** **5** — chosen because per-run wall clock is ~5–7 minutes; N=5 fit the remaining Copilot budget after the demo-fast N=10 cycle
- **Scope limit:** 5 < 10; intentional, not padded with synthetic runs
- **Harness:** `benchmarks/harness/run-n.sh api-quick 5` → `benchmarks/harness/scoring/compute-stats.py`

## Why N=5 and not 10

`api-quick` runs three agents in two waves (backend → {tests, Docker}) and
consumes ~3 premium requests per run at ~6 min wall clock. Running N=10
would cost ~60 min of Copilot time and ~30 premium requests. N=5 already
gives a usable CI on wall-clock and confirms the per-step counts are
stable. If you need N=10 later, re-run the harness — metrics.jsonl will
be overwritten cleanly.

## Aggregate metrics

| Metric | n | Mean | Std | 95% CI (bootstrap) | Min | Max |
| --- | --- | --- | --- | --- | --- | --- |
| wall_clock_ms | 5 | 359067.4 | 57411.7598 | [310753.2, 402196.0] | 273496 | 433251 |
| exit_status | 5 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 0 |
| completed_steps | 5 | 3.0 | 0.0 | [3.0, 3.0] | 3 | 3 |
| total_steps | 5 | 3.0 | 0.0 | [3.0, 3.0] | 3 | 3 |
| commit_count | 5 | 3.6 | 1.1402 | [2.6, 4.4] | 2 | 5 |
| actual_premium_requests | 5 | 3.0 | 0.0 | [3.0, 3.0] | 3 | 3 |
| estimated_premium_requests | 5 | 4.0 | 0.0 | [4.0, 4.0] | 4 | 4 |

### Reading the table

- **wall_clock_ms:** mean 6.0 min, 95% CI [5.2 min, 6.7 min]. Variance
  (~1 min std) is dominated by Copilot inference on the tester and
  devops steps running in parallel in wave 2. Min 4.6 min (run 3, which
  happened to get fast inference on both wave-2 steps) vs max 7.2 min.
- **exit_status / completed_steps / total_steps:** flat — every run
  completed all three steps. A harder task would surface failures here.
- **commit_count:** 3.6 ± 1.1 agent commits, range 2–5. Consistent with
  three agents each producing 1–2 commits plus incidental merge commits.
- **actual_premium_requests:** 3 per run (1 per step), reported by
  `parseCopilotRequestCount` from the live stderr.
- **estimated_premium_requests:** constant 4 — estimator's 15% retry
  buffer on top of 3 steps rounds up.

## Appendix: per-run raw values

| run_index | wall_clock_ms | exit_status | completed_steps | total_steps | commit_count | actual_premium_requests | estimated_premium_requests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 355915 | 0 | 3 | 3 | 4 | 3 | 4 |
| 2 | 377363 | 0 | 3 | 3 | 3 | 3 | 4 |
| 3 | 273496 | 0 | 3 | 3 | 4 | 3 | 4 |
| 4 | 355312 | 0 | 3 | 3 | 5 | 3 | 4 |
| 5 | 433251 | 0 | 3 | 3 | 2 | 3 | 4 |

### Run directories

| run_index | run_dir |
| --- | --- |
| 1 | `/tmp/swarm-demo-api-quick-Rpx3tp/runs/swarm-2026-04-19T00-27-49-643Z` |
| 2 | `/tmp/swarm-demo-api-quick-mEnPvH/runs/swarm-2026-04-19T00-33-45-452Z` |
| 3 | `/tmp/swarm-demo-api-quick-PIKw7M/runs/swarm-2026-04-19T00-40-02-765Z` |
| 4 | `/tmp/swarm-demo-api-quick-WGehWE/runs/swarm-2026-04-19T00-44-41-046Z` |
| 5 | `/tmp/swarm-demo-api-quick-N76Ali/runs/swarm-2026-04-19T00-50-31-663Z` |
