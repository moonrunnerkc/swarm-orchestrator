# Swarm Orchestrator — Benchmark Hub

> **Historical doc.** This directory describes a pre-v7 benchmarking harness. The v7 primary metric is the falsification catch rate measured against the SWE-bench Verified 50-instance stratified subset; see [docs/benchmarks.md](../docs/benchmarks.md) and the project README. The rubric-based three-producer harness below is retained on disk for archival reference; it is not the current release benchmark.

---

## Directory Layout

```
benchmarks/
├── README.md                      ← you are here (central hub)
├── ladder/
│   ├── run_ladder.sh              ← iterative ladder baseline runner
│   └── PROMPT_FAIRNESS.md         ← fairness policy (PRs welcome)
├── swe-bench/                     ← secondary: reproducibility on public tasks
│   ├── setup.md
│   ├── docker-compose.yml
│   ├── timeout-inventory.md       ← explains the 600s cluster (D8)
│   ├── evaluation-scripts/
│   └── results/
├── harness/
│   ├── run_fresh.sh               ← three-producer harness (D6)
│   ├── prompts/
│   │   ├── orchestrator.md
│   │   └── baselines.md
│   ├── scoring/
│   │   ├── score.sh               ← per-run scoring
│   │   ├── rubric_runner.py       ← 22-attribute rubric evaluator
│   │   ├── compute_ci.py          ← mean ± 95% CI
│   │   ├── stat_test.py           ← paired Wilcoxon + Bonferroni (D1)
│   │   ├── sampler_audit.py       ← chi-square task uniformity (D2)
│   │   ├── completeness-rubric.md ← 22 binary attributes × 6 groups
│   │   ├── exclusion-policy.md    ← infrastructure failure handling (D7)
│   │   ├── run-states.md          ← run state machine (D12)
│   │   └── checks/               ← 22 attribute check scripts
│   ├── raw_data/
│   │   ├── rubric_tasks.json      ← 8 tasks with ladder_prompts
│   │   ├── legacy_tasks.json      ← archived original tasks
│   │   └── runs/                  ← local per-producer run directories (gitignored)
│   └── statistical_summary.md     ← generated locally (gitignored)
```

---

## Quick Start

```bash
# 1 — Run all three producers (8 tasks each, default)
./benchmarks/harness/run_fresh.sh 8

# 2 — Run only the orchestrator (16 runs = 2 full cycles)
PRODUCER=ORCHESTRATOR ./benchmarks/harness/run_fresh.sh 16

# 3 — Run only the ladder baseline
PRODUCER=LADDER ./benchmarks/harness/run_fresh.sh 8

# 4 — Compute statistical summary from scored runs
python3 benchmarks/harness/scoring/compute_ci.py benchmarks/harness/raw_data/runs/

# 5 — Run pairwise statistical tests
python3 benchmarks/harness/scoring/stat_test.py benchmarks/harness/raw_data/runs/

# 6 — Audit task sampling uniformity
python3 benchmarks/harness/scoring/sampler_audit.py benchmarks/harness/raw_data/runs/

# 7 — SWE-bench Lite evaluation (Docker required, secondary)
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export CLAUDE_CONFIG_JSON="$HOME/.claude.json"
cd benchmarks/swe-bench && docker compose up --build
```

---

## Provider flags

Every harness that invokes `swarm run` accepts and forwards the same
provider-selection surface as the CLI:

- `--extractor deterministic|local|anthropic` (or `EXTRACTOR_PROVIDER`)
- `--session deterministic|local|anthropic` (or `SESSION_PROVIDER`)
- the ten `--local-*` flags (or the matching `LOCAL_LLM_*` env vars)

Coverage per harness:

| Harness | Flags accepted | Compare-providers mode | Notes |
|---|---|---|---|
| `swe-bench/evaluation-scripts/run_swebench.py` | yes | `--compare-providers` runs all three providers and writes `<run-id>-compare-providers.json` next to the per-sweep summaries | env-var fallbacks identical to the orchestrator's |
| `harness/run_fresh.sh` (`ORCHESTRATOR` producer) | yes (forwarded to `swarm run`) | no | `SINGLE_SHOT` and `LADDER` producers do not invoke the orchestrator and ignore these flags |
| `harness/run-n.sh` | n/a — invokes `swarm demo`, which has a fixed scenario pipeline rather than the v8 contract pipeline | n/a | the demo subcommand does not accept extractor/session flags |
| `provider-bench/provider-bench.ts` | yes (canonical TypeScript comparison tool) | `--compare-providers` | see [provider-bench/README.md](provider-bench/README.md) for examples |

