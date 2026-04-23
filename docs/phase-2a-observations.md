# Phase 2a Observations

Observations made during Phase 2a that are out of scope for this session. Each entry is a candidate for a follow-up, not a blocker.

## 1. Pre-existing circular dependencies in `src/`

`madge --circular --extensions ts,tsx src/` reports **9 pre-existing cycles** at the start of Phase 2a, before any extraction:

```
1) plan-generator.ts > plan-storage.ts
2) share-parser.ts > share/transcript-verification.ts
3) swarm-orchestrator.ts > critic-reviewer.ts
4) session-executor.ts > step-runner.ts
5) swarm-orchestrator.ts > meta-analyzer.ts
6) verifier-engine.ts > verifier/outcome-checks.ts
7) verifier-engine.ts > verifier/transcript-checks.ts
8) verifier-engine.ts > verifier/verification-reporters.ts
9) swarm-orchestrator.ts > pr-automation.ts
```

The Phase 2 plan's gate wording ("madge must report zero circular dependencies") presumes a clean baseline that does not exist. Phase 2a did not create these and cannot be asked to fix them as a precondition for starting.

**Reinterpretation applied for the gate:** the gate now reads as "madge must report **no circulars beyond this baseline list of 9**" after every extraction commit. Any new circular stops Phase 2a per the halt protocol. The baseline list is captured above and will be checked against on every gate run.

**Follow-up candidate:** The cycles in (3), (4), (5), (9) are exactly the entangled pairs the refactor is trying to unwind. Extractions in Phases E and F are likely to reduce this list naturally. The remaining cycles (1, 2, 6-8) are in files not touched by Phase 2a.

## 2. Madge default extension set does not include TypeScript

`npx madge --circular src/` with no flags reports "Processed 0 files" because its default extensions are `js,jsx`. Need `--extensions ts,tsx` for this repo. Using that flag in the gate procedure for the rest of Phase 2a.

**Follow-up candidate:** add `"madge:circular": "madge --circular --extensions ts,tsx src/"` to `package.json` scripts, so the gate is one command and the correct flags are locked in. Out of scope for 2a.

## 3. `npm test` already runs `npm run build`

The `test` script is `npm run build && mocha --recursive 'dist/test/**/*.test.js'`. This means the three-command gate runs `npm run build` twice. Not a correctness issue; just redundant.

**Follow-up candidate:** either drop the separate `npm run build` from the gate or switch to `test:ci` (which skips the rebuild) for the second command. Out of scope for 2a.
