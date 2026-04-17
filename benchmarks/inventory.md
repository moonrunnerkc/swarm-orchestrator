# Benchmarks Inventory

Grounding document for the benchmark reframe. Every claim below is
traceable to a source file and line. Run the verification commands to
spot-check accuracy.

---

## 1. Quality Gates — Names and Implementations

Eight gates, all in `src/quality-gates/gates/`:

| # | Gate ID              | Source File                                         | Config Interface           |
|---|----------------------|-----------------------------------------------------|----------------------------|
| 1 | `scaffold-defaults`  | [gates/scaffold-defaults.ts](../src/quality-gates/gates/scaffold-defaults.ts) | `ScaffoldDefaultsConfig`   |
| 2 | `duplicate-blocks`   | [gates/duplicate-blocks.ts](../src/quality-gates/gates/duplicate-blocks.ts)   | `DuplicateBlocksConfig`    |
| 3 | `hardcoded-config`   | [gates/hardcoded-config.ts](../src/quality-gates/gates/hardcoded-config.ts)   | `HardcodeConfig`           |
| 4 | `readme-claims`      | [gates/readme-claims.ts](../src/quality-gates/gates/readme-claims.ts)         | `ReadmeClaimsConfig`       |
| 5 | `test-isolation`     | [gates/test-isolation.ts](../src/quality-gates/gates/test-isolation.ts)       | `TestIsolationConfig`      |
| 6 | `runtime-checks`     | [gates/runtime-checks.ts](../src/quality-gates/gates/runtime-checks.ts)       | `RuntimeChecksConfig`      |
| 7 | `accessibility`      | [gates/accessibility.ts](../src/quality-gates/gates/accessibility.ts)         | `AccessibilityConfig`      |
| 8 | `test-coverage`      | [gates/test-coverage.ts](../src/quality-gates/gates/test-coverage.ts)         | `TestCoverageConfig`       |

Master runner: [src/quality-gates/gate-runner.ts](../src/quality-gates/gate-runner.ts)  
Config loader: [src/quality-gates/config-loader.ts](../src/quality-gates/config-loader.ts)  
Type definitions: [src/quality-gates/types.ts](../src/quality-gates/types.ts)  
Config file: [config/quality-gates.yaml](../config/quality-gates.yaml)

### Gate auto-remediation flags (all `true` in config)

- `autoAddRefactorStepOnDuplicateBlocks`
- `autoAddReadmeTruthStepOnReadmeClaims`
- `autoAddScaffoldFixStepOnScaffoldDefaults`
- `autoAddConfigFixStepOnHardcodedConfig`
- `autoAddAccessibilityFixStepOnAccessibility`
- `autoAddTestCoverageStepOnTestCoverage`

### Requirement-tier skip mapping (gate-runner.ts)

The `accessibility` gate maps to requirement IDs: `aria-attributes`,
`aria-interactive`, `responsive-layout`, `skip-link`, `dark-mode`,
`focus-visible`, `semantic-html`, `keyboard-navigation`,
`responsive-breakpoint`. When all are in the skip tier, the gate is
downgraded from `fail` → `skip`.

### SARIF integration

Producer: [src/sarif-formatter.ts](../src/sarif-formatter.ts)  
Rule IDs emitted: `swarm/scaffold-defaults`, `swarm/duplicate-blocks`,
`swarm/hardcoded-config`, `swarm/readme-claims`, `swarm/test-isolation`,
`swarm/test-coverage`, `swarm/accessibility`, `swarm/runtime-checks`.  
CLI flag: `--sarif` in [src/cli-handlers.ts](../src/cli-handlers.ts).

**Verification command:**
```bash
grep -c "enabled: true" config/quality-gates.yaml  # expect 9 (1 master + 8 gates)
grep -rn "run_.*_gate" src/quality-gates/gate-runner.ts | wc -l  # expect 8
```

---

## 2. Cost Attribution Schema

**Producer:** [src/swarm-orchestrator.ts](../src/swarm-orchestrator.ts) (line ~821)  
**Type definition:** [src/metrics-types.ts](../src/metrics-types.ts)

