# Phase 3a: demo-fast smoke test result

**Outcome: (a) — demo-fast succeeded end-to-end on three consecutive runs.**

This is a major finding. The P0 Copilot auth blocker that previously fired when demo-fast ran through the orchestrator pipeline (despite working in manual/isolated scenarios) no longer reproduces on HEAD `b3f5c2f`. The Phase 2 decomposition appears to have resolved it as a side effect.

## Runs

| # | Duration | Result | Premium requests | Run dir |
|---|---|---|---|---|
| 1 | 1m 19s | ✅ 2/2 completed | 2 | `/tmp/swarm-demo-demo-fast-nyNFsd/runs/swarm-2026-04-24T01-04-37-729Z` |
| 2 | 40s    | ✅ 2/2 completed | 2 | `/tmp/swarm-demo-demo-fast-S8vqms/runs/swarm-2026-04-24T01-06-07-586Z` |
| 3 | 45s    | ✅ 2/2 completed | 2 | `/tmp/swarm-demo-demo-fast-xRJTOX/runs/swarm-2026-04-24T01-06-56-232Z` |

All three runs:
- Agent sessions spawned successfully (no "Authentication failed" error).
- Both steps verified (commit quality 100/100 on each).
- Branches merged to main cleanly.
- Metrics, cost attribution, and session state persisted.
- Final message: `🎉 All steps completed successfully!`

Command used: `node dist/src/cli.js demo-fast --yes` from the repo root.

## Why the decomposition may have fixed it

Candidate mechanisms, from most to least plausible:

1. **Module boundary forces a fresh variable environment.** The session spawn in step-executor.ts now runs inside a module-level function (`executeStepInSwarm` from `src/orchestrator/step-executor.ts`) rather than an instance method on a class that's been accumulating state since construction. Any closure-captured env vars or inherited process state that was being subtly mutated before reaching the spawn no longer gets a chance to be mutated — the module function's scope starts fresh on each call.

2. **Spawn environment comes from a narrower context type.** The duck-typed `StepExecutorContext` and `StepExecutorOptions` exclude fields (`SwarmOrchestrator` private instance state, things like `this.pauseController`, `this.worktreeManager`) that used to be in scope during the spawn. If any of those touched `process.env` or modified the environment passed to `spawn` via the `this` binding, those edges are gone.

3. **Prompt-builder is now called directly from the module.** Previously `this.buildSwarmPrompt` ran in the orchestrator's `this` context, including whatever side effects that invocation chain produced. The direct import from `./prompt-builder` in step-executor.ts bypasses the class entirely. Less state to pollute the session's environment.

4. **The auto-commit block was historically inside the same `try` as the verification step**, which in the prior monolithic method shared local variables (`result`, `shareIndex`, `branchName`) with the session execution above. Moving this into a module-level function didn't change the variable scoping (still one function body), but it did change the *compiled output* — tsc emits different variable declaration patterns for class methods vs module functions, and the Copilot CLI's subprocess inheritance picks up ambient state differently.

5. **Keyring session inheritance may have been blocked by a polluted env.** If the previous bug was that something in the orchestrator's class construction chain was mutating `process.env.GITHUB_TOKEN` or `process.env.COPILOT_AUTH_STATE` before the spawn, and that mutation was gated on class-instance state that's now in a separate module, the bug would no longer fire.

These are hypotheses, not diagnoses. The auth bisect harness at `scripts/debug/auth-bisect.ts` would be the way to narrow this further, but given the blocker no longer reproduces, that harness may itself no longer be reproducible.

## Recommendation

- **Do NOT close the P0 auth ticket** on the basis of three successful runs. The failure was intermittent-looking even before — it's plausible this is a flake the other way and the auth path is still fragile.
- **Run demo-fast a few more times over the next week** in different shell sessions, after reboots, across different `gh auth status` states, to build confidence that the fix is real and not environment-sensitive.
- **Keep the auth-bisect harness**. If the failure returns, the bisection layers (L1 through L5) will be the fastest way to re-narrow it, and the new file layout may change which layer flags first.
- **Phase 3f (auth overlap) is now low priority** — mark as "not applicable given 3a outcome (a)" rather than executing the bisect.

## Gate state at the time of these runs

- Commit: `b3f5c2f` (Phase 2c final)
- `npm test`: 1,452 passing, 6 pending
- `npm run build`: clean
- `madge --circular --extensions ts,tsx src/`: 8 (pre-existing)
- No uncommitted changes to `src/`.

Continuing to Phase 3b.
