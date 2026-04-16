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

| Metric | Source | Units |
|--------|--------|-------|
| Tests passing | `npm test` / `pytest` exit code + count | % |
| Test coverage | `c8` / `coverage.py` | % |
| Security scan issues | SARIF from `swarm gates --sarif` | count |
| Cost attribution | `cost-attribution.json` | premium requests |
| Wall-clock time | `session-state.json` | seconds |
| Premium request count | `cost-attribution.json` | count |
| Repair-loop iterations | `session-state.json` | count |

No subjective scores. No weighted composite indices. No author-chosen rubrics.

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

1. **Public tasks only.** Primary evaluation uses SWE-bench Lite (300 real GitHub issues).
2. **≥ 10 runs per configuration.** Addresses LLM non-determinism.
3. **Automated scoring.** Machine-parseable outputs only; no human judgment.
4. **95% confidence intervals.** Mean ± CI via t-distribution for every metric.
5. **Full disclosure.** Raw data, prompts, Docker environments, and scripts committed.
6. **ABC-compliant.** All 30 Agentic Benchmark Checklist items addressed.

See [benchmarks/README.md](../benchmarks/README.md) for complete details, evidence links, and risk documentation.
