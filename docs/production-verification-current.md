# Production verification flow today

This document maps the production verification path as of Phase 0 of the v7 battery production-wiring work. The goal is to describe what runs today before choosing where the five-layer falsification battery should be inserted.

## Which function runs verification on an agent output?

Production step verification runs inside `executeStepInSwarm` in `src/orchestrator/step-executor.ts`. `SwarmOrchestrator.executeSwarm` delegates scheduling to `_runWaveLoop` (`src/swarm-orchestrator.ts:412`), and the scheduler calls back into the orchestrator host to execute each ready step (`src/orchestrator/wave-scheduler-loop.ts:107`). The orchestrator implements that host through `StepExecutorHost`, whose required `verifier` is a `VerifierEngine` (`src/orchestrator/step-executor.ts:123`).

After the agent session finishes and any uncommitted work is auto-committed, `executeStepInSwarm` enters the verification phase (`src/orchestrator/step-executor.ts:373`) and calls:

```text
host.verifier.verifyStep(stepNumber, agentName, transcriptPath, requirements, shareIndex, evidenceLogPath, { workdir, baseSha })
```

The exact call is at `src/orchestrator/step-executor.ts:382`. The `baseSha` passed to outcome checks is captured before the agent runs (`src/orchestrator/step-executor.ts:212`), and the result is assigned back to the step result at `src/orchestrator/step-executor.ts:399`.

`SwarmOrchestrator` constructs the verifier in its constructor as `new VerifierEngine(this.workingDir)` (`src/swarm-orchestrator.ts:185` and `src/swarm-orchestrator.ts:190`).

## What does the verification function call?

The production verifier is `VerifierEngine.verifyStep` (`src/verifier-engine.ts:118`). Its current checks are v6-era evidence checks, not the v7 battery.

The verifier:

- Reads and parses the `/share` transcript or fails if the transcript is missing (`src/verifier-engine.ts:135`).
- Checks transcript claims for tests, builds, commits, and unsupported claims (`src/verifier-engine.ts:160`, `src/verifier-engine.ts:166`, `src/verifier-engine.ts:172`, and `src/verifier-engine.ts:178`).
- Cross-references hook evidence when the caller supplies an evidence log (`src/verifier-engine.ts:183`).
- Runs outcome-based checks when the caller supplies a worktree and base SHA (`src/verifier-engine.ts:189`).
- Computes pass/fail from required checks (`src/verifier-engine.ts:207`) and returns a `VerificationResult` (`src/verifier-engine.ts:224`).

After the per-step verifier returns, the step executor records the result in metrics (`src/orchestrator/step-executor.ts:401`), writes a per-step verification report (`src/orchestrator/step-executor.ts:404` and `src/orchestrator/step-executor.ts:411`), and commits that report when the step passed (`src/orchestrator/step-executor.ts:432`).

Final quality gates are separate. After the scheduler loop completes, `executeSwarm` loads gate configuration once (`src/swarm-orchestrator.ts:404`), cleans remaining worktrees, installs newly added dependencies, retries failed steps, and then calls `_runFinalGatesPipeline` (`src/swarm-orchestrator.ts:522` and `src/swarm-orchestrator.ts:526`). The final gate pipeline calls `run_quality_gates` (`src/orchestrator/final-gates-remediation.ts:257`) and stores results on `context.finalGateResults` (`src/orchestrator/final-gates-remediation.ts:261`).

## What findings does current verification produce?

The per-step verifier returns `VerificationResult`, not the unified `Finding` schema. Its findings are `VerificationCheck[]` with a fixed type union of transcript and outcome checks (`src/verifier-engine.ts:22`), plus `unverifiedClaims`, `failureContext`, `summary`, and optional `baseSha` (`src/verifier-engine.ts:32`).

The final quality gates return `GateResult[]`, whose issues are `GateIssue[]` with `message`, optional `filePath`, optional `line`, `excerpt`, and `hint` (`src/quality-gates/types.ts:3` and `src/quality-gates/types.ts:11`). These are also not the unified `Finding` type.

The unified `Finding` schema lives in `src/types/finding.ts`, with `line`, `file`, and `summary` scopes (`src/types/finding.ts:22`, `src/types/finding.ts:29`, and `src/types/finding.ts:34`). Current production step verification does not emit that schema.

## Where does the verification result feed the rest of the run?

Per-step verification controls whether a step is accepted:

- Passing results add context for downstream steps, including changed files, branch name, commit SHAs, and `verificationPassed` (`src/orchestrator/step-executor.ts:413` and `src/orchestrator/step-executor.ts:417`).
- Failed results trigger rollback handling in the step executor (`src/orchestrator/step-executor.ts:457`).
- The scheduler aggregates each `SchedulerStepResult`, whose shape includes `verificationResult?: VerificationResult` (`src/orchestrator/wave-scheduler-loop.ts:29`).

After the scheduler loop, `executeSwarm` collects failed step results (`src/swarm-orchestrator.ts:454`) and re-queues retriable failed steps before quality gates. The retry task includes the failed step's `verificationResult.failureContext` when available (`src/swarm-orchestrator.ts:494`).

The final quality-gate pipeline can still fail the run after step retries if `pipelineResult.passed` is false and gate configuration says to fail on issues (`src/swarm-orchestrator.ts:530`). The production run then performs the final merge sweep (`src/swarm-orchestrator.ts:547`) and calls `runPostExecution` (`src/swarm-orchestrator.ts:555` and `src/swarm-orchestrator.ts:568`).

Post-run reporting persists `context.results` and `context.finalGateResults` into session state (`src/post-run-reporter.ts:109` and `src/post-run-reporter.ts:131`). OWASP mapping reads only `VerificationResult` objects from step results (`src/post-run-reporter.ts:151`). The generated run report can read a `falsification-battery.json` file if one already exists (`src/report-generator.ts:108`), and the renderer has a basic falsification battery section (`src/report-renderer.ts:58`), but production code does not write that file today.

## What is per-step verification vs final verification?

Per-step verification happens immediately after each agent-authored step, before the step is marked completed and before its context is made available to later steps. The boundary is `executeStepInSwarm`: agent execution and transcript parsing happen first, then `VerifierEngine.verifyStep`, then either context publication and report commit or failure handling (`src/orchestrator/step-executor.ts:382`, `src/orchestrator/step-executor.ts:413`, and `src/orchestrator/step-executor.ts:457`).

Final verification happens after the scheduler loop has drained, after failed-step retries, and before the final merge sweep and post-run reporter. The boundary is `_runFinalGatesPipeline` in `executeSwarm` (`src/swarm-orchestrator.ts:522`). The final path operates on the merged repository state and writes quality-gate artifacts, not per-step `VerificationResult` objects.

The current production flow therefore has two established hook points:

1. Per-step: inside `executeStepInSwarm`, adjacent to the existing `VerifierEngine.verifyStep` call.
2. End-of-run: inside `executeSwarm`, after failed-step retries and before final quality gates or final merge.

