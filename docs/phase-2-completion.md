# Phase 2 Completion Report

Date: 2026-05-01.
Scope: P1 evals on real data (Layer 1 synthesizer, Layer 3 cheat
detector, Layer 4 property gate) per the v7 plan precondition for
Phase 3 (battery becomes primary verifier).

This is a status report. It does **not** declare success. It
describes what was measured, what cleared the v7 halt thresholds,
and what is still open before Phase 3 can begin.

## Per-eval summary

| Layer | Eval | Result | Halt-threshold status | Phase 3 readiness |
|---|---|---|---|---|
| Layer 1 — Synthesizer | B.1 | **Blocked in-session, ready for external run** | Not measured | DATA PENDING |
| Layer 3 — Cheat detector | B.2 | FP = 0/20 (0%), known-cheat miss = 1/5 (20%) | **PASS** (FP > 10% halts; not tripped) | YES |
| Layer 4 — Property gate | B.3 | 0 genuine bugs / 28 advisory findings; all tooling artifacts | Threshold suspended (typed-target gap) | NO (needs typed sample or arity-aware harness) |

Detailed per-eval results in:

- `docs/p1-eval-results-cheat-detector.md`
- `docs/p1-eval-results-property-gate.md`
- `docs/p1-eval-results-synthesizer.md`

## What was actually measured

### Layer 3 (cheat detector) — RAN and PASSED

Re-ran `scripts/eval/cheat-detector-eval.ts` against the existing
25-case input (20 SWE-bench Verified gold patches + 5 hand-built
synthetic cheats) at
`docs/p1-eval-fixtures/eval-output/cheat-detector-input.json`.

- FP rate: **0 / 20 = 0%** on stratified gold patches across all 10
  repos in the seed=42 manifest.
- Known-cheat miss: 1 / 5 = 20% (the documented exception-swallowing
  return-fallback shape, tracked as a coverage gap, not a halt).
- Identical to the post-fix baseline run on 2026-04-28; no regression.
- Raw output (committed): `docs/p1-eval-fixtures/eval-output/phase-2/cheat-detector-results.json`.

The Layer 3 halt gate is on FP rate. Layer 3 clears.

### Layer 4 (property gate) — RAN, threshold suspended

Ran `scripts/eval/p1-run-evals.py --modes property --n 10` against
the first 10 instances of `instances-50.json` (astropy x2, django x8).

- 8 instances ADVISORY, 2 SKIP (gold patch did not modify a function
  declaration the discoverer recognizes).
- 28 modified functions, 28 advisory findings (100% flag rate per
  function).
- 0 typed targets; the corpus is entirely untyped Python.
- Per the user-specified manual classification:
  - 0 / 28 genuine edge-case bugs
  - 0 / 28 technically-valid-but-irrelevant counterexamples
  - **28 / 28 tooling artifacts** — every finding is the property-gate
    harness crashing because `@given(st.integers(), st.integers())`
    feeds 2 ints to functions that have arity ≠ 2 or expect non-int types.
- Raw output (committed):
  `docs/p1-eval-fixtures/eval-output/phase-2/property-gate-eval.jsonl`
  and `docs/p1-eval-fixtures/eval-output/phase-2/property-summary.json`.

The Layer 4 halt threshold (>= 2:1 genuine vs noise) is structurally
unreachable on this corpus, suspended per the Phase 2 step 1 decision.
The eval still answered the underlying question: the gate's pipeline
(clone, venv, gold patch, function discovery, harness write, run,
finding extraction, JSONL emit) works end-to-end without errors. It
just produces no actionable signal on untyped Python.

### Layer 1 (synthesizer) — BLOCKED in-session

The Claude Code adapter spawns
`claude --dangerously-skip-permissions` to drive the synthesizer.
That spawn is denied from inside an active Claude Code session
(creates a nested permissionless agent loop). Confirmed at the Bash
layer in this session.

The fix the Phase 2 step 2 directive called for **did land**:

- `scripts/eval/swebench-instance-evaluator.ts` accepts a `venvBin`
  field that wraps base + gold testCommand executions with
  `export PATH=<venvBin>:$PATH;` so `python` / `python3` / `pip` /
  `pytest` resolve to the per-instance venv.
- The same file rewrites embedded `cd <repoPath>` paths to point at
  the worktree on the gold run, neutralizing the synthesizer's
  occasional hardcoded absolute-cd in testCommand.
- `scripts/eval/eval-utils.ts` exports the new
  `rewriteCommandForWorktree` and `wrapCommandWithVenv` helpers.
- `scripts/eval/swebench-eval-cli.ts` plumbs `venvBin` through.
- `scripts/eval/p1-run-evals.py` is the new driver that prepares
  per-instance venvs and orchestrates the per-instance eval calls.