When neither the flag nor the env-var is set, every harness behaves
exactly as before — the default `deterministic` extractor and session
preserve historical behavior. Per-invocation overrides via the CLI flag
work because each harness rebuilds the orchestrator command from the
live values for every subprocess call.

---

## Strategy Overview

| # | Strategy | Location | Status |
|---|----------|----------|--------|
| 1 | **Cost-to-Completion Rubric** — primary metric: how many premium requests to reach what completeness? | [harness/scoring/](harness/scoring/) | **Active** |
| 2 | **Three-Producer Comparison** — orchestrator vs single-shot vs iterative ladder baseline | [harness/run_fresh.sh](harness/run_fresh.sh), [ladder/](ladder/) | **Active** |
| 3 | **Agentic Benchmark Checklist (ABC)** — peer-reviewed evaluation hygiene | historical audit artifact | Not committed |
| 4 | **Transparent harness** — open prompts, scoring scripts, raw data, ladder [fairness policy](ladder/PROMPT_FAIRNESS.md) | [harness/](harness/) | Complete |
| 5 | **Objective metrics & statistics** — automated, paired Wilcoxon + Bonferroni | [harness/scoring/](harness/scoring/) | **Active** |
| 6 | **Continuous benchmarking (Bencher)** — regression tracking in CI | [../.github/workflows/continuous-benchmark.yml](../.github/workflows/continuous-benchmark.yml) | Workflow committed |
| 7 | **SWE-bench Lite** _(secondary)_ — reproducibility on public tasks | [swe-bench/](swe-bench/) | 0/5 resolved — see note below |

---

## Metrics Collected (Automated Only)

