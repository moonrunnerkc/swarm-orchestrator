# Phase 3e: Session Resume Path

Result: **no active resume execution path exists. Decomposition did not introduce or affect this gap.**

## What I found

1. **CLI help advertises `--resume <id>`.**
   - `src/cli/swarm-handlers.ts:555`: `--resume <id>              Resume a paused or failed session`
   - `src/cli/usage.ts:39`: `--resume <id>    Resume a previously paused/failed swarm session`

2. **The flag is parsed.**
   - `src/cli/flags.ts:153-154`:
     ```ts
     const resumeIndex = args.indexOf('--resume');
     if (resumeIndex !== -1 && args[resumeIndex + 1]) opts.session = args[resumeIndex + 1];
     ```
   - `ExecuteSwarmCliOptions.session?: string` at `src/cli/flags.ts:15`.

3. **The parsed value is never consumed by any execution path.**
   - `grep -rn "\.session\b" src/cli/swarm-handlers.ts src/swarm-orchestrator.ts` → 0 hits.
   - `grep -n "opts.session\|options\.session" src/` → only the assignment in flags.ts.
   - `executeSwarm` (in `src/swarm-orchestrator.ts`) does not take a session option or load prior session state before running.

4. **Session state IS persisted.**
   - `src/post-run-reporter.ts:138` writes `runDir/session-state.json`.
   - `src/metrics-collector.ts:127` mirrors the write via `MetricsCollector.saveSession`.

5. **Session state IS loaded, but only for inspection.**
   - `src/metrics-collector.ts:133`: `loadSession(id: string): SessionState | null`.
   - Consumers: `src/cli/status-handlers.ts:72, 244, 264` — these are the `swarm status`, `swarm audit`, `swarm metrics` commands. They read the JSON and print summary output. None of them resume execution.

## Impact on the decomposition

None. The `--resume` flag was advertised but non-functional before Phase 2, and remains advertised-but-non-functional after Phase 2.

- `post-run-reporter.ts` writes the same `session-state.json` shape it wrote before the duplicate removal in Phase 2a (the behavioral diff report captured zero divergences in the write).
- `metrics-collector.ts` was not touched by the decomposition.
- Status/audit/metrics handlers were not touched.

If a future session writes a resume execution path, it would need to:

1. Read `runs/<id>/session-state.json` via `MetricsCollector.loadSession(id)`.
2. Reconstruct a `SwarmExecutionContext` with:
   - `plan` = the stored plan (the persisted shape includes `graph.goal` and `graph.steps` — would need expansion back to full `ExecutionPlan`),
   - `results` = reconstructed from `branchMap` + `transcripts` + `gateResults`,
   - `metricsCollector`, `knowledgeBase`, etc. = re-initialized,
   - `baselineSnapshot` = either re-scanned or persisted alongside session-state.
3. Set the scheduler to skip steps whose `lastCompletedStep` is ≤ current step number.

The extracted modules support this pattern: all of them take context as a mutable parameter and would operate on a reconstructed context without modification. No class-internal state would need to be rehydrated because Phase 2 pushed that state onto the context object.

## Verdict

Not applicable to this phase: no active resume path to verify. The decomposition is not implicated. The gap is pre-existing and orthogonal to the refactor.

Observation (out of scope): the CLI advertises a feature that doesn't exist. Worth filing for future cleanup (`docs/phase-2a-observations.md`-style), but not part of Phase 3.