### `CostAttribution` (top-level)

| Field                           | Type     | Notes                          |
|---------------------------------|----------|--------------------------------|
| `totalEstimatedPremiumRequests` | number   | Sum of per-step estimates      |
| `totalActualPremiumRequests`    | number   | Sum of per-step actuals        |
| `estimateAccuracy`              | number   | ratio estimated/actual or v.v. |
| `modelUsed`                     | string   | e.g. `claude-sonnet-4`        |
| `modelMultiplier`               | number   | From MODEL_MULTIPLIERS map     |
| `overageTriggered`              | boolean  | Budget exceeded flag           |
| `perStep`                       | array    | Array of `StepCostRecord`      |

### `StepCostRecord` (per-step)

| Field                      | Type    |
|----------------------------|---------|
| `stepNumber`               | number  |
| `agentName`                | string  |
| `estimatedPremiumRequests` | number  |
| `actualPremiumRequests`    | number  |
| `retryCount`               | number  |
| `promptTokens`             | number  |
| `fleetMode`                | boolean |
| `durationMs`               | number  |

### How "actual" is computed

The `CostEstimator` ([src/cost-estimator.ts](../src/cost-estimator.ts))
records actuals via `recordActual()`. Each agent adapter `spawn()` call
counts as 1 base request × `modelMultiplier`. **There is no
instrumented API-call counter.** The adapters
([claude-code-adapter.ts](../src/adapters/claude-code-adapter.ts),
[copilot-adapter.ts](../src/adapters/copilot-adapter.ts),
[codex-adapter.ts](../src/adapters/codex-adapter.ts)) capture
stdout/stderr and exit code only — they do not parse billing headers
or transcript request markers. The "actual" field is an estimate, not
an instrumented measurement. **This is D5.**

**Verification command:**
```bash
grep "actualPremiumRequests" src/metrics-types.ts  # confirm field exists
grep -n "recordActual" src/cost-estimator.ts       # confirm method
grep -rn "recordActual" src/swarm-orchestrator.ts  # confirm call site
```

---

## 3. Session State Schema

**Producer:** [src/swarm-orchestrator.ts](../src/swarm-orchestrator.ts) (lines ~830-858)  
**Type definition:** [src/types.ts](../src/types.ts) — `SessionState` interface

| Field              | Type                                       | Notes                                       |
|--------------------|--------------------------------------------|----------------------------------------------|
| `sessionId`        | string                                     | Unique run identifier                        |
| `graph`            | `{ goal: string, steps: PlanStep[] }`      | Execution plan snapshot                      |
| `branchMap`        | `Record<string, string>`                   | stepNumber → branch name                     |
| `transcripts`      | `Record<string, string>`                   | stepNumber → transcript file path            |
| `metrics`          | `Record<string, unknown>`                  | Free-form metrics bag                        |
| `gateResults`      | `{ id, title, status, issues }[]`          | Quality gate outcomes                        |
| `status`           | `'running' \| 'paused' \| 'completed' \| 'failed'` | Terminal states: completed, failed  |
| `lastCompletedStep`| number                                     | Progress marker                              |

**Notable absences:** No `start_ts`/`end_ts` timestamps at the
session level. Wall-clock time comes from `metrics.totalTimeMs` in a
separate `metrics.json`, or is missing entirely. **This is D9.**

**Verification command:**
```bash
cat runs/report-test-run/session-state.json | jq 'keys'
# expect: ["branchMap","gateResults","graph","lastCompletedStep","metrics","sessionId","status","transcripts"]
```

---

## 4. Failure-Repair Classification

**Source:** [src/repair-agent.ts](../src/repair-agent.ts)

### `FailureClass` type (exhaustive)

```
'build-failure' | 'test-failure' | 'missing-artifact' | 'dependency-error' | 'timeout' | 'general'
```

### Classification priority chain (`classifyFailure()`)

1. `/timeout|timed out/` → `timeout`
2. `/\bpackage\b|\bdependency\b|\bmodule not found\b/` → `dependency-error`
3. `/not found|not created|missing|\[missing-files\]|\[no-changes\]/` → `missing-artifact`
4. Tag count: `[build]` count > 0 and ≥ `[test]` count → `build-failure`
5. `[test]` count > 0 → `test-failure`
6. Fallback → `general`

