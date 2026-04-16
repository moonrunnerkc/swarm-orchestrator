# SWE-bench Integration — Setup Guide

> Evaluate swarm-orchestrator against real GitHub issues from the SWE-bench Lite dataset.

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Docker + Docker Compose | 24+ / v2+ | Identical eval environment |
| Python | 3.11+ | SWE-bench harness + result collection |
| Node.js | 20+ | Swarm orchestrator runtime |
| Git | 2.40+ | Repo checkouts per task |
| API keys | — | `ANTHROPIC_API_KEY` and/or `GITHUB_TOKEN` |

---

## What Is SWE-bench?

SWE-bench is a public benchmark of **real GitHub issues** paired with their human-written patches. Each task provides:

- A repository + base commit (the state before the fix)
- The issue description (natural language)
- A test patch that the gold solution must pass

**SWE-bench Lite** is a curated 300-task subset that is tractable for evaluation without massive compute. **SWE-bench Verified** is a human-validated subset for higher-confidence results.

| Dataset | Tasks | Source |
|---------|-------|--------|
| SWE-bench Full | 2,294 | https://github.com/swe-bench/SWE-bench |
| SWE-bench Lite | 300 | https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite |
| SWE-bench Verified | 500 | https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified |

---

## First Run (Small Subset)

The first evaluation used **5 diverse tasks** from SWE-bench Lite (one per repository):

```bash
cd benchmarks/swe-bench
docker compose up --build
# — or run locally —
source ../../.venv/bin/activate
python3 evaluation-scripts/run_swebench.py
```

**First run result (2026-04-16):** 2/5 resolved (40 %) — matplotlib and seaborn tasks fixed successfully. Full results in `results/eval-20260416T193906Z.json`.

This will:

1. Pull the SWE-bench Lite dataset (or read from cache).
2. For each task, check out the repo at the specified base commit.
3. Run the swarm orchestrator with the issue description as the goal.
4. Apply the orchestrator's patch and run the gold test suite.
5. Collect results into `results/`.

---

## Environment Variables

Create a `.env` file in `benchmarks/swe-bench/` (gitignored):

```bash
# Required — at least one agent backend
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
OPENAI_API_KEY=sk-...

# Optional — control subset size
SWEBENCH_SUBSET_SIZE=10
SWEBENCH_DATASET=princeton-nlp/SWE-bench_Lite

# Optional — agent backend for orchestrator
SWARM_TOOL=claude-code
SWARM_MODEL=claude-sonnet-4
```

---

## Evaluation Flow

```
┌────────────────────┐
│  SWE-bench Lite    │  (300 real GitHub issues)
│  dataset           │
└────────┬───────────┘
         │ select subset
┌────────▼───────────┐
│  Per-task loop:    │
│  1. git checkout   │
│  2. swarm run      │
│  3. apply patch    │
│  4. run gold tests │
│  5. record result  │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  collect_results   │  → results/<timestamp>.json
│  (% resolved,      │
│   cost, latency,   │
│   test-pass rate)  │
└────────────────────┘
```

---

## Interpreting Results

| Metric | Description |
|--------|-------------|
| **% Resolved** | Fraction of tasks where the orchestrator's patch makes all gold tests pass |
| **Cost (premium requests)** | Total premium requests consumed across all tasks |
| **Latency** | Wall-clock time per task (mean ± 95 % CI) |
| **Test-pass rate** | Fraction of gold test assertions passing (even for partially resolved tasks) |

---

## Running Baselines

To compare against standalone agents, modify the `SWARM_TOOL` and add `BASELINE_MODE=true`:

```bash
BASELINE_MODE=true SWARM_TOOL=copilot docker compose up --build
```

In baseline mode, the runner sends the raw issue description to the agent CLI without orchestrator wrapping, quality gates, or multi-agent decomposition.

---

## Evidence & Sources

| Item | URL | Accessed |
|------|-----|----------|
| SWE-bench project | https://www.swebench.com/ | 2026-04-16 |
| SWE-bench GitHub | https://github.com/swe-bench/SWE-bench | 2026-04-16 |
| SWE-bench Lite (HuggingFace) | https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite | 2026-04-16 |
| SWE-bench Verified (HuggingFace) | https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified | 2026-04-16 |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| API cost per task (~1-7 premium requests) | Start with 10-task subset; budget cap via `--max-premium-requests` |
| Non-determinism | Run ≥ 10 times; report mean ± 95 % CI |
| Dataset contamination | Acknowledged; use SWE-bench Verified where possible |
| Repository checkout failures | Retry logic in `run_swebench.py`; skip and log failures |
| Long-running tasks | 30-minute timeout per task; configurable via `TASK_TIMEOUT_SECONDS` |