| Metric | Source | Units | Primary? |
|--------|--------|-------|----------|
| **Rubric completeness** | `rubric-score.json` (22 binary attributes) | ratio [0, 1] | **Yes** |
| **Premium requests consumed** | `cost-attribution.json` | count | **Broken — see [D5 status](#d5-premium-request-counting-is-broken)** |
| **Cost per rubric point** | premium_requests / rubric_score | requests/point | Blocked on D5 |
| Wall-clock time | `metrics.json` timestamps (D9) | seconds | |
| Tests passing | `npm test` / `pytest` exit code | % | |
| Test coverage | `c8` / `coverage.py` report | % | |
| Security scan results | SARIF from `swarm gates --sarif` | issue count | |
| Repair-loop iterations | `session-state.json` metadata | count | |
| Run label | `label.json` (D12: state machine) | enum | |
| Test-file protection | quality gate `test-file-protection` (D4) | pass/fail | |

No subjective scores, no weighted composite indices. The intended headline comparison is **cost (premium requests) vs completeness (rubric score)** across three producers. Premium request counting is fixed for the Copilot producer as of the D5 remediation (see [D5 status](#d5-premium-request-counting--fixed-for-copilot)); Claude Code's producer still reports `undefined` where no marker is available.

---

## Three-Producer Comparison — Smoke Tests (2026-04-17)

> **Preliminary: N = 1 per producer per task.** These are smoke-test results confirming the harness works end-to-end. They are not statistically meaningful. Do not cite these numbers as the project's benchmark results. The full comparison (≥ 10 runs × 8 tasks with confidence intervals) has not been run yet.

### Results

**Task: `task-rest-api`** (15 applicable attributes — simple CRUD API)

| Producer | Rubric Score | Wall-clock (s) | Run Label |
|----------|-------------|----------------|-----------|
| **ORCHESTRATOR** | 12 / 15 (80 %) | 463 | VERIFICATION_FAILED |
| **SINGLE_SHOT** | 12 / 15 (80 %) | 144 | COMPLETED |
| **LADDER** | 15 / 15 (100 %) | 245 | COMPLETED |

**Task: `task-auth-route`** (17 applicable attributes — JWT auth with RBAC)

| Producer | Rubric Score | Wall-clock (s) | Run Label |
|----------|-------------|----------------|-----------|
| **ORCHESTRATOR** | 14 / 17 (82 %) | 582 | COMPLETED |
| **SINGLE_SHOT** | 14 / 17 (82 %) | 137 | COMPLETED |
| **LADDER** | 17 / 17 (100 %) | 287 | COMPLETED |

> **Premium request counts omitted from the 2026-04-17 table above** because
> that dataset was captured before the D5 fix landed. New Copilot-producer
> runs use `parseCopilotRequestCount` and report the billing-accurate
> count. See [D5 status](#d5-premium-request-counting-is-broken) for the
> narrow remaining gap on the Claude Code producer.

### What this data shows

**The orchestrator does not win on either task.** The pattern is consistent across both:

- Orchestrator ties SINGLE_SHOT on rubric score (80% and 82%)
- Orchestrator takes 3–4× longer (463s/582s vs 144s/137s)
- LADDER hits 100% on its first prompt, never needing its rubric-targeted follow-ups
- The orchestrator's multi-agent machinery adds wall-clock cost without measurable rubric benefit

The failing attributes shift between tasks (WIRE-ENV, TEST-NOMOD, ERR-UNHANDLED, TEST-PASS, PROD-README) but the pattern holds: both the orchestrator and SINGLE_SHOT miss 2–3 "hygiene" attributes, and the gap between them is zero.

### Why this is happening

**The rubric is too permissive.** Claude handles production-readiness natively for the task complexity represented in the current pool. Evidence:

1. LADDER hits 100% from a bare task prompt (no rubric-targeted follow-ups consumed) on **both tasks**. The rubric cannot distinguish "orchestrator added value" from "Claude's default behavior" if a single prompt already saturates the scale.

2. SINGLE_SHOT achieves 80–82% on first attempt. The rubric attributes that are missed (WIRE-ENV, ERR-UNHANDLED, PROD-README) are "professional hygiene" items — configurable port, unhandled-rejection handler, README — that Claude sometimes includes and sometimes doesn't, independent of whether an orchestrator coordinates agents.

3. The checks are **existence checks**, not **correctness checks**. SEC-INPUT passes if `zod` appears in imports, not if every user-facing route has a validator applied. ERR-UNHANDLED greps for `process.on('uncaughtException')` without verifying the handler logs structured output. The rubric measures "did you think of X" not "did you implement X correctly."

### Three possible interpretations

1. **The rubric needs hardening.** Existence checks should become correctness checks. SEC-INPUT should verify per-route validator application. ERR-UNHANDLED should verify structured logging. TEST-COV should enforce a minimum coverage threshold, not just "assertions exist." This would lower SINGLE_SHOT and LADDER scores and potentially reveal orchestrator value.

2. **The task pool needs harder tasks.** Both test tasks are single-service Node.js projects that Claude handles well by default. Tasks where the orchestrator could differentiate: multi-service systems with inter-service auth, database migrations, webhook signature verification, observability instrumentation, and dependency injection. Tasks where coordination between specialized agents (security, testing, backend, devops) adds genuine value.

3. **The orchestrator may not add measurable value for tasks below a complexity threshold.** If this holds after harder tasks and stricter rubrics, the honest claim is: "the orchestrator is valuable for complex multi-concern projects where a single prompt reliably misses critical production requirements — not for well-scoped single-service builds." That is a real product thesis. It is narrower than "orchestrator wins everywhere."

### LADDER's 100% on prompt 1: confirmed rubric smell

LADDER achieved 100% after **only prompt 1** on both tasks— prompts 2–17 were never sent. Prompt 1 is the bare task description, identical to what SINGLE_SHOT receives.

This means Claude Code is capable of producing all rubric attributes from a bare task prompt in a single request. The 2–3 point gap between SINGLE_SHOT (80–82%) and LADDER (100%) on the identical prompt is pure LLM non-determinism. With N=1, this gap is noise.

The conclusion: **the rubric's difficulty ceiling is at or below Claude's default capability.** Until the rubric is hardened or the task pool includes genuinely harder tasks, the three-producer comparison cannot detect orchestrator value.

### Per-Attribute Breakdown (task-rest-api)

| Group | Attribute | ORCHESTRATOR | SINGLE_SHOT | LADDER |
|-------|-----------|:-----------:|:-----------:|:------:|
| SEC | SEC-INPUT (input validation) | PASS | PASS | PASS |
| SEC | SEC-HELMET (security headers) | PASS | PASS | PASS |
| SEC | SEC-NOSQL (no SQL injection) | PASS | PASS | PASS |
| WIRE | WIRE-START (server boots) | PASS | PASS | PASS |
| WIRE | WIRE-ROUTES (route definitions) | PASS | PASS | PASS |
| WIRE | WIRE-ENV (configurable port) | **FAIL** | **FAIL** | PASS |
| WIRE | WIRE-JSON (JSON middleware) | PASS | PASS | PASS |
| TEST | TEST-EXIST (test files exist) | PASS | PASS | PASS |
| TEST | TEST-PASS (tests pass) | PASS | PASS | PASS |
| TEST | TEST-COV (assertions present) | PASS | PASS | PASS |
| TEST | TEST-NOMOD (no test modification) | **FAIL** | PASS | PASS |
| ERR | ERR-MIDDLE (error middleware) | PASS | PASS | PASS |
| ERR | ERR-UNHANDLED (uncaught handlers) | **FAIL** | **FAIL** | PASS |
| PROD | PROD-LINT (lint-clean) | PASS | PASS | PASS |
| PROD | PROD-README (README present) | PASS | **FAIL** | PASS |

### Per-Attribute Breakdown (task-auth-route)

| Group | Attribute | ORCHESTRATOR | SINGLE_SHOT | LADDER |
|-------|-----------|:-----------:|:-----------:|:------:|
| SEC | SEC-INPUT (input validation) | PASS | PASS | PASS |
| SEC | SEC-NOSECRETS (no hardcoded secrets) | PASS | PASS | PASS |
| SEC | SEC-SARIF (npm audit clean) | PASS | PASS | PASS |
| SEC | SEC-DEPS (dependency audit) | PASS | PASS | PASS |
| SEC | SEC-AUTHN (authentication middleware) | PASS | PASS | PASS |
| SEC | SEC-AUTHZ (role-based access control) | PASS | PASS | PASS |
| WIRE | WIRE-START (server boots) | PASS | PASS | PASS |
| WIRE | WIRE-ROUTES (route definitions) | PASS | PASS | PASS |
| WIRE | WIRE-ENV (configurable port) | PASS | **FAIL** | PASS |
| TEST | TEST-EXIST (test files exist) | PASS | PASS | PASS |
| TEST | TEST-COV (assertions present) | PASS | PASS | PASS |
| TEST | TEST-PASS (tests pass) | **FAIL** | PASS | PASS |
| TEST | TEST-NOMOD (no test modification) | PASS | PASS | PASS |
| ERR | ERR-NOBARE (no empty catch blocks) | PASS | PASS | PASS |
| ERR | ERR-STRUCT (structured error responses) | PASS | PASS | PASS |
| ERR | ERR-UNHANDLED (uncaught handlers) | **FAIL** | **FAIL** | PASS |
| PROD | PROD-README (README present) | **FAIL** | **FAIL** | PASS |

### Known Issues in This Smoke Test

**TEST-NOMOD fails for ORCHESTRATOR but D4 gate passed.** The test-file-protection quality gate compares against the pre-orchestration HEAD SHA and sees all files as **additions** (greenfield project). The rubric check uses `git diff HEAD~1` which catches cross-step modifications (SecurityAuditor modifying TesterElite's test file). For greenfield tasks, the gate and rubric test different things. This is a genuine gap — the gate is irrelevant for greenfield projects. See [D4 status](#d4-test-file-protection-greenfield-gap).

### Check-Script Bug Fixes (2026-04-17)

Five bugs in the check scripts were causing false negatives and false positives. All were fixed before this smoke test.

| Bug | Script | Symptom | Root Cause | Fix |
|-----|--------|---------|------------|-----|
| **B1** | `sec_input.sh` | Sporadic FAIL on valid code | `grep -rl \| head -1` under `set -eo pipefail` → exit 141 (SIGPIPE) | `_first_match()` helper disabling pipefail in subshell |
| **B2** | `sec_input.sh` | False PASS (matched `node_modules`) | No `--exclude-dir` on grep | Added `--exclude-dir=node_modules --exclude-dir=.git` to all greps |
| **B3** | `wire_start.sh` | All producers FAIL (server won't boot) | ntopng occupies port 3000; Express 5 silently exits on bind failure | Random high port `PORT=$((RANDOM % 10000 + 20000))` |
| **B4** | `wire_routes.sh` | False FAIL (routes not found) | `cd "$DIR"` then `grep "$DIR"` — relative path invalid after cd | Changed to `"."` after cd |
| **B5** | `test_cov.sh` | False FAIL (coverage not found) | Same cd + `$DIR` relative path bug | Changed to `"."` after cd |
| **Global** | `rubric_runner.py` | All path bugs triggered | Relative paths passed from `run_fresh.sh` | `os.path.abspath()` on `artifact_dir` in `main()` |

---

## Known Defect Status

### D5: Premium Request Counting — Fixed for Copilot

**Status:** Fixed for the Copilot producer. Open-but-documented for Claude Code.

The current parser is `parseCopilotRequestCount` in
[src/adapters/copilot-adapter.ts](../src/adapters/copilot-adapter.ts).
It extracts the count from Copilot's `Requests N Premium (Xs)` stderr
summary line and propagates it through `SessionResult.premiumRequestsConsumed`
to the orchestrator's cost recorder. The fallback value of `1` still exists
but is only reached when the adapter genuinely cannot determine the count
(e.g. auth failure, stall-timeout kill before the summary printed).

The old three-strategy `parseRequestCount` in `claude-code-adapter.ts` was
dishonest: it always fell through to returning `1` for any successful run
because the markers it looked for (`Human:` turn markers, a `total cost`
line) are not present in Claude Code `-p` output. That function now returns
`undefined` rather than fabricate a count. Until Claude Code exposes a
stable per-session premium-request marker, runs against the Claude Code
producer will have `actualPremiumRequests` = undefined and the orchestrator
will record the 1-per-step fallback (plainly labeled in the summary).

**Impact on historical data:** the 2026-04-17 three-producer table above
was captured before this fix. Do not extract new conclusions from that
row about cost efficiency. The N=10 demo-fast dataset at
`benchmarks/harness/raw_data/demo-fast/metrics.jsonl` is the first dataset
to use the real parser.

### D4: Test-File Protection Greenfield Gap

The `test-file-protection` quality gate diffs against the pre-orchestration HEAD SHA. For greenfield tasks (where the orchestrator creates all files from scratch), every file is an **addition**, never a **modification**. The gate always passes.

The `TEST-NOMOD` rubric check uses `git diff --diff-filter=M HEAD~1`, which catches modifications between intermediate orchestration commits (e.g., SecurityAuditor modifying a test file created by TesterElite). This is a real cross-agent coordination failure that the gate structurally cannot detect on greenfield projects.

**Fix needed:** Either (a) the gate needs to track inter-step diffs (comparing each step's output against the previous step's), or (b) a post-orchestration rubric-style check should supplement the gate for greenfield tasks.

---

## Release Engineering History

<details>
<summary>Orchestrator-only runs (10 runs, pre-rubric-comparison, 2026-04-17) — click to expand</summary>

> These are internal orchestrator-only runs used to validate root-cause fixes RC1–RC5. They predate the three-producer rubric comparison and use the old scoring pipeline (not the 22-attribute rubric). Retained for engineering reference.

### Root-Cause Fixes Applied

| Fix | Description | Evidence |
|-----|-------------|----------|
| **RC5** | Replan agent name normalization (snake_case → PascalCase) | 0 "unknown agent" errors (was 100%); 3 remediation steps fired across 2 runs |
| **RC2** | Prompt piped via stdin (eliminates E2BIG) | matplotlib-18869 ran 611s (was 3.4s crash) |
| **RC3** | Worktree detached-HEAD fix (full SHA start point) | seaborn-2848 ran 608s (was 0.7s crash) |
| **RC1** | "Do not edit test files" constraint in agent prompts | Injected in buildStepPrompt and SWE-bench goal |
| **RC4** | Install test extras (.[test,dev,testing]) + per-repo requirements | hypothesis, flask, numpy now installed in venvs |

### Aggregate Metrics (mean ± 95 % CI)

| Metric | N | Mean | 95 % CI | Std Dev |
|--------|---|------|---------|---------|
| Wall-clock time (s) | 9 | 889.72 | [388.47, 1390.97] | 652.10 |
| Step count | 9 | 3.00 | [1.61, 4.39] | 1.80 |
| Verifications passed | 9 | 1.78 | [0.30, 3.26] | 1.92 |
| Verifications failed | 9 | 0.89 | [0.43, 1.35] | 0.60 |
| Quality-gate issues | 10 | 0.10 | [−0.13, 0.33] | 0.32 |
| Repair-loop iterations | 9 | 0.00 | [0.00, 0.00] | 0.00 |

> **Premium request rows removed.** The "actual" row was broken (identical to verifications\_passed due to the D5 bug). The "estimated" row was a pre-execution estimate. Neither measured real premium request consumption.

### Completion & Pass Rates

| Metric | Post-RC-Fix (2026-04-17) | Pre-RC-Fix (2026-04-16) |
|--------|--------------------------|-------------------------|
| Runs scored | 10 (9 with session-state, 1 data-issue) | 10 (9 with session-state, 1 data-issue) |
| Completion rate | 2 / 10 = **20 %** | 6 / 9 = **66.7 %** |
| Quality gates passed | 9 / 9 = **100 %** | 9 / 9 = **100 %** |
| Replan steps fired | **3** (across 2 runs) | **0** (replan was broken) |
| "Unknown agent" errors | **0** | systemic (every remediation attempt) |

> **Completion rate drop:** Fisher exact test on the 2×2 contingency table (pre: 6/9 completed, post: 2/9 completed) gives **p = 0.153** (two-sided). Not significant at α = 0.05 or α = 0.10. The observed difference is consistent with sampling variance at N = 9 per batch. A definitive comparison requires N ≥ 30 per batch.

### Per-Run Breakdown

| Run | Task | Status | Steps | V-Pass | V-Fail | Wall-clock (s) | Replan Steps |
|-----|------|--------|-------|--------|--------|----------------|---------------|
| 1 | benchmark-1 | failed | 6 | 2 | 1 | 751 | 1 |
| 2 | benchmark-2 | **completed** | 5 | 5 | 0 | 2004 | 0 |
| 3 | benchmark-3 | failed | 2 | 1 | 1 | 686 | 0 |
| 4 | benchmark-1 | failed | 2 | 1 | 1 | 685 | 0 |
| 5 | benchmark-2 | failed | 2 | 1 | 1 | 682 | 0 |
| 6 | benchmark-3 | failed | 2 | 0 | 2 | 301 | 0 |
| 7 | benchmark-4 | failed | 1 | 0 | 1 | 230 | 0 |
| 8 | benchmark-5 | **completed** | 5 | 5 | 0 | 1981 | 0 |
| 9 | benchmark-6 | failed (QG) | 7 | 5 | 2 | ~2400 | 2 |
| 10 | benchmark-7 | failed | 2 | 1 | 1 | 687 | 0 |

### Key Observations

- **RC5 fix confirmed working** — 3 remediation steps across 2 runs, zero "unknown agent" errors.
- **Run 9: full repair loop end-to-end** — Quality gates detected hardcoded-config, replan added step 6 (verified), gates re-ran, added step 7 (failed).
- **Quality gates 100% pass rate** — all 9 runs with session data.

</details>

---

## SWE-bench Lite Results — Docker (5-task subset)

> **Secondary benchmark.** SWE-bench provides reproducibility on public tasks but is not the primary measure of orchestrator value. The primary comparison is cost-to-completion rubric completeness (above). SWE-bench is retained for transparency and to validate infrastructure on real-world GitHub issues.
>
> **Docker-based evaluation** against real GitHub issues from [SWE-bench Lite](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite). Orchestrator ran inside Docker (`python:3.11-slim` + Node.js 20 + Claude Code CLI) as a non-root evaluator user. Per-repo virtualenvs with test extras (RC4 fix). Each task had a 900 s timeout.

### Post-RC-Fix Orchestrator Results (2026-04-17)

| Metric | Value |
|--------|-------|
| Tasks evaluated | 5 |
| Tasks resolved | **0 (0.0 %)** |
| Mean latency | **640.03 s** |
| Tasks with real agent work | **5 / 5** (was 3/5 pre-fix) |
| Infrastructure failures | **0 / 5** (was 2/5 pre-fix) |
| Model | claude-sonnet-4 |
| Tool | claude-code via swarm orchestrator |
| Eval file | [`eval-20260417T164823Z.json`](swe-bench/results/eval-20260417T164823Z.json) |

### Per-Task Breakdown (Post-RC-Fix Orchestrator)

| Instance | Repo | Resolved | Latency | Failure Reason |
|----------|------|----------|---------|----------------|
| astropy-12907 | astropy/astropy | No | 613.6 s | Test patch conflict — agents still modified test files |
| django-10914 | django/django | No | 762.7 s | Test patch conflict — agents still modified test files |
| matplotlib-18869 | matplotlib/matplotlib | No | 610.5 s | Test patch conflict (**RC2 fix: was E2BIG crash at 3.4s**) |
| seaborn-2848 | mwaskom/seaborn | No | 607.7 s | Test collector error (**RC3 fix: was worktree crash at 0.7s**) |
| flask-4045 | pallets/flask | No | 605.6 s | Test patch conflict |

### Pre-Fix vs Post-Fix Comparison

| Metric | Pre-Fix (2026-04-17 early) | Post-RC-Fix (2026-04-17) |
|--------|----------------------------|---------------------------|
| Tasks with real agent work | 3 / 5 (60%) | **5 / 5 (100%)** |
| Infrastructure failures | 2 / 5 (E2BIG, worktree) | **0 / 5** |
| Mean latency | 199.79 s (skewed by 2 instant crashes) | **640.03 s** (all tasks run to completion) |
| Resolved | 0 / 5 | 0 / 5 |
| Remaining failure mode | Test patch conflicts (3/5) | Test patch conflicts (4/5), collector error (1/5) |

### Baseline Results (direct Claude CLI, post-credential-fix)

| Metric | Value |
|--------|-------|
| Tasks evaluated | 5 |
| Tasks resolved | **0 (0.0 %)** |
| Mean latency | **177.3 s** |
| Model | claude-sonnet-4 |
| Tool | claude CLI (`claude --dangerously-skip-permissions`) |
| Eval file | [`eval-20260417T181946Z.json`](swe-bench/results/eval-20260417T181946Z.json) |

### Per-Task Breakdown (Baseline)

| Instance | Repo | Resolved | Latency | Failure Reason |
|----------|------|----------|---------|----------------|
| astropy-12907 | astropy/astropy | No | 79.9 s | Broken install — `could not determine astropy package version` |
| django-10914 | django/django | No | 46.1 s | Test patch conflict |
| matplotlib-18869 | matplotlib/matplotlib | No | 131.7 s | Test patch conflict |
| seaborn-2848 | mwaskom/seaborn | No | 590.3 s | Test collector error — `found no collectors` |
| flask-4045 | pallets/flask | No | 38.6 s | Import error — `cannot import name 'url_quote' from 'werkzeug.urls'` |

> **Note:** Previous baseline (eval-20260417T021758Z) failed instantly with "Not logged in" due to missing credential mounts (snap Docker `$HOME` override). This run confirms credentials now work. Baseline agent (Claude CLI) did real work on all 5 tasks — astropy agent even found the correct fix (79.9s) but the test environment had a broken install.

### Remaining SWE-bench Limitations

1. **Test patch conflicts** — Agents still modify test files despite the "do not edit tests" prompt constraint (RC1). This is an LLM instruction-following limitation, not an infrastructure bug. Stronger constraints (e.g., git hooks that reject test-file commits) could help.
2. **Test collector errors** — seaborn's pytest runner can't find tests after agent modifications. Likely a conftest/import-path issue.
3. **0% resolution rate** — With the same 5-task subset and model, both orchestrator and baseline achieve 0%. Resolving SWE-bench tasks requires deeper agent capability (understanding codebases, writing precise minimal patches).

### Environment-Parity Risk

> **Note:** Pre-Docker eval artifacts (`eval-20260416T*`, `eval-20260417T000815Z`) have been deleted (D10). Only Docker-produced results remain in `results/`. Future eval runs should include a `docker_image_digest` field for provenance tracking.

---

## Comparison Methodology

1. **Same task, same commit, same model.** Every evaluation starts from an identical git state and uses the same LLM model for orchestrator and baseline.
2. **≥ 10 runs per configuration.** Non-determinism is addressed with repeated trials.
3. **Automated scoring only.** The scoring script ([score.sh](harness/scoring/score.sh)) reads machine-parseable outputs; no human judgment enters the pipeline.
4. **95 % confidence intervals.** [compute_ci.py](harness/scoring/compute_ci.py) reports mean ± CI for every metric.
5. **Artifact handling.** Prompts, Docker environments, and scripts are committed to this directory. Generated raw data is gitignored; publish it as a release artifact or external archive when a benchmark claim depends on it.

---

## Evidence & Sources

| Item | URL | Accessed |
|------|-----|----------|
| SWE-bench project | https://www.swebench.com/ | 2026-04-16 |
| SWE-bench GitHub | https://github.com/swe-bench/SWE-bench | 2026-04-16 |
| SWE-bench Lite dataset | https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite | 2026-04-16 |
| ABC paper (arXiv) | https://arxiv.org/abs/2507.02825 | 2026-04-16 |
| Bencher (continuous benchmarking) | https://github.com/bencherdev/bencher | 2026-04-16 |
| Bencher examples | https://github.com/bencherdev/example | 2026-04-16 |

---

## Conflicts of Interest

- **Authorship.** This benchmark harness and the orchestrator under test are
  both authored by the same person (repo owner). The comparison is therefore
  not third-party — treat results as a vendor self-evaluation.
- **Automation.** Scoring is fully automated (see
  [harness/scoring/score.sh](harness/scoring/score.sh),
  [harness/scoring/rubric_runner.py](harness/scoring/rubric_runner.py),
  and the 22 binary check scripts in [harness/scoring/checks/](harness/scoring/checks/)).
  No subjective grading step exists in the pipeline.
- **Openness.** Prompts, scoring code, and Docker environments are committed
  to this repository. Raw run artifacts and statistical summaries are
  generated locally and should be published separately when cited.
- **Undisclosed financial relationships.** None. No paid placements,
  sponsorships, or undisclosed dependencies tilt this comparison.

## Risks

| Risk | Mitigation |
|------|-----------|
| **Non-determinism** of LLM outputs | ≥ 30 runs per producer (N≥30 for Wilcoxon); report mean ± 95% CI |
| **Ladder prompt fairness** | [PROMPT_FAIRNESS.md](ladder/PROMPT_FAIRNESS.md); community PRs welcome |
| **600s timeout cluster** | Documented in [timeout-inventory.md](swe-bench/timeout-inventory.md); stalled runs labeled correctly (D12) |
| **CI cost** — each run consumes API credits | Budget cap (30 requests for ladder); nightly schedule |
| **Dependency drift** | Pin versions in Docker; Renovate/Dependabot for alerts |
| **Dataset contamination** | Acknowledged in ABC compliance; use SWE-bench Verified where available |
| **Environment parity** | Docker Compose for identical environments; local runs documented as approximate |
| **Test-file modification** | Quality gate `test-file-protection` (D4) fails if agents modify existing tests |

---

## How to Reproduce

```bash
# Clone and build
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm ci && npm run build

# Run all three producers (8 tasks each ≈ 24 runs total)
./benchmarks/harness/run_fresh.sh 8

# Or run 30+ per producer for statistical power
PRODUCER=ORCHESTRATOR ./benchmarks/harness/run_fresh.sh 32
PRODUCER=SINGLE_SHOT  ./benchmarks/harness/run_fresh.sh 32
PRODUCER=LADDER       ./benchmarks/harness/run_fresh.sh 32

# Statistical comparison
python3 benchmarks/harness/scoring/stat_test.py benchmarks/harness/raw_data/runs/

# Confidence intervals
python3 benchmarks/harness/scoring/compute_ci.py benchmarks/harness/raw_data/runs/

# Task sampling audit
python3 benchmarks/harness/scoring/sampler_audit.py benchmarks/harness/raw_data/runs/

# SWE-bench evaluation (secondary, Docker required)
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export CLAUDE_CONFIG_JSON="$HOME/.claude.json"
cd benchmarks/swe-bench && docker compose up --build
```