### Recovery methods (`RecoveryEvent.recoveryMethod`)

```
'retry' | 'replan' | 'rollback' | 'manual'
```

### Repair loop parameters

- Max retries: default 3 (constructor parameter)
- Prompt budget caps: verification report ≤ 4000 chars, transcript
  ≤ 6000 chars, git diff ≤ 4000 chars
- Token estimation: `Math.ceil(text.length / 4)`

**Verification command:**
```bash
grep "FailureClass" src/repair-agent.ts  # confirm type definition
grep "classifyFailure" src/repair-agent.ts  # confirm method
```

---

## 5. Timeout Constants

Every timeout constant in the codebase, with source file and line:

| Constant / Context                 | Value          | File                                      | Line |
|------------------------------------|----------------|-------------------------------------------|------|
| `STALL_TIMEOUT_MS` (Copilot)      | 300,000 ms (5 min) | src/adapters/copilot-adapter.ts      | 12   |
| `STALL_TIMEOUT_MS` (Claude Code)  | 600,000 ms (10 min) | src/adapters/claude-code-adapter.ts | 9    |
| `STALL_TIMEOUT_MS` (Codex)        | 600,000 ms (10 min) | src/adapters/codex-adapter.ts       | 10   |
| `DEFAULT_STALL_TIMEOUT_MS`        | 300,000 ms (5 min) | src/adapters/process-supervisor.ts   | 29   |
| `STALL_TIMEOUT_MS` (SessionExec)  | 300,000 ms (5 min) | src/session-executor.ts              | 446  |
| `maxLockWaitMs`                   | 30,000 ms (30 s)   | src/context-broker.ts                | 41   |
| Stale lock threshold              | 300,000 ms (5 min) | src/context-broker.ts                | 106  |
| `waitForDependencies` default     | 600,000 ms (10 min) | src/context-broker.ts               | 345  |
| `runtimeChecks.timeoutMs`         | 120,000 ms (2 min) | config/quality-gates.yaml            | —    |
| `checkGitDiff` exec timeout       | 10,000 ms (10 s)   | src/verifier-engine.ts               | 262  |
| `checkBuildExec` exec timeout     | 60,000 ms (1 min)  | src/verifier-engine.ts               | 346  |
| `checkTestExec` exec timeout      | 120,000 ms (2 min) | src/verifier-engine.ts               | 380  |
| ESM-fallback test exec timeout    | 120,000 ms (2 min) | src/verifier-engine.ts               | 434  |
| Python version check              | 5,000 ms (5 s)     | src/verifier-engine.ts               | 494  |
| Branch merge timeout              | 120,000 ms (2 min) | src/swarm-orchestrator.ts            | 2040 |
| Dependency install timeout        | 600,000 ms (10 min) | src/swarm-orchestrator.ts           | 1279 |
| Health check fetch                | 10,000 ms (10 s)   | src/deployment-manager.ts            | 222  |
| Copilot version check             | 5,000 ms (5 s)     | src/copilot-cli-wrapper.ts           | 73   |
| Copilot help check                | 5,000 ms (5 s)     | src/copilot-cli-wrapper.ts           | 80   |
| Heartbeat interval                | 10,000 ms (10 s)   | src/session-executor.ts              | —    |
| Stall check interval (Claude)     | 10,000 ms (10 s)   | src/adapters/claude-code-adapter.ts  | 71   |
| PR merge wait (`deadline`)        | configurable        | src/pr-manager.ts                    | 182  |

### The ~600s mystery (D8)

The Claude Code adapter uses `STALL_TIMEOUT_MS = 600_000` (10 min).
The `waitForDependencies` default in context-broker.ts is also
600,000 ms. Both produce ~600s wall-clock bands in benchmark results.
The documented step budget of 900s (15 min) does not appear as a
constant anywhere in the codebase. The 600s band in SWE-bench results
is most likely the Claude Code stall timeout killing sessions that go
quiet for 10 minutes.

