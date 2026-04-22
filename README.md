<div align="center">

<br>

<p>
  <img src="docs/media/wasp.svg" alt="" width="36" height="36">
  <img src="docs/media/wasp.svg" alt="" width="52" height="52">
  <img src="docs/media/wasp.svg" alt="Swarm Orchestrator" width="72" height="72">
  <img src="docs/media/wasp.svg" alt="" width="52" height="52">
  <img src="docs/media/wasp.svg" alt="" width="36" height="36">
</p>

# Swarm Orchestrator

**CI/CD for AI-generated code. Run Copilot, Claude Code, or Codex in parallel; verify every claim against evidence; gate merges on 8 automated quality checks.**

_Not an autonomous system builder — an accountability layer around agents you already trust enough to run, but not enough to merge blind. Each step runs on its own isolated branch. Each claim (tests pass, build clean, commit made) is cross-referenced against the transcript and the actual filesystem. Failures are auto-classified, repaired with targeted strategies, and re-verified. Nothing reaches main without passing both the verification engine and the quality gate pipeline. The metric that matters is **cost per rubric point**, not wall-clock time._

<br>

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
&nbsp;&nbsp;
[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
&nbsp;&nbsp;
![Tests: 1420 passing](https://img.shields.io/badge/tests-1420%20passing-brightgreen.svg)
&nbsp;&nbsp;
![Node.js 20+](https://img.shields.io/badge/node-20%2B-green.svg)
&nbsp;&nbsp;
![TypeScript 5.x](https://img.shields.io/badge/TypeScript-5.x-blue.svg)

<br>

[Quick Start](#quick-start) · [What Is This](#what-is-this) · [Benchmarking](#benchmarking) · [Usage](#usage) · [GitHub Action](#github-action) · [Recipes](#recipes) · [Architecture](#architecture) · [Contributing](#contributing)

<br>

<img src="docs/media/swarm.png" alt="Swarm Orchestrator TUI dashboard showing parallel agent execution across waves" width="700">

<br>

</div>

---

<br>

## Quick Start

### See it run end-to-end

```bash
npm install -g swarm-orchestrator
# then set up any one of the agent CLIs below, and:
swarm demo demo-fast    # two parallel agents writing throwaway utilities, ~1 min
```

The demo runs the full orchestration pipeline end-to-end against two trivial tasks (write a `greet()` function, write a `double()` function) — you see the TUI dashboard, parallel waves, verification reports, and the auditable trail that a real run produces. It uses real agents, so one of the CLIs below must be installed and authenticated; pick whichever you already have.

### Run it against your own code

```bash
# Default: GitHub Copilot CLI
swarm bootstrap ./your-repo "Add JWT auth and role-based access control"

# Claude Code
swarm bootstrap ./your-repo "Add JWT auth" --tool claude-code

# Codex
swarm bootstrap ./your-repo "Add JWT auth" --tool codex
```

Requires Node.js 20+, Git, and at least one supported agent CLI:

| Agent | Install | Auth |
|-------|---------|------|
| GitHub Copilot CLI | `npm install -g @github/copilot` | Launch `copilot` and run `/login` (requires Node.js 22+) |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` |
| Codex | `npm install -g @openai/codex` | `OPENAI_API_KEY` |

<details>
<summary><strong>Build from source</strong></summary>

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install && npm run build && npm link
```

</details>

<br>

---

<br>

## What Is This

AI coding agents produce code fast. The problem is knowing whether that code actually works before it reaches your codebase. This orchestrator exists to answer that question with evidence, not assumptions.

Every agent runs on its own isolated git branch. Every claim an agent makes is cross-referenced against its Copilot session transcript for concrete evidence: commit SHAs, test output, build results, file changes. Steps that can't prove their work don't merge. Steps that fail get classified, repaired with targeted strategies, and re-verified. After merge, eight automated quality gates check the generated code for scaffold leftovers, duplicate blocks, hardcoded config, README claim accuracy, test isolation, test coverage, accessibility, and runtime correctness. Nothing reaches main without passing through both the verification engine and the quality gate pipeline.

The orchestrator wraps `copilot -p` (or `/fleet` for native parallel subagent dispatch) as an independent subprocess per step. It runs outside of Copilot's own execution model. You define a goal, it builds a dependency graph, launches steps as dependencies resolve, and manages the full lifecycle: branch creation, agent execution, transcript capture, evidence verification, failure repair, governance review, cost tracking, and merge. The entire execution produces an auditable trail of transcripts, verification reports, and cost attribution that you can inspect after every run.

Before execution begins, the cost estimator predicts premium request consumption based on the plan, model multipliers, and historical failure rates from the knowledge base. You can preview the estimate, set a hard budget, or run without limits.

_Originally a submission for the [GitHub Copilot CLI Challenge](https://github.com) in early 2026._

<br>

## Features

### Verification & Quality

- **Evidence-based verification** — every agent transcript is parsed for commit SHAs, test output, build markers, and file changes. Steps that can't prove their work don't merge.
- **Eight quality gates** — scaffold leftovers, duplicate code, hardcoded config, README claim drift, test isolation, test coverage, accessibility, runtime correctness. SARIF output for GitHub code scanning.
- **Failure-classified repair** — failures are categorized (build, test, missing-artifact, dependency, timeout) and retried with targeted strategies, up to 3 attempts with accumulating context.
- **Governance mode** — Critic agent scores steps on weighted axes, auto-pauses on flags for human approval. Supports pause, resume, approve, reject during execution.

### Cost Governance

- **Pre-execution cost estimation** — predicts premium request consumption factoring in model multipliers (1× for claude-sonnet-4/gpt-4o, 5× for o4-mini, 20× for o3), retry probability from historical failure rates, and overage cost.
- **Per-step cost attribution** — records estimated vs actual premium requests, retry counts, and prompt tokens per step, saved to `cost-attribution.json`.
- **Budget enforcement** — hard cap via `--max-premium-requests`, preview-only mode via `--cost-estimate-only`.

### Execution

- **Greedy scheduling** — steps launch the moment dependencies resolve, not when a wave finishes. Adaptive concurrency with octopus merge for multi-branch completion.
- **Branch isolation** — each step runs in its own git worktree and branch. `--strict-isolation` restricts cross-step context to transcript-verified entries only.
- **Multi-agent support** — Copilot CLI, Claude Code, Codex, and Claude Code Teams as backends. Eight built-in agent profiles; custom agents via YAML.
- **Persistent sessions** — resume from last completed step, full audit trail, Markdown and JSON report generation.

### Integrations

- **Fleet wrapper** (`--wrap-fleet`) — Copilot CLI native parallel subagent dispatch with version detection and fallback.
- **Web dashboard** — real-time TUI with step badges, wave health, cost attribution panel. Single HTML page, no build step.
- **Lean mode** — Delta Context Engine scans the knowledge base for similar past tasks, appending reference blocks to prompts.
- **Multi-repo orchestration** — per-repo wave loops, cross-repo verification, grouped merge. _(Experimental — see [limitations](#multi-repo).)_

<br>

---

<br>

## Benchmarking

Most agent-framework benchmarks report win rates on completeness — "we finished more tasks than them." That's the wrong metric. An approach that burns 10× the premium requests to get 5% more completeness isn't winning; it's just spending. The metric that matters is **cost per rubric point**: how many premium requests does each approach spend per attribute it actually delivers?

Three producers are compared head-to-head on the same tasks using a 22-attribute binary completeness rubric. No subjective scores, no weighted composites.

| Component | Description |
|-----------|-------------|
| [benchmarks/README.md](benchmarks/README.md) | Central hub — methodology, quick start, all evidence links |
| [benchmarks/harness/](benchmarks/harness/) | Three-producer harness, 22-attribute rubric, scoring scripts, raw data |
| [benchmarks/ladder/](benchmarks/ladder/) | Iterative ladder baseline with [fairness policy](benchmarks/ladder/PROMPT_FAIRNESS.md) |
| [benchmarks/ABC-compliance.md](benchmarks/ABC-compliance.md) | Agentic Benchmark Checklist audit — 30/30 items addressed |
| [benchmarks/swe-bench/](benchmarks/swe-bench/) | SWE-bench Lite _(secondary)_ — reproducibility on public tasks |
| [.github/workflows/continuous-benchmark.yml](.github/workflows/continuous-benchmark.yml) | CI workflow — nightly + release, tracked via Bencher |

**Producers:** ORCHESTRATOR (full swarm), SINGLE_SHOT (1 request), LADDER (deterministic prompt sequence, ≤30 requests). Statistical comparison via paired Wilcoxon signed-rank with Bonferroni correction.

**Metrics (automated only):** rubric completeness (22 binary attributes), premium request count (instrumented), cost per rubric point, wall-clock time, test-pass rate, coverage, security scans, repair-loop iterations. All reported as mean ± 95% CI.

**Current state (N=1 smoke tests, two tasks, 2026-04-17):** on simple tasks, all three producers converge on high completeness — ORCHESTRATOR and SINGLE_SHOT tie at 80–82%, LADDER hits 100%. The orchestrator's architecture is built for the regime this smoke test doesn't yet exercise: harder tasks where SINGLE_SHOT fails outright and LADDER burns compute unproductively. Harder tasks, stricter rubrics, and N≥30 are needed to measure the intended advantage. See [honest analysis](benchmarks/README.md#what-this-data-shows) for the full methodology and what's missing.

```bash
# Run all three producers (8 tasks each)
./benchmarks/harness/run_fresh.sh 8

# Statistical comparison
python3 benchmarks/harness/scoring/stat_test.py benchmarks/harness/raw_data/runs/
```

<br>

---

<br>

## Usage

### Working With Your Codebase

The primary workflow is pointing the orchestrator at an existing repo. `bootstrap` analyzes the codebase (languages, dependencies, build scripts, tech debt), generates a dependency-aware plan scoped to what's already there, and executes it.

```bash
# Analyze a repo and generate a plan
npm start bootstrap ./your-repo "Add comprehensive test coverage"

# Multi-repo orchestration (experimental — see limitations below)
npm start bootstrap ./frontend ./backend "Add shared auth layer"

# Generate a plan without executing (review first)
npm start plan "Refactor database layer to use Prisma"

# Execute a reviewed plan
npm start swarm plan.json
```

> <a id="multi-repo"></a> **Multi-repo is experimental.** Relationship detection does not yet enforce cross-repo execution ordering. Merges are not atomic across repositories. PR automation is per-repo; there is no coordinated multi-repo PR set.

### Single Tasks

For quick, focused work that doesn't need the full orchestration pipeline:

```bash
npm start quick "Fix the race condition in src/worker.ts"
```

### Commands

| Command | Description |
|---------|-------------|
| `npm start bootstrap ./repo "goal"` | Analyze repo(s) and generate a plan |
| `npm start run --goal "goal"` | Generate plan and execute in one step |
| `npm start plan "goal"` | Generate an execution plan from a goal (`--output json`) |
| `npm start swarm plan.json` | Execute a plan with parallel agents |
| `npm start quick "task"` | Single-agent quick task |
| `npm start gates [path]` | Run quality gates on a project (`--output json`) |
| `npm start dashboard [port]` | Start the web dashboard (default: 3002) |
| `npm start demo <name>` | Run a demo scenario |

<details>
<summary><strong>All commands</strong></summary>

<br>

| Command | Description |
|---------|-------------|
| `npm start use <recipe>` | Run a built-in recipe against current project |
| `npm start recipes` | List available recipes |
| `npm start recipe-info <name>` | Show recipe details and parameters |
| `npm start report <run-dir>` | Generate structured run report from artifacts |
| `npm start audit <session-id>` | Generate Markdown audit report |
| `npm start metrics <session-id>` | Show metrics summary (`--output json` or `--json`) |
| `npm start templates` | List available plan templates |
| `npm start status <id>` | Check execution status (`--output json`) |
| `npm start agents` | List configured agent profiles |

</details>


### Key Flags

| Flag | Effect |
|------|--------|
| `--tool <name>` | Agent backend: `copilot` (default), `claude-code`, `codex`, `claude-code-teams` |
| `--governance` | Enable advisory Critic review wave with scoring and auto-pause |
| `--lean` | Enable Delta Context Engine (KB-backed prompt references) |
| `--cost-estimate-only` | Print pre-execution cost estimate and exit without running |
| `--max-premium-requests <n>` | Abort if estimated premium requests exceed budget |
| `--verbose` | Enable debug-level logging (loaded config files, resolution paths, etc.) |
| `--output json` | Print machine-readable JSON for supported commands |
| `--resume <session-id>` | Resume a previously paused or failed session |

<details>
<summary><strong>All flags</strong></summary>

<br>

| Flag | Effect |
|------|--------|
| `--tool <name>` | Agent backend: `copilot` (default), `claude-code`, `codex`, `claude-code-teams` |
| `--governance` | Enable advisory Critic review wave with scoring and auto-pause |
| `--lean` | Enable Delta Context Engine (KB-backed prompt references) |
| `--cost-estimate-only` | Print pre-execution cost estimate and exit without running |
| `--max-premium-requests <n>` | Abort if estimated premium requests exceed budget |
| `--verbose` | Enable debug-level logging (loaded config files, resolution paths, etc.) |
| `--output json` | Print machine-readable JSON for supported commands |
| `--resume <session-id>` | Resume a previously paused or failed session |
| `--pm` | Enable PM Agent plan review before execution |
| `--model <name>` | Override the Copilot model |
| `--strict-isolation` | Force per-task branching; restrict context to transcript evidence |
| `--skip-verify` | Skip transcript verification (not recommended) |
| `--no-quality-gates` | Disable quality gate checks |
| `--confirm-deploy` | Enable deployment steps with tag/health-check/rollback (opt-in) |
| `--plan-cache` | Skip planning when a cached plan template matches (>85% similarity) |
| `--replay` | Reuse prior verified transcript for identical steps |
| `--mcp` | Enable MCP integration |
| `--quality-gates-config <path>` | Custom quality gates config file |
| `--wrap-fleet` | Prefix step prompts with `/fleet` for native parallel subagent dispatch |
| `--param key=value` | Set recipe parameters (with `use` command) |
| `--team-size <n>` | Max concurrent teammates per wave with `claude-code-teams` (1-5) |
| `--owasp-report` | Generate OWASP ASI compliance report after verification |
| `--sarif <path>` | Write quality gate results as SARIF 2.1.0 JSON (use `-` for stdout) |
| `--yes` / `-y` | Skip interactive confirmation prompts |
| `--pr auto\|review` | PR behavior after execution |

</details>

<br>

### Examples

```bash
npm start swarm plan.json --governance --lean --strict-isolation --pm
```

Run with Claude Code and OWASP compliance report:

```bash
npm start swarm plan.json --tool claude-code --governance --owasp-report
```

Run quality gates and produce SARIF for GitHub code scanning:

```bash
swarm gates ./your-repo --sarif results.sarif
swarm gates ./your-repo --sarif -  # write to stdout
swarm gates ./your-repo --sarif results.sarif --quality-gates-config custom.yaml
swarm gates ./your-repo --output json
```

Run a recipe:

```bash
npm start use add-tests --tool codex --param framework=vitest --param coverage-target=90
```

Plan and execute in one step:

```bash
npm start run --goal "Build a REST API with JWT auth" --lean --governance
```

Plan with caching:

```bash
npm start plan "Build a CLI tool" --plan-cache
npm start plan "Build a CLI tool" --output json
```

Preview cost before running:

```bash
npm start swarm plan.json --cost-estimate-only
```

Run with /fleet and a budget cap:

```bash
npm start swarm plan.json --wrap-fleet --max-premium-requests 30
```

> **Note:** When using `npm start`, flags pass through automatically. If npm warns about an unknown flag, use the `--` separator: `npm start -- plan "goal" --plan-cache`. Not needed with the global `swarm` command.

<br>

### Cost and Premium Requests

Every agent step consumes its own premium request, multiplied by the model's premium request multiplier (1x for claude-sonnet-4, gpt-4o, claude-opus-4; 5x for o4-mini; 20x for o3). A plan with 6 agents on a 1x model uses a minimum of 6 premium requests. When agents run in parallel within a wave, each one simultaneously consumes a request.

The multiplier comes from up to 3 automatic retries per step (exponential backoff), the Repair Agent spawning up to 3 additional sessions on verification failure, and fallback re-execution if all repair attempts fail. In practice, most steps succeed on the first attempt.

<details>
<summary><strong>Pre-execution cost estimation and budgets</strong></summary>

<br>

Before running a plan, the cost estimator predicts premium request consumption:

```bash
swarm swarm plan.json --cost-estimate-only
```

This prints a breakdown showing per-step estimates, retry buffer based on historical failure rates from the knowledge base, model multiplier, and projected overage cost, then exits without executing.

To set a hard budget that aborts execution if the estimate exceeds it:

```bash
swarm swarm plan.json --max-premium-requests 20
```

After execution, per-step cost attribution (estimated vs actual requests, retry counts, prompt tokens, fleet mode, duration) is saved to `cost-attribution.json` in the run directory and displayed in the web dashboard.

</details>

To minimize usage: use `--cost-estimate-only` to preview costs before committing, review your plan with `--pm` before execution, and start with a single `quick` task to verify your setup.

<br>

### Configuration

Agent behavior is defined in YAML config files under `config/`:

| File | Purpose |
|------|---------|
| `default-agents.yaml` | Six built-in step-executing agents |
| `repair-agent.yaml` | Repair Agent for failed-step retries |
| `pm-agent.yaml` | PM Agent for plan validation |
| `user-agents.yaml` | Your custom agents (template included) |

Each profile specifies purpose, scope, boundaries, done-definitions, output contracts, and refusal rules. Add custom agents by editing `user-agents.yaml`:

```yaml
agents:
  - name: MyAgent
    purpose: "What this agent does"
    scope:
      - "Area of responsibility"
    boundaries:
      - "What it should not touch"
    done_definition:
      - "Completion criteria"
```

Quality gate behavior is configured in `config/quality-gates.yaml`:

```yaml
enabled: true
failOnIssues: true
autoAddRefactorStepOnDuplicateBlocks: true
autoAddReadmeTruthStepOnReadmeClaims: true

gates:
  duplicateBlocks:
    enabled: true
    minLines: 12
    maxOccurrences: 2
```

#### Per-project gate configuration

Place a `.swarm/gates.yaml` file in your repository root to override gate defaults for that project. The schema is identical to `config/quality-gates.yaml`. Only include the fields you want to change; everything else inherits from built-in defaults.

```yaml
# .swarm/gates.yaml
gates:
  duplicateBlocks:
    minLines: 20
    maxOccurrences: 3
  accessibility:
    enabled: false
```

Resolution order: built-in defaults, then `.swarm/gates.yaml`, then `--quality-gates-config <path>`. Each layer deep-merges over the previous one. Unknown gate keys cause an error listing valid names.

You can also register custom executable gates without patching the orchestrator. Add `.swarm/gates/index.js` or `.swarm/gates/index.cjs` in the target project and export a `registerGates({ registerGate })` function.

```js
module.exports.registerGates = ({ registerGate }) => {
  registerGate({
    key: 'customGate',
    title: 'Custom Gate',
    defaultConfig: { enabled: true, threshold: 2 },
    async run() {
      return { id: 'custom-gate', title: 'Custom Gate', status: 'pass', durationMs: 0, issues: [] };
    }
  });
};
```

#### Config precedence

- Agent config: project `config/default-agents.yaml` overrides install-level `config/default-agents.yaml`; custom `.github/agents/*.agent.md` overrides both.
- Quality gates: built-in defaults, then `.swarm/gates.yaml`, then `--quality-gates-config`.
- Environment files: current project `.env`, then orchestrator install `.env`, then `~/.env`.
- Run with `--verbose` to log which config files and directories were resolved at startup.

#### SARIF output

The `--sarif <path>` flag on the `gates` command writes results as a SARIF 2.1.0 JSON file compatible with GitHub code scanning. See [GitHub Action](#github-action) for CI integration.

<br>

---

<br>

## Recipes

Reusable, parameterized plans for common tasks. Recipes modify existing projects (unlike templates, which create new ones).

```bash
npm start recipes                                        # list all
npm start recipe-info add-tests                          # show details
npm start use add-tests                                  # run with defaults
npm start use add-auth --param strategy=session --tool claude-code
```

| Recipe | Steps | Description | Key Parameters |
|--------|-------|-------------|----------------|
| `add-tests` | 3 | Add unit tests for untested modules | `framework` (jest/vitest/mocha), `coverage-target` |
| `add-auth` | 4 | Add authentication | `strategy` (jwt/session) |
| `add-ci` | 3 | Add GitHub Actions CI pipeline | |
| `migrate-to-ts` | 4 | Migrate JavaScript to TypeScript | `strict` (true/false) |
| `add-api-docs` | 3 | Generate OpenAPI spec and docs | `format` (openapi/markdown) |
| `security-audit` | 3 | Run security audit and fix findings | |
| `refactor-modularize` | 4 | Break monolithic code into modules | |

Create custom recipes by adding JSON files to `templates/recipes/`. See [docs/recipes.md](docs/recipes.md) for the schema and examples.

<br>

---

<br>

## GitHub Action

Run the orchestrator in CI with the reusable GitHub Action. Set `sarif: true` to run quality gates and upload results to GitHub code scanning.

```yaml
- uses: moonrunnerkc/swarm-orchestrator@main
  with:
    goal: "Add unit tests for all untested modules"
    tool: claude-code
    sarif: true
```

SARIF results are written as SARIF 2.1.0 JSON and uploaded via `github/codeql-action/upload-sarif@v3` for inline PR annotations.

See [docs/github-action.md](docs/github-action.md) for full inputs/outputs reference, agent CLI setup, and workflow examples.

<br>

---

<br>

## Architecture

```
Goal ──> Plan ──> Waves ──> Branches ──> Agents ──> Verify ──> Repair? ──> Merge
```

1. **Plan generation.** A goal becomes numbered steps, each assigned to a specialized agent with declared dependencies. Plans can be generated interactively, imported from a transcript, loaded from a template, or bootstrapped from repo analysis.
2. **Greedy scheduling.** Steps launch the moment their dependencies are satisfied, not when an entire wave finishes. The context broker emits events on step completion; the scheduler picks up newly-ready steps immediately. Adaptive concurrency adjusts limits based on success rates and rate-limit signals. Completed branches merge in batches via octopus merge when possible (one merge commit instead of N).
3. **Branch isolation.** Each step gets its own git worktree and branch (`swarm/<run-id>/step-N-agent`). With `--strict-isolation`, cross-step context is restricted to transcript-verified entries only.
4. **Copilot execution.** The orchestrator invokes `copilot -p` as a subprocess for each step, injecting the agent prompt plus dependency context from completed steps. Transcripts are captured via `/share` export.
5. **Verification.** The verifier parses each transcript for concrete evidence: commit SHAs, test runner output, build markers, file-change records. Agent claims are cross-referenced against this evidence. Missing required evidence fails the step.
6. **Critic review** (with `--governance`). A Critic wave runs after execution, before merge. The Critic scores each step using weighted deductions (build: -25, test: -20, commit: -10, lint: -5, claim: -5), produces a recommendation (approve/reject/revise), and auto-pauses on any flags for human approval. Scores are advisory; final merge decisions rest with the operator.
7. **Self-repair.** Failed steps are retried up to three times. The Repair Agent classifies each failure (build, test, missing-artifact, dependency, timeout) and applies a targeted strategy. Context accumulates across attempts.
8. **Merge.** Verified branches merge to main in wave order. For multi-repo plans, each repo group is verified independently before cross-repo verification and final merge.

<br>

```
                     ┌─────────────────────┐
                     │     Goal / Plan      │
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │   PM Agent Review    │  (optional --pm)
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │  Multi-Repo Grouping │  (optional repo field)
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │   Wave Scheduler     │  topological sort + lean KB scan
                     └──────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐
     │  Agent on     │  │  Agent on    │  │  Agent on    │
     │  branch step-1│  │  branch step-2│  │  branch step-3│
     └────────┬──────┘  └──────┬───────┘  └──────┬───────┘
              │                 │                  │
     ┌────────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐
     │   Verifier    │  │   Verifier   │  │   Verifier   │
     └────────┬──────┘  └──────┬───────┘  └──────┬───────┘
              │                 │                  │
              │     ┌───────────▼──────────┐      │
              └────>│   Repair Agent       │<─────┘  (up to 3 retries)
                    └───────────┬──────────┘
                                │
                    ┌───────────▼──────────┐
                    │   Critic Review      │  (optional --governance)
                    └───────────┬──────────┘
                                │
                    ┌───────────▼──────────┐
                    │   Merge to main      │
                    └───────────┬──────────┘
                                │
                     ┌──────────▼───────────┐
                     │   Quality Gates      │  (8 automated checks)
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │   Meta Analyzer      │  health + pattern detection
                     └──────────────────────┘
```

<br>

<details>
<summary><strong>Key modules</strong> (112 source files, 26,653 lines of TypeScript — <a href="ARCHITECTURE.md">full inventory</a>)</summary>

<br>

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `swarm-orchestrator.ts` | 2,090 | Greedy scheduler, dependency resolution, octopus merge, governance, cost tracking, merge orchestration |
| `verifier-engine.ts` | 622 | Evidence checking against transcripts, verification report generation |
| `share-parser.ts` | 715 | Transcript parsing: files, commands, tests, commits, claims, MCP evidence |
| `repair-agent.ts` | 452 | Failure classification, targeted repair strategies, context accumulation |
| `cost-estimator.ts` | 300 | Pre-execution cost prediction with model multipliers and KB calibration |
| `knowledge-base.ts` | 340 | Cross-run pattern storage, cost history, similarity matching |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete module reference across all 112 source files.

</details>

Output artifacts are written to `runs/<execution-id>/`. See [ARCHITECTURE.md — Output Artifacts](ARCHITECTURE.md#output-artifacts) for the full directory layout.

<br>

---

<br>

## Demos

Two built-in scenarios for verifying your setup or seeing the pipeline end-to-end.

> **Cost note:** Demos run real agent sessions against real APIs. Each step consumes at least one premium request (or API call for Claude Code / Codex). Use `--cost-estimate-only` to preview costs before committing.

```bash
npm start demo list          # see all scenarios
npm start demo-fast          # quickest: two parallel agents, ~1 min
npm start demo api-quick     # REST API with tests and Dockerfile, ~5 min
```

| Scenario | Agents | Waves | What gets built | Time |
|----------|--------|-------|-----------------|------|
| `demo-fast` | 2 | 1 | Two independent utility modules (parallel proof) | ~1 min |
| `api-quick` | 3 | 2 | REST API with health/CRUD endpoints, tests, and Dockerfile | ~5 min |

`demo-fast` proves parallel execution with zero dependencies. `api-quick` shows wave-based scheduling: BackendMaster builds the API first, then TesterElite and DevOpsPro run in parallel on wave 2. Each step consumes at least one premium request — see [Cost and Premium Requests](#cost-and-premium-requests).

<br>

---

<br>

## Common Issues

- **`gh` CLI not found** — the PR manager requires [GitHub CLI](https://cli.github.com/). Install it and run `gh auth login` before using PR-related features.
- **Agent subprocess hangs** — ensure the agent CLI (`copilot`, `claude-code`, or `codex`) is installed, authenticated, and responds to `--help`. The orchestrator invokes it as a child process.
- **Docker Compose fails to start** — verify Docker is running and port 5432 (PostgreSQL) is free. Use `docker compose logs <service>` to diagnose.
- **Python tests fail with import errors** — install Python dependencies: `pip install fastapi pydantic sqlalchemy uvicorn httpx pytest` or use the `.venv` if present.

<br>

---

<br>

## Status

Actively maintained. 112 source files, 92 test files, 1,398 tests passing across all packages. Development is ongoing with regular updates.

See [Releases](https://github.com/moonrunnerkc/swarm-orchestrator/releases) for version history.

<br>

---

<br>

## Contributing

```bash
npm install && npm run build && npm test
```

Run `npm test`, run `swarm gates .`, and keep commits descriptive. See [CONTRIBUTING.md](CONTRIBUTING.md) for sub-project tests, coding standards, and development guidelines.

<br>

---

<br>

## License

[ISC](LICENSE)

Built by [Bradley R. Kinnard](https://github.com/moonrunnerkc).