- 3 new unit tests in `test/eval/swebench-instance-evaluator.test.ts`
  cover both the cd-rewrite and the venv-wrap. Test suite at 1451
  passing, no regressions from the 1448 baseline.

The end-to-end env fix was verified on Layer 4 in this session
(28/28 modified functions discovered, all venv-imports succeeded).
Layer 1 needs the same pipeline plus a Claude Code spawn, which has
to come from outside this session.

Instructions for the external run are in
`docs/p1-eval-results-synthesizer.md`. The driver reuses the
workspaces dir from the Layer 4 run, so cloning + venv prep does
not repeat. Estimated cost $2-4 in tokens, 25-50 min wall-clock at
N=10.

## What landed in code

Files added / modified for the Phase 2 step 2 env fix:

- Added `scripts/eval/p1-run-evals.py` (corpus prep + per-instance
  eval driver).
- Modified `scripts/eval/swebench-instance-evaluator.ts` — added
  `venvBin` field on both eval inputs; added cd-rewrite on gold run;
  wrapped property-gate runner with venv PATH.
- Modified `scripts/eval/swebench-eval-cli.ts` — plumbed `venvBin`
  through both task payload shapes.
- Added two helpers to `scripts/eval/eval-utils.ts` —
  `rewriteCommandForWorktree`, `wrapCommandWithVenv`.
- Added 3 tests in `test/eval/swebench-instance-evaluator.test.ts`
  (gold-run cd-rewrite, synth venv-wrap, property venv-wrap).

Production code untouched per the Phase 2 step 2 constraint:

- `src/verification/test-synthesizer.ts` — not modified.
- `src/verification/property-gate.ts` — not modified.
- `src/verification/cheat-detector.ts` — not modified.
- `src/verification/battery-runner.ts` and friends from Phase 1 —
  not modified.

## Cost spent

- LLM cost: $0. Layer 1 was not run; Layer 3 and 4 are local-only.
- Claude Code session time: substantial — clone + venv + editable
  install for 12 instances (10 + 2 smoke), property-gate runs for
  all 12. The 38GB+ of cached deps lives under
  `docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/` and
  on the smoke dir; this is reusable when Layer 1 runs externally.

Well under the $15 ceiling. No mid-run halt was triggered.

## What is still open

### Hard blockers for Phase 3

1. **Layer 1 synthesizer eval has not run.** Until it does, FP / FN
   numbers on real data are unknown for the layer the v7 plan most
   wants production-tested. This is required before the battery can
   become the primary verifier.

   Action: external operator runs the documented command
   (`docs/p1-eval-results-synthesizer.md`) and pastes results back.
   That is a minutes-of-attention task, not a redesign.

### Soft blockers (not Phase 3 hard-stops, but worth fixing)

2. **Layer 4 produces no signal on untyped Python.** The 28/28
   tooling-artifact rate on the 50-set means Layer 4 cannot certify
   real Python patches as correct — it can only flag "function
   signature does not accept (int, int)." For Phase 3 to claim Layer
   4 as a primary verifier, one of:
   - Run a separate eval on a typed-TS sample (the gate's design
     point).
   - Extend `pythonHarness` to read function arity / type hints and
     direct generation accordingly.

3. **Layer 3 has a coverage gap on `exception-swallowing`
   return-fallback shape.** The Phase 2 step 1 doc and Layer 3
   results doc both identify this; it is tracked as a follow-up for
   the rule pack work in `v7-pr-comments-and-rule-pack-plan.md`.

### Out of Phase 2 scope (don't relitigate now)

- Whether the SWE-bench Verified manifest itself is the right corpus.
- Whether new eval categories (e.g. mutation) belong in this layer
  ladder.
- The Phase 1 end-of-run battery hook design.

## What this report does NOT claim

- It does **not** claim Phase 2 is "done." Layer 1 is unrun.
- It does **not** claim the battery is ready to become the primary
  verifier. Layers 1 and 4 each have unresolved questions.
- It does **not** propose tuning the property gate to clear its halt
  threshold. Per the v7 directive, the eval measures the gate as it
  stands; engineering it past the threshold is Goodhart and not
  permitted.

## Recommended next step

External operator runs the Layer 1 eval per
`docs/p1-eval-results-synthesizer.md`. On completion:

1. Update `docs/p1-eval-results-synthesizer.md` with the FP/FN table.
2. Update this completion report's Layer 1 row to reflect the
   measured outcome.
3. Decide based on Layer 1 results whether to expand to N=20 (only
   if borderline within 5pp of either threshold).
4. Schedule the typed-TS Layer 4 eval as the gate item before Phase
   3 begins.
