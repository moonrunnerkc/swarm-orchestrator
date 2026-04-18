# Swarm Orchestrator — Benchmarks

All benchmarking for this project is now centralized in the **[benchmarks/](../benchmarks/)** directory using standardized, reproducible, objective evaluation.

---

## New Benchmarking System

| Resource | Description |
|----------|-------------|
| [benchmarks/README.md](../benchmarks/README.md) | Central hub — directory layout, quick start, methodology |
| [benchmarks/ABC-compliance.md](../benchmarks/ABC-compliance.md) | Agentic Benchmark Checklist audit (30/30 items addressed) |
| [benchmarks/swe-bench/](../benchmarks/swe-bench/) | SWE-bench Lite integration — Dockerized evaluation against real GitHub issues |
| [benchmarks/harness/](../benchmarks/harness/) | Scoring scripts, exact prompts, raw data, statistical summary |
| [.github/workflows/continuous-benchmark.yml](../.github/workflows/continuous-benchmark.yml) | CI workflow — nightly + release benchmarking tracked via Bencher |

## Metrics (Automated Only)

| Metric | Source | Units | Status |
|--------|--------|-------|--------|
| **Rubric completeness** | `rubric-score.json` (22 binary attributes) | ratio [0, 1] | Working |
| **Premium requests** | `cost-attribution.json` | count | Working for the Copilot producer (D5 fixed via `parseCopilotRequestCount`); undefined on Claude Code until a stable marker exists |
| **Cost per rubric point** | premium_requests / rubric_score | requests/point | Usable for Copilot-producer runs; requires fallback for Claude Code |
| Tests passing | `npm test` / `pytest` exit code + count | % | Working |
| Test coverage | `c8` / `coverage.py` | % | Working |
| Security scan issues | SARIF from `swarm gates --sarif` | count | Working |
| Wall-clock time | `session-state.json` | seconds | Working |
| Repair-loop iterations | `session-state.json` | count | Working |

No subjective scores. No weighted composite indices. Rubric attributes are binary (pass/fail) checks evaluated by automated shell scripts — see [completeness-rubric.md](../benchmarks/harness/scoring/completeness-rubric.md).

> **D5 status (FIXED for Copilot producer):** The authoritative parser is now
> `parseCopilotRequestCount` in [src/adapters/copilot-adapter.ts](../src/adapters/copilot-adapter.ts),
> which extracts the billing-accurate count from Copilot's
> "Requests N Premium" stderr summary. See
> [benchmarks/harness/statistical_summary.md](../benchmarks/harness/statistical_summary.md)
> for the first N=10 dataset to use the real parser.
> Claude Code `-p` mode still does not emit a per-session premium-request
> marker, so `parseRequestCount` in `claude-code-adapter.ts` intentionally
> returns undefined rather than a synthetic 1.

## Three-Producer Smoke Tests (2026-04-17)

> **Preliminary: N = 1 per producer per task.** Not statistically meaningful. See [benchmarks/README.md](../benchmarks/README.md) for full analysis.

**task-rest-api** (15 attrs):

| Producer | Rubric Score | Wall-clock (s) | Run Label |
|----------|-------------|----------------|-----------|
| **ORCHESTRATOR** | 12 / 15 (80 %) | 463 | VERIFICATION_FAILED |
| **SINGLE_SHOT** | 12 / 15 (80 %) | 144 | COMPLETED |
| **LADDER** | 15 / 15 (100 %) | 245 | COMPLETED |

**task-auth-route** (17 attrs):

| Producer | Rubric Score | Wall-clock (s) | Run Label |
|----------|-------------|----------------|-----------|
| **ORCHESTRATOR** | 14 / 17 (82 %) | 582 | COMPLETED |
| **SINGLE_SHOT** | 14 / 17 (82 %) | 137 | COMPLETED |
| **LADDER** | 17 / 17 (100 %) | 287 | COMPLETED |

The orchestrator does not win on either task. The rubric is too permissive — LADDER hits 100% from a bare prompt (no rubric-targeted follow-ups consumed). See [honest analysis](../benchmarks/README.md#what-this-data-shows).

## Quick Start

```bash
# Score a completed orchestrator run
./benchmarks/harness/scoring/score.sh ./runs/<execution-id>

# Compute statistical summary from multiple scored runs
python3 benchmarks/harness/scoring/compute_ci.py ./runs/

# Run SWE-bench Lite evaluation (Docker required)
cd benchmarks/swe-bench && docker compose up --build
```

## Methodology

1. **Three-producer comparison.** Primary evaluation compares ORCHESTRATOR, SINGLE_SHOT, and LADDER on the same rubric tasks using a 22-attribute binary completeness rubric. SWE-bench Lite is a secondary benchmark retained for reproducibility on public tasks.
2. **≥ 10 runs per configuration.** Addresses LLM non-determinism.
3. **Automated scoring.** Machine-parseable outputs only; no human judgment.
4. **95% confidence intervals.** Mean ± CI via t-distribution for every metric.
5. **Full disclosure.** Raw data, prompts, Docker environments, and scripts committed.
6. **ABC-compliant.** All 30 Agentic Benchmark Checklist items addressed.

See [benchmarks/README.md](../benchmarks/README.md) for complete details, evidence links, and risk documentation.
