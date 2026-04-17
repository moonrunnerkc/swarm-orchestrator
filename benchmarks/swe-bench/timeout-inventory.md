# Timeout Inventory — Why Runs Cluster Around 600s

> _Last updated: 2026-04-17_  
> _Evidence gathered from: source grep of all `TIMEOUT`, `STALL_TIMEOUT`, `timeoutMs` constants_

## The 600-second band explained

When benchmark runs are plotted by wall-clock time, a prominent cluster appears near 600 seconds (10 minutes). This is **not** a property of the tasks — it is an infrastructure artifact caused by two hardcoded timeout constants in the orchestrator source code.

### Root causes

| Constant | Value | File | Line | Purpose |
|----------|-------|------|------|---------|
| `STALL_TIMEOUT_MS` | 600,000 ms (10 min) | `src/adapters/claude-code-adapter.ts` | 9 | Kills Claude Code subprocess if no stdout/stderr for 10 min |
| `STALL_TIMEOUT_MS` | 600,000 ms (10 min) | `src/adapters/codex-adapter.ts` | 10 | Same stall detection for Codex adapter |
| `waitForDependencies` default | 600,000 ms (10 min) | `src/context-broker.ts` | 345 | Max wait for inter-step dependency resolution |
| `waitForDependencies` call site | 600,000 ms (10 min) | `src/swarm-orchestrator.ts` | 1277 | Hardcoded in the parallel execution loop |

When an agent step stalls (no output), the adapter kills the subprocess at exactly 600s. This produces a sharp cut-off that looks like a natural performance boundary but is actually a timeout artifact.

### Other timeout constants (for completeness)

| Constant | Value | File | Line | Purpose |
|----------|-------|------|------|---------|
| `STALL_TIMEOUT_MS` | 300,000 ms (5 min) | `src/adapters/copilot-adapter.ts` | 12 | Stall detection for Copilot CLI adapter |
| `STALL_TIMEOUT_MS` | 300,000 ms (5 min) | `src/session-executor.ts` | 446 | Session-level stall detection |
| `DEFAULT_STALL_TIMEOUT_MS` | 300,000 ms (5 min) | `src/adapters/process-supervisor.ts` | 29 | Default for the shared process supervisor |
| `timeoutMs` (runtime checks) | 120,000 ms (2 min) | `src/quality-gates/default-config.ts` | 201 | Per-command timeout for quality gate runtime checks |
| `timeout` (branch merger) | 120,000 ms (2 min) | `src/branch-merger.ts` | 311+ | Git merge operation timeouts |
| `timeout_seconds` (benchmark tasks) | 900 s (15 min) | `benchmarks/harness/raw_data/rubric_tasks.json` | each task | Total task timeout in the harness |

### Impact on benchmark measurement

- **Wall-clock clustering**: Runs that stall produce times of ~600s regardless of task difficulty
- **Cost inflation**: A stalled run consumes 0 additional premium requests but inflates wall-clock time
- **Run state**: Stalled runs should be labeled `BUDGET_EXHAUSTED` or `INFRASTRUCTURE_FAILURE` depending on whether any work completed (see [run-states.md](../../harness/scoring/run-states.md))

### Recommendation

The 600s timeout is reasonable for production use (an agent that produces no output for 10 minutes is almost certainly stuck). For benchmarking purposes:

1. **Do not raise the timeout** — a 600s stall is a failed run, not a slow one
2. **Label stalled runs correctly** — score.sh and label.json should distinguish "timed out after producing partial work" from "timed out before producing anything"
3. **Report wall-clock time with and without stall-deaths** — the median excluding stalled runs is the informative statistic
4. **The task timeout (900s) must exceed the adapter stall timeout (600s)** — this is already true and must remain so

### How to verify

```bash
# Find all timeout constants in the source
grep -rn 'STALL_TIMEOUT\|timeoutMs\|timeout.*[0-9]\{5,\}' src/ --include='*.ts' | grep -v node_modules
```

## Risks

- **Non-determinism**: Network latency and API throttling can cause stalls that are not the agent's fault. These produce 600s wall-clock times indistinguishable from genuine stalls.
- **Version drift**: If timeout constants change in a future release, historical comparisons break. Pin the orchestrator version tag in each benchmark run's run-meta.json.
- **Adapter asymmetry**: Copilot CLI adapter uses 300s, Claude Code and Codex use 600s. Cross-adapter comparisons must account for this difference.
