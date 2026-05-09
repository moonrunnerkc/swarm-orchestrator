# Phase 4 redo inspection — config B'' (audit-and-corrections, 2026-05-09)

Operator inspection of every **ClaudeCode-unique catch** from the Phase 4 redo Config B'' run. ClaudeCode-unique catch = B' (Codex) passed AND B'' (Codex + ClaudeCode) did not, with ClaudeCode in the B'' falsifying-adapter list. The cross-family-diversity question reduces to: did ClaudeCode confirm-real catch material things Codex missed?

Other slices (B' caught it, B'' caught it; B' missed AND B'' missed; both caught) are excluded from this inspection because they do not carry the cross-family signal. They are still available in `evidence/phase4-redo/run/config-bp/<id>/result.json` and `…/config-bpp/<id>/result.json` if needed.

ClaudeCode-unique catches: **0**

No ClaudeCode-unique catches surfaced from the run. The machine-claimed cross-family-diversity verdict is **confirmed** (zero unique yield). Operator inspection is therefore trivially complete (nothing to inspect); the corrected close-out in Part F records "0 confirmed unique catches" and pins the diversity thesis on the API-equivalent denominator.

## Aggregate

- Machine-claimed ClaudeCode-unique catches: 0
- Operator-confirmed real failures: TODO until inspection completes
- Operator-confirmed predicate-gaming: TODO until inspection completes
- Operator-confirmed mechanical false positives: TODO until inspection completes

**Conservation check (operator fills in):**

machine-claimed === sum(operator categories) must hold; any discrepancy means a candidate was double-counted or missed.

## Cross-family-diversity verdict (operator-confirmed)

- 0 confirmed unique catches → cross-family-diversity thesis **CONFIRMED** (Codex covers the obligation surface; same-family ClaudeCode is redundant).
- ≥ 1 confirmed unique catches → cross-family-diversity thesis **INVALIDATED** on this obligation surface; the audit-and-corrections DECISIONS.md entry's third-adapter-revisit condition fires and Phase 5 returns to the table.

## Provenance

- Skeleton generator: `scripts/inspection/build-phase4-redo-skeleton.ts`.
- Source artefacts: `evidence/phase4-redo/run/config-bp/<id>/result.json`, `evidence/phase4-redo/run/config-bpp/<id>/result.json`, `…/claude-code-result.json` per obligation.
