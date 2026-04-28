# Architecture

> Project overview in [README.md](README.md). High-level positioning: a falsification and attestation layer for AI coding agents — agents produce patches, the orchestrator tries to break them, and only patches that survive merge. Hard-gate layers stop bad patches; advisory layers feed a composite score that flags patches for human review.

## Module Layout

### `src/verification/`

| File | Layer | Responsibility |
|---|---|---|
| `differential-gate.ts` | 1, hard | Runs the synthesized regression test against pre-state and post-state, asserts fail-to-pass transition. |
| `test-synthesizer.ts` | 1, hard | Drives the reviewer role to produce a regression test. Returns `GENERATED`, `AMBIGUOUS_GOAL`, or `GENERATION_FAILED`. |
| `mutation-gate.ts` | 2, hard | Runs Stryker (JS/TS) or mutmut (Python) on changed files, parses the surviving-mutant ratio, applies `failBelow` and `warnBelow` thresholds. |
| `cheat-detector.ts` | 3, advisory | Diff-based heuristics for hardcoded answers, exception swallowing, unauthorised test-file edits, complexity mismatch, mock mutation. Optional Semgrep rule pack overlay. |
| `property-gate.ts` | 4, advisory | Discovers modified functions, generates fast-check (JS/TS) or Hypothesis (Python) harnesses, runs each for 60 s, captures counterexamples. Untyped JavaScript runs in advisory-only mode. |
| `attestation.ts` | 5, advisory | Builds the in-toto SLSA v1.0 envelope, signs via the configured cosign signer, attaches as a git note, verifies notes on demand. |
| `cosign-attestation.ts` | 5, advisory | Cosign keyless and key-based signing implementations behind the `AttestationSigner` interface. |
| `composite-score.ts` | composite | Computes `(0.4 × cheatDetector + 0.4 × propertyGate + 0.2 × attestation) − advisoryGatePenalty`, applies the threshold (default 0.7), reports `humanReviewRequired`. |
| `command-runner.ts` | shared | Bounded subprocess execution with timeout. Used by every gate that shells out. |
| `diff-analysis.ts` | shared | Unified-diff parser, literal extraction, test-file path detection. |

### `src/scheduling/`

| File | Responsibility |
|---|---|
| `dependency-analyzer.ts` | Static dependency analysis between plan steps. Identifies independent steps that can run in parallel. The planner does not declare independence; the analyzer detects it. |
| `work-stealing-queue.ts` | Bounded work-stealing queue used by the parallel executor for steps the analyzer cleared. |

### `src/types/plan.ts`

Three step types:

- `WorkerStep` — implementation work assigned to the worker role.
- `ReviewerStep` — review or test-synthesis work assigned to the reviewer role.
- `RoleStep` — discriminated union of the two.

### `src/adapters/`

One adapter per agent backend. All adapters use `process-supervisor.ts` for subprocess lifecycle and the shared `AgentAdapter` interface.

| File | Backend | Modes |
|---|---|---|
| `copilot-adapter.ts` | GitHub Copilot CLI | cold-start (default), persistent-interactive (experimental, `SWARM_ENABLE_PERSISTENT_INTERACTIVE=1`) |
| `claude-code-adapter.ts` | Claude Code | cold-start (default), persistent-interactive (experimental) |
| `codex-adapter.ts` | Codex CLI | cold-start (default), persistent-interactive (experimental) |
| `process-supervisor.ts` | shared | bounded subprocess, stdout/stderr capture, end-of-turn marker detection |
| `adapter-factory.ts` | shared | adapter selection from CLI flag |
| `persistent-session.ts` | shared | persistent stdin/stdout session with end-of-turn marker contract |

Capability matrix and end-of-turn contract details are in [docs/adapters.md](docs/adapters.md).

## Checkpoint Interruption Flow

The orchestrator runs an agent against a goal, captures the resulting diff at structured checkpoints, runs the falsification battery, scores it, and either feeds advisory feedback back into the agent's next turn or hard-gate halts the run.

```
                            +-------------------+
                            |       goal        |
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |   plan generator  |
                            |   (worker +       |
                            |    reviewer steps)|
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            | dependency        |
                            | analyzer          |
                            | (parallel safe?)  |
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |  reviewer step:   |
                            |  synthesise test  |
                            |  (Layer 1 setup)  |
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |    worker step    |
                            |    (agent runs)   |
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |  capture diff at  |
                            |  checkpoint       |
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |   battery runs    |
                            |   1: differential |  hard
                            |   2: mutation     |  hard
                            |   3: cheat detect |  advisory
                            |   4: property     |  advisory
                            |   5: attestation  |  advisory
                            +-------+-----------+
                                    |
                            +-------v-----------+
                            |  composite score  |
                            +-------+-----------+
                                    |
                  +-----------------+-------------------+
                  |                                     |
       +----------v---------+              +------------v------------+
       |  hard gate failed  |              |   composite < threshold |
       |  -> halt run       |              |   -> advisory feedback  |
       |                    |              |      back into agent    |
       +--------------------+              |      context, or human  |
                                           |      review             |
                                           +------------+------------+
                                                        |
                                            +-----------v---------+
                                            |  patch ready, sign  |
                                            |  envelope, merge    |
                                            +---------------------+
```

The advisory feedback path is what makes the battery composable: a low layer-3 score from cheat-detector findings is injected into the next worker turn as concrete advisory text, not as a merge block. Layer 1 and layer 2 failures halt the run.

## Removed Modules

The following ship in v6 and earlier but are deleted in v7. Any reference to them in current code is residual and should be cleaned up, not extended:

- BackendMaster, FrontendExpert, TesterElite, SecurityAuditor, DevopsPro, IntegratorFinalizer (six personas collapsed into worker + reviewer).
- Fleet executor (`src/fleet-executor.ts`).
- MCP server (`src/mcp-server.ts`).
- Plan cache and replay system.
- Critic governance wave.
- Web TUI dashboard (`src/dashboard.tsx`) and its dependencies (`react`, `ink`, `express`, `cors`, `body-parser`).
- The legacy completeness-rubric harness as the primary benchmark; superseded by the falsification catch rate.

## Output Artifacts

```
runs/<execution-id>/
  session-state.json
  metrics.json
  cost-attribution.json
  knowledge-base.json
  wave-N-analysis.json
  report.md
  report.json
  steps/
    step-N/share.md
  verification/
    step-N-verification.md
    step-N-attestation.json
```

Everything under `runs/` is gitignored. Secrets are auto-redacted at end of run.

## Configuration Precedence

- **Agent profiles**: project `config/default-agents.yaml`, then install-level, then `.github/agents/*.agent.md`.
- **Verification thresholds and weights**: built-in `DEFAULT_COMPOSITE_CONFIG`, then `.swarm/gates.yaml`, then `--quality-gates-config <path>`.
- **Environment**: project `.env`, then orchestrator install `.env`, then `~/.env`.
