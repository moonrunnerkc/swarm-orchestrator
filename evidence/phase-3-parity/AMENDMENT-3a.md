# Phase 3a — amendment

**Plan said:** the two retry loops (single-mode and tournament-mode) implement
the same generate→apply→verify→reprompt flow, dedupe them into one
`generateApplyVerify(persona, obligation, attempts)` helper.

**Code disagreed:** single-mode does sequential retry with error-feedback
reprompt; tournament-mode does parallel candidates per round with verifier
scoring and temperature/persona diversity across rounds. No reprompt-with-
feedback exists in tournament. The real duplication is the **inner**
snapshot→apply→workspace-ledger→verify→test-framework-misuse→rollback unit,
shared between single-mode's inline retry-attempt body and tournament's
`applyCandidate` callback.

**What 3a does instead:** extracts `attemptApplyAndVerify({ obligation,
obligationIndex, responseText, repoRoot, ledger, runId, fileMustExistPaths,
commandTimeoutMs, renderContext, trigger }) → { satisfied, applyDetail,
verifyDetail, applyOk, applied, pre }` — fully typed at the seam — and threads
it through both modes. Reprompt-with-feedback stays in single-mode's retry
loop (mode-specific behavior). The four module extractions
(`persona-message.ts`, `file-context.ts`, `test-framework-misuse.ts`,
`tournament-driver.ts`) proceed as in the plan; `tournament-driver.ts` becomes
the home for `executeTournament` and its `applyCandidate` callback (the
scheduler→tournament glue formerly in `manager.ts`), not a thin re-export —
the re-export shim wouldn't have removed any LOC from manager.ts.

**Actual LOC delta:** −17 (manager.ts 1,676 → 1,139; four extracted modules
total 520 across persona-message.ts 237 + tournament-driver.ts 169 + test-
framework-misuse.ts 64 + file-context.ts 50). Materially under the revised
−80…−150 target the user approved. Phase 1's WHAT-comment trim had already
collected most of the easy reductions from manager.ts before 3a started, and
the actual retry-loop dedup gain was small (~60 LOC) because tournament-mode's
round loop wasn't sequential-retry-shaped to begin with. 3b is expected to
carry the largest share of the Phase 3 LOC budget (target ~1,000 LOC from
CLI v8 argv consolidation); if 3b or 3c materially undershoot, the same
amendment-first protocol applies.

Halt conditions met: tournament fixed-seed parity captures byte-identical
(verified by re-running this directory's harness against pre-cut vs post-cut
builds), `tsc --noEmit` clean, 114 population tests pass, `npm test` totals
2,458 → 2,465 (7 new tests for `attemptApplyAndVerify`).
