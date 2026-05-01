# Falsification battery integration options

Phase 0 identifies three viable production integration shapes. The decision is a design choice because latency, retry behavior, and report semantics differ materially.

| Option | Summary | Primary tradeoff |
| --- | --- | --- |
| A. Per-step integration | Run all five layers after every agent-authored step. | Best chance to course-correct early, highest per-step latency. |
| B. End-of-run integration | Run all five layers once after all agent steps and failed-step retries complete. | Lowest control-flow risk, delayed discovery. |
| C. Hybrid integration | Run hard gates per-step and advisory gates at end-of-run. | Balanced latency and feedback, more complex result plumbing. |

## Option A: Per-step integration

### Changes in `src/swarm-orchestrator.ts`

`executeSwarm` would remain the scheduler owner, but the battery hook would sit inside step execution rather than in the top-level method. The top-level flow already delegates each ready step to `_runWaveLoop` (`src/swarm-orchestrator.ts:412`), and each step already returns a result with optional `verificationResult` (`src/swarm-orchestrator.ts:59`). This option would require the step result/context type to carry a `BatteryResult` alongside the existing `VerificationResult`.

### Changes in `src/verifier-engine.ts`

`VerifierEngine` would be augmented, not replaced in Phase 1. The existing `verifyStep` call would still run (`src/orchestrator/step-executor.ts:382`), and a new battery runner call would run immediately adjacent to it. The legacy `VerificationResult` schema would remain unchanged during Phase 1 so existing retry and report paths keep working.

### Findings flow

The battery runner would need per-step context already available in `executeStepInSwarm`: worktree path, base SHA, step task/goal text, agent identity, transcript path, changed files from the parsed share index, and branch/commit information (`src/orchestrator/step-executor.ts:382`, `src/orchestrator/step-executor.ts:394`, and `src/orchestrator/step-executor.ts:426`). Its unified `Finding[]` would be attached to the step result, persisted in the per-step verification report, and later exposed to post-run reporting through `context.results`.

### Composite score use

For each step, hard-gate failures from differential and mutation would mark that step failed or trigger retry. Advisory layers would feed the composite score and human-review decision. This requires deciding how to synthesize or obtain a regression test command per step before running the differential layer; today the harness receives a test spec, while production does not (`benchmarks/falsification-corpus/harness.ts:135`).

### Latency profile for a typical 3-file patch

A typical 3-file patch would pay the battery cost once per agent step. Differential runs a test command twice in detached worktrees. Mutation can run Stryker/mutmut/PITest with a default 600 second timeout (`src/verification/mutation-gate.ts:240`). Property testing can run up to 60 seconds per discovered function (`src/verification/property-gate.ts:221`). Cosign signing/verification has a 300 second timeout for cosign operations (`src/verification/cosign-attestation.ts:41` and `src/verification/cosign-attestation.ts:117`). For a multi-step plan, this shape has the largest wall-clock cost and directly lengthens every checkpoint.

## Option B: End-of-run integration

### Changes in `src/swarm-orchestrator.ts`

The battery hook would run once after `_runWaveLoop`, failed-step retries, cleanup, and dependency installation, and before or alongside final quality gates. The natural insertion point is after dependency installation and failed-step retry handling (`src/swarm-orchestrator.ts:468` and `src/swarm-orchestrator.ts:473`) and before `_runFinalGatesPipeline` (`src/swarm-orchestrator.ts:522`).

The result would be added to `SwarmExecutionContext`, then post-run reporting would persist and render it. `runPostExecution` already receives the full context (`src/swarm-orchestrator.ts:559`) and session-state persistence already records final gate results (`src/post-run-reporter.ts:131`), so the additive shape is straightforward.

### Changes in `src/verifier-engine.ts`

`VerifierEngine` would be unchanged in Phase 1. Legacy per-step verification would continue to decide step acceptance, retries, and rollback. The battery runner would be a new end-of-run verifier alongside final quality gates.

