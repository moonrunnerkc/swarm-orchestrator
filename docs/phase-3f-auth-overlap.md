# Phase 3f: Auth Bisection Overlap

Result: **not applicable. P0 auth blocker did not reproduce in Phase 3a.**

Phase 3f is conditional on Phase 3a outcome (b): auth blocker still present, same error. Phase 3a hit outcome (a) — three consecutive successful demo-fast runs — so there is no current failure to bisect against.

## If the blocker returns

If auth starts failing again, the bisection harness at `scripts/debug/auth-bisect.ts` should be re-run against the new file layout. Post-decomposition, the five candidate root causes from the harness map as follows:

| Bisect candidate | Pre-decomp location | Post-decomp location |
|---|---|---|
| Missing env var propagation | `SwarmOrchestrator.executeStepInSwarm` (inline spawn) | `src/orchestrator/step-executor.ts:294-312` (adapter path) and `294-303` (copilot path via `SessionExecutor.executeSession`) |
| Worktree pollution from instruction files | `SwarmOrchestrator.writeSharedInstructions` → `_writeSharedInstructions` | Unchanged — still delegates to `src/prompt-builder.ts` |
| Prompt-length / rate-limit | Inline in `executeStepInSwarm` prompt-builder call | `src/orchestrator/step-executor.ts:209` → `_buildSwarmPrompt` in `src/prompt-builder.ts` (signature carries `{...context, targetProjectRoot: host.workingDir}`) |
| Runtime mutation from tsx executor | Unchanged by decomposition | Unchanged |
| Keyring session inheritance | Inline env construction at spawn | `src/orchestrator/step-executor.ts:251-258` builds `sessionOptions` from `options.model` / `options.onAgentLine`; actual env construction stays in `SessionExecutor` |

## Observations from the successful runs

Three demo-fast runs completed with:
- `backend_master:1` verified, committed, merged.
- `frontend_expert:2` verified, committed, merged.
- Both via `claude-sonnet-4` (copilot adapter).
- No auth error surfaced.

If the harness produces a different layer-pass pattern post-decomposition than it did pre-decomposition, the most plausible explanation is (per the Phase 3a result doc):

> Module boundary forces a fresh variable environment. The session spawn in step-executor.ts now runs inside a module-level function (executeStepInSwarm from src/orchestrator/step-executor.ts) rather than an instance method on a class that's been accumulating state since construction.

Re-running `scripts/debug/auth-bisect.ts` would validate or invalidate that hypothesis. Doing so now is low-priority given 3a's clean result.

## Verdict

No overlap to file. If the blocker returns, this document plus `docs/phase-3a-demo-fast-result.md` are the starting points.