**Verification command:**
```bash
grep -rn "600" src/adapters/claude-code-adapter.ts src/context-broker.ts
# expect lines 9, 71 (claude-code), 345 (context-broker)
```

---

## 6. Existing Run Artifact Schema

Run directories live under `runs/<runId>/` with two naming patterns:
- `bootstrap-<ISO-timestamp>-<goal-slug>/`
- `swarm-<ISO-timestamp>/`

### Files per run directory

| File                    | Producer                   | Always present? |
|-------------------------|----------------------------|----------------|
| `session-state.json`    | swarm-orchestrator.ts L830 | Yes (if run completes) |
| `cost-attribution.json` | swarm-orchestrator.ts L821 | Yes (if run completes) |
| `quality-gates.json`    | gate-runner.ts             | If gates enabled |
| `quality-gates.md`      | gate-runner.ts             | If gates enabled |
| `metrics.json`          | report-generator.ts        | Sometimes      |
| `steps/step-N/share.md` | session-executor.ts        | Per step       |
| `steps/step-N/repair-attempt-K.md` | repair-agent.ts | If repair triggered |

### Benchmark harness run artifacts (extra)

In `benchmarks/harness/raw_data/runs/<run-id>/`:
- `benchmark-score.json` — output of `score.sh`
- `run-meta.json` — task ID, start/end timestamps
- `orchestrator_stdout.txt` — captured CLI output

---

## 7. Agent Configuration

Six production agents in [config/default-agents.yaml](../config/default-agents.yaml):

| Agent                | Scope                              |
|----------------------|------------------------------------|
| FrontendExpert       | HTML, CSS, JS, React, accessibility |
| BackendMaster        | APIs, DB, auth, middleware          |
| DevOpsPro            | Docker, CI/CD, IaC, monitoring      |
| SecurityAuditor      | Auth, validation, OWASP, headers    |
| TesterElite          | Unit/integration/e2e tests          |
| IntegratorFinalizer  | Final review, README, docs          |

Additional agents: [config/pm-agent.yaml](../config/pm-agent.yaml),
[config/repair-agent.yaml](../config/repair-agent.yaml),
[config/user-agents.yaml](../config/user-agents.yaml).

---

## 8. Existing Benchmark Infrastructure

### Harness

- **run_fresh.sh** — cycles through 8 legacy tasks, runs orchestrator only
- **score.sh** — extracts 16 metrics from run artifacts
- **compute_ci.py** — mean ± 95% CI via t-distribution
- **legacy_tasks.json** — 8 tasks with hardcoded orchestrator-vs-baseline results

### SWE-bench

- **Dockerfile.eval** — Python 3.11 + Node.js 20 + Claude Code CLI
- **run_swebench.py** — loads SWE-bench Lite, runs orchestrator or baseline
- **collect_results.py** — aggregates eval-*.json results
- 7 result files, all showing 0/5 resolved

### Key deficiencies (feeding into defect list)

1. No baseline producer in `run_fresh.sh` — orchestrator only (D6)
2. No rubric — scoring is metric extraction, not completeness evaluation
3. "actual" premium requests are estimates (D5)
4. No `start_ts`/`end_ts` in session-state (D9)
5. Two pre-Docker eval files committed (D10)
6. SWE-bench positioned as headline (D3)
7. No run labeling state machine (D12)
8. No exclusion policy (D7)
9. No test-file modification filter (D4)
10. 600s timeout unexplained (D8)
11. Task sampler is sequential, not round-robin (D2)
12. No statistical testing for headline claims (D1)

---

## 9. Model Multipliers

From [src/cost-estimator.ts](../src/cost-estimator.ts):

| Model              | Multiplier |
|--------------------|-----------|
| `claude-sonnet-4`  | 1         |
| `claude-sonnet-4.6`| 1         |
| `claude-opus-4`    | 1         |
| `gpt-4o`           | 1         |
| `gpt-5.2`          | 1         |
| `gpt-5.4`          | 1         |
| `o3`               | 20        |
| `o4-mini`          | 5         |

---

*Last verified: 2026-04-17*