### Findings flow

The runner would aggregate a repository-level diff from the baseline or main branch to the final merged result. Its `Finding[]`, composite score, layer results, failed layers, and wall-clock time would be written into a run artifact such as `falsification-battery.json`. `ReportGenerator` already has a read path for that filename (`src/report-generator.ts:108`), but the current `FalsificationBatteryReport` type is too small for finding lists and severity counts (`src/report-generator.ts:58`), so the report schema would need expansion.

### Composite score use

In Phase 1, the composite score would be reported but would not replace legacy gate decisions. Hard-gate failures could be recorded as part of the battery result without changing merge behavior until Phase 3. This is the least disruptive path for parallel operation.

### Latency profile for a typical 3-file patch

A typical 3-file patch pays the battery cost once for the final diff. Differential still needs an agreed test command or synthesized test artifact, mutation runs once over all changed supported files, property testing runs once over all discovered targets, and attestation runs once for the final commit. This is the lowest-latency option for a multi-step plan, but a failure found at the end cannot guide the earlier agent steps unless the run is requeued.

## Option C: Hybrid integration

### Changes in `src/swarm-orchestrator.ts`

The hard-gate portion would run per-step inside `executeStepInSwarm`, adjacent to the existing `VerifierEngine.verifyStep` call (`src/orchestrator/step-executor.ts:382`). The advisory portion would run once near final quality gates, after failed-step retry handling and before post-run reporting (`src/swarm-orchestrator.ts:522` and `src/swarm-orchestrator.ts:555`).

`SwarmExecutionContext` and `ParallelStepResult` would need to carry both per-step hard-gate results and final advisory battery results (`src/swarm-orchestrator.ts:59` and `src/swarm-orchestrator.ts:105`).

### Changes in `src/verifier-engine.ts`

`VerifierEngine` would be augmented in Phase 1. It would still produce `VerificationResult`, but the step executor would run the battery runner in `per-step` mode after or alongside the legacy verifier. In later phases, hard-gate failures could replace the legacy verifier as the primary step gate.

### Findings flow

Differential and mutation findings would attach to individual step results because they gate that step. Cheat detector, property gate, and attestation findings/evidence would attach to an end-of-run battery artifact and report section. The final report would need to merge both sources into one battery section while preserving which layer and phase produced each finding.

### Composite score use

Hard-gate failures would gate the step. Advisory layers would compute the final composite score using the existing scorer's natural inputs: cheat detector score, property gate score, attestation score, advisory statuses, and optional final quality-gate results (`src/verification/composite-score.ts:30`). This matches the current scorer better than forcing hard-gate outputs into an advisory score.

### Latency profile for a typical 3-file patch

For each agent step, latency includes differential and mutation only. End-of-run latency includes cheat detection, property testing, attestation, and composite scoring. This reduces repeated advisory work but still pays mutation cost per step, which can be significant if Stryker, mutmut, or PITest have to install or run for each patch.

## Cross-cutting integration gaps

The current harness is useful reference code but is not production-ready as-is. It returns `BatteryResult` local to `benchmarks/falsification-corpus/harness.ts` (`benchmarks/falsification-corpus/harness.ts:37`), handles setup errors in a harness-specific way (`benchmarks/falsification-corpus/harness.ts:119`), and names hard gates `intent` and `regression` rather than the production layer names (`benchmarks/falsification-corpus/harness.ts:74`).

Attestation does not currently emit unified `Finding[]`, and the finding producer union excludes attestation (`src/types/finding.ts:5`). A production runner must either keep attestation evidence in `LayerResult` only or explicitly extend the finding schema.

The report path already has a placeholder falsification battery section, but it lacks finding counts, file-line finding rendering, failed-layer handling, and wall-clock reporting (`src/report-renderer.ts:58`).

## Decision needed at Halt Point 1

Choose one integration shape before Phase 1 implementation:

- A: per-step integration.
- B: end-of-run integration.
- C: hybrid integration.

