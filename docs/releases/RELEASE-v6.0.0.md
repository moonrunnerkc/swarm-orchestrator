# v6.0.0 Release Notes

v6.0.0 consolidates three workstreams on top of v5.0.0's foundation: statistical benchmarking rigor, planner-fidelity improvements, and orchestrator output-correctness. Work spans 260 commits across 11 days (April 11–22, 2026), with detailed progress documented in the April 18 session report for Tranche 1 and in the PR history for Tranche 2. The session report was an internal build artifact and is not retained in the public repository.

## Theme 1: Statistical Benchmarking Rigor

The benchmark infrastructure was rebuilt from subjective author-scored rubrics to fully automated, reproducible metrics with statistical reporting. Every claim is backed by raw data, bootstrap confidence intervals, and an ABC-compliance audit that closed at 30/30 verified items. Detailed P2-P5 work — the statistical harness, parseCopilotRequestCount fix, ABC audit, and legacy rubric cleanup — is documented in the April 18 session report rather than re-narrated here.

### Statistical Harness and Benchmarks

A bootstrap CI harness (`benchmarks/harness/run-n.sh` + `benchmarks/harness/scoring/bootstrap_ci.py`) runs any benchmark scenario N times and reports mean ± 95% CI over 10k resamples. Two benchmarks landed this cycle: `demo-fast` at N=10 and `api-quick` at N=5. Their generated summaries and raw outputs are excluded from Git. All benchmark data came from real orchestrator runs against real project code; no synthetic or author-selected tasks.

The April 18 session report covered raw data, per-metric tables, and the parseCopilotRequestCount fix that makes premium-request counts real instead of hardcoded. That report is archived outside the public repository.

Commits: `85fe1c7` (harness), `b5afb40` (demo-fast N=10 run), `9e93bf7` + `5b7dad2` (api-quick N=5 run)

### ABC-Compliance Audit

The Agentic Benchmark Checklist (ABC) — 30 items covering fixed public tasks, multiple runs, automated metrics, and full disclosure — was audited item by item. Initial state per the session report: 28 verified, 2 partial (items 3.3 and 5.2). Two post-report commits closed the remaining partials: `23fc541` updated D5/3.3 evidence pointers after the parseCopilotRequestCount fix, and `ab2d03c` added a named Conflicts of Interest section closing 5.2. Final state: 30 verified, 0 partial, 0 missing. The detailed audit and ABC-compliance summary are historical artifacts archived outside the public repository.

Commit: `7cecd8b` (initial audit), `23fc541` + `ab2d03c` (closeout)

### Constraint-Binding Pilot Harness

PR #22 introduced a constraint-binding benchmark harness with fetch-on-demand fixtures, a validator engine, byte-identical prompt invariant enforcement, and four pilot tasks (one per pattern: schema-then-query, rename-then-update-callers, contract-change-then-client, lift-then-reuse). N=1 pilot sweep produced 0/4 pass rate with four falsifiable hypotheses covering validator specificity, plan-ordering behavior, and fixture extraction paths.

The pilot's value is not the pass rate; it's the structured failure-mode data that drove the planner fixes in Theme 2 and the harness hygiene fixes landed in PR #32.

New files: `benchmarks/constraint-binding/tasks/*.yaml`, `benchmarks/constraint-binding/validator-engine.js`, `benchmarks/constraint-binding/SCHEMA.md`, `benchmarks/constraint-binding/SOURCES.md`, `benchmarks/constraint-binding/COMPARATOR-STATUS.md`, `scripts/fetch-fixtures.sh`
Modified: `benchmarks/harness/run_fresh.sh`

### SWE-bench Verified Harness Setup

PRs landed via the Phase 4a sync (PR #39) plus follow-ups #36 and #38 establish a SWE-bench Verified harness scaffold with stratified 50-instance sampling (seed=42), per-instance Docker image resolution, baseline citations, and reproducible evaluation scripts. The harness was exercised through smoke runs 3 through 9, surfacing and fixing three defect classes (detailed in Bug Fixes below).

v6.0 ships the harness ready-to-run with container-path execution pending v6.1.

New files: `benchmarks/swe-bench/evaluation-scripts/run_swebench.py`, `benchmarks/swe-bench/evaluation-scripts/worktree_reserved_paths.py`, `benchmarks/swe-bench/instances-50.json`, `benchmarks/swe-bench/baseline-citations.json`, `benchmarks/swe-bench/Dockerfile.eval`, `benchmarks/swe-bench/tests/test_smoke_postmortem_regressions.py`
Modified: harness wiring in `benchmarks/harness/`

---

## Theme 2: Planner Fidelity

Two independent benchmark observations — a contract-change-then-client task in the PR #22 constraint-binding pilot and the sympy-12481 SWE-bench smoke — surfaced three structural defects in the plan-generator's goal classification and template system. All three landed as separate PRs traceable to investigation issue #27.

### Preamble Hygiene (PR #29)

`createPlan` previously concatenated orchestrator preamble guidance onto the goal string before passing it to the classifier. For SWE-bench, the preamble's "do not modify test files" instruction leaked the word "tests" into the classifier input, routing bug-fix tasks to TesterElite as the primary agent. PR #29 layer-splits classifier input (`goal` only) from agent guidance (prepended to each step's task string after classification), enforced via the byte-identical prompt invariant test.

Merge commit: `19bdd19`

### Bug-Fix Goal Type (PR #30)

The planner had no concept of "fix an issue in existing code" as distinct from "build something new." Bug-fix goals fell to the generic classifier and produced plans without impl-editing steps. PR #30 adds `hasBugReportShape()` as a structural discriminator (≥2 backtick-wrapped code references AND ≥1 present-tense failure verb), a new template `generateBugFixSteps` routing to BackendMaster-primary with TesterElite regression + IntegratorFinalizer review.

Merge commit: `b114cbf`

### Contract-Change Goal Type (PR #31)

Rigid library template produced BackendMaster → TesterElite as separate steps, causing per-step `npm test` verification to fail against pre-existing tests when impl changes and test updates were separated. PR #31 adds a contract-change goal type with two-signal discriminator (≥2 backticks AND ≥2 imperative change verbs) and a bundled impl+callers+tests step that avoids the verification cascade. Also adds a gate-config guard skipping `testCoverage` auto-injection for contract-change goals.

Merge commit: `28e34e9`

### Supporting: Investigation Issue #27

Issue #27 documented the two observed plan-generator failures and proposed investigation scope. Resolution closed with three sub-issues: plan-generator fidelity (addressed in PRs #29/#30/#31), manifest-driven intent-to-add (addressed in PR #33), and Phase 4a sequencing (Option A: planner fixes before capture fixes).

---

## Theme 3: Verifier and Capture Correctness

Four PRs extending orchestrator output trustworthiness across the verify-then-merge pipeline.

### Target-Mode Gate Scoping (PR #35)

Running orchestrator quality gates against external target repos produced false-positive failures (accessibility checks against sympy, for example) and triggered replan cycles on gates that didn't apply. PR #35 adds a `targetMode` discriminator at the gate-runner chokepoint, with 7 gates classified as self-improvement (skipped in target mode) and 2 as universal (`hardcodedConfig`, `testFileProtection`). Reduced smoke-run wall clock 3× by eliminating replan churn.

Merge commit: `b029685`

### Union-Based Capture (PR #33)

`capture_agent_diff` previously relied on the agent's self-reported manifest from `/share` transcripts, missing silent-edit cases and orchestrator-internal writes. PR #33 implements option 1b from issue #27: union of agent-claimed manifest PLUS OS-observed changes outside orchestrator-reserved paths. Reserved-paths list centralized with bounded-list regression test (≤15 entries, currently 14).

Merge commit: `f629028`

### Commit-Level Reserved Paths (PR #36)

Per-step auto-commit with bare `git add -A` staged orchestrator-internal writes (`runs/`, `node_modules/`, `__pycache__/`) alongside agent work. PR #36 adds `WORKTREE_RESERVED_PATHS` constant mirroring the Python side and modifies `swarm-orchestrator.ts:1535` to use `gitPathspecExcludes()` with dual-form exclusions. Cross-language parity test locks the TS and Python lists against drift.

Merge commit: `aa5fc6a`

### Capture-Time Diff Excludes (PR #38)

`git diff base_commit` bypassed the pathspec excludes applied at staging time, leaking committed scaffolding (`.copilot-instructions.md`, `runs/` transcripts) into SWE-bench patches. The patch then failed `git apply` against `/testbed` because the reserved paths don't exist in the evaluation container. PR #38 applies `git_pathspec_excludes()` to the final `git diff` invocation and adds `.copilot-instructions.md` to the reserved file-glob list. Regression tests cover both Problem A (branch reset to base_commit) and Problem B (capture-time diff exclusions). Validated clean by smoke9: patch contained exactly one file (`sympy/combinatorics/tests/test_permutations.py`).

Merge commit: `ab002c1` (via sync PR #39)

---

## Bug Fixes

### Classifier Preamble Leak

Preamble text concatenated onto the goal string before classification caused the TesterElite keyword regex to match "tests" in the preamble and allocate TesterElite as primary agent for bug-fix tasks. PR #29 — merge commit `19bdd19`.

### Plan-Generator Missing Bug-Fix Template

Bug-fix goals had no dedicated template or classifier branch. After preamble hygiene (PR #29), sympy-12481 fell through to IntegratorFinalizer as primary with no impl-editing step in the plan. PR #30 adds a structural bug-fix discriminator and template routing to BackendMaster as primary agent. Merge commit `b114cbf`.

### Plan-Generator Rigid Library Template

Separate impl and test-update steps caused verifier to run `npm test` after impl change but before test update, rolling back correct work. PR #31 — merge commit `28e34e9`.

### SWE-bench Branch Reset Missing

`checkout_repo` did `git checkout master` on detached HEAD, leaving `master` at HEAD (tip) rather than `base_commit`, causing the orchestrator to diff against the wrong baseline. Fixed with `git checkout -B master base_commit`. PR #38, regression test `test_checkout_resets_master_to_base_commit` — merge commit `ab002c1`.

### Capture-Time Diff Leak

`git diff base_commit` without pathspec excludes leaked `.copilot-instructions.md` and `runs/` scaffolding into SWE-bench patches, causing `git apply` failures in the evaluation container. PR #38 — merge commit `ab002c1`.

### Per-Step Commit Scaffolding Leak

`git add -A` at the per-step auto-commit site staged `runs/`, `node_modules/`, and `__pycache__/` alongside agent work, inflating commits with orchestrator-internal noise (31.7 MB in smoke3). PR #36 — merge commit `aa5fc6a`.

### Intent-to-Add Completeness Gap

`capture_agent_diff` relied solely on agent self-reported manifest, missing silent edits and orchestrator-internal writes. PR #33 implements union-based capture (manifest + OS-observed delta) with a centralized reserved-paths constant. Merge commit `f629028`.

### Bytes-Safe Diff Capture

`subprocess.run(..., text=True)` raised `UnicodeDecodeError` on diffs containing non-UTF-8 bytes (legacy encodings, binary-file markers, test fixtures with arbitrary byte sequences), aborting evals before any downstream processing. PR #26 adds bytes-mode capture with size guardrails and empty-diff detection. Merge commit `92b8201`.

### Branch Default Detection

Orchestrator hardcoded `'main'` as the integration branch fallback. On repos with `master` as default (sympy, scikit-learn pre-2022, astropy pre-2022), the orchestrator bailed with `Error: Failed to switch to branch main` on first branch switch. Affects approximately half the planned 50-instance SWE-bench sweep. PR #23 — merge commit `93dc360`.

### Pytest Rootdir Isolation

Verifier's outcome-check `pytest` invocation had no `--rootdir`. When a worktree copy of the repo's `conftest.py` existed under `runs/`, pytest's rootdir search walked up to the common ancestor and registered both conftests, triggering `ValueError: option names {'--slow'} already added` and false test-failure reports. PR #24 — merge commit `2778c2d`.

---

## E2E Validation

### Constraint-Binding Pilot (N=1, 4 Tasks)

Pilot ran 2026-04-21T15:09Z to 16:26Z. Tool: `claude-code`. All four tasks under the 40-premium-request cost-estimate gate.

| Task | Wall Clock | Premium Req | Failing Validator | Hypothesis |
|------|-----------|-------------|-------------------|------------|
| rename-then-update-callers-001 | 2443s | 5/5 est | no references to old name remain in source files | VALIDATOR TOO STRICT — grep scanned `node_modules/` and self-asserting test file |
| contract-change-then-client-001 | 442s | (bailed early) | implementation throws on missing userAgent | PLAN-GENERATOR ORDERING — impl step verified before test-update step ran |
| lift-then-reuse-001 | 555s | (bailed early) | resolveScheduler helper is declared in index.js | VALIDATOR TOO STRICT — space before paren in function declaration |
| schema-then-query-001 | 1157s | 3/8 est | schema declares publishedAt on Post | FIXTURE DEFECT — subpath prefix preserved on extraction, file at wrong path |

**Aggregate:** 0/4 pass, 76.6 min wall clock, 8 total premium requests. No halt triggers fired (no invocation exceeded 2× estimate, no validator disagreed with baseline-rejection smoke, no auth failures).

Signal: 3 of 4 failures are in harness-layer (validator over-strictness, fixture path defect), not the orchestrator. The contract-change-then-client failure was the real orchestrator observation that directly motivated the PR #31 contract-change goal type. Harness fixes landed in PR #32 before Phase 3b expansion.

### SWE-bench Smoke Sequence

Nine smoke runs (smoke1 through smoke9) exercised the harness through three fix cycles: planner subsystem (Theme 2 fixes surfaced by the sympy-12481 instance), diff capture and commit staging (Theme 3 fixes), and branch reset (PR #38). Three concrete outcomes:

- **Problem A** (branch reset): identified in smoke runs post-phase4a, `checkout_repo` left `master` at HEAD instead of `base_commit`. Fixed: `git checkout -B master base_commit` in PR #38. Regression test in place.
- **Problem B** (diff scaffolding leak): identified in smoke8 post-mortem, `git diff base_commit` leaked `.copilot-instructions.md` and run scaffolding into the patch. Fixed in PR #38. Validated clean by smoke9: patch contained exactly one file (`sympy/combinatorics/tests/test_permutations.py`), `git apply` succeeded.
- **Problem C** (container path not executing): smoke9 ran on host-venv fallback (Python 3.12 vs sympy 2016's `collections.Mapping` import), producing 0/1 resolved with a `collections.Mapping` ImportError. Root cause: `PERINSTANCE_IMAGE_REGISTRY` constant is used but never defined in `run_swebench.py` (would NameError if container path reached). Deferred to v6.1.

Target-mode gate scoping (PR #35) reduced smoke-run wall clock approximately 3× by eliminating replan cycles from inapplicable self-improvement gates firing against the sympy target repo.

### Session Report Reference

The April 18 session report covers prior E2E validation: `demo-fast` at N=10 (100% step completion, 2 premium requests/run, 84.3s mean wall clock) and `api-quick` at N=5 (100% step completion, 3 premium requests/run, 359s mean wall clock). Both confirm clean orchestrator exit with real—not hardcoded—premium request counts. Full results tables in the report.

---

## Prerequisite Features (from v5.0.0, verified)

All three v5.0.0 features remain functional and were exercised during v6.0 validation runs:

- **SARIF output from quality gates** — still produces valid SARIF 2.1.0 JSON; gate-scoping work in PR #35 preserved SARIF compatibility.
- **Per-project gate configuration** — `.swarm/gates.yaml` resolution unchanged; PR #35's `targetMode` flag is orthogonal to per-project config.
- **Spec-aware planning** — gate-aware prompt clauses continue to fire correctly; `testCoverage` auto-injection guard added in PR #31 for contract-change goal type.

---

## Dependencies

Five pip range bumps (pytest ≥9.0.3, httpx ≥0.28.1, fastapi ≥0.136.0, uvicorn ≥0.44.0, pydantic ≥2.13.2) deferred — dependabot branches were stale at PR close; dependabot will reopen against v6.0 main. PRs #6, #8, #10, #12, #17 closed 2026-04-22.

---

## Test Summary

111 new tests above v5.0.0's baseline of 1386. New test files: `test/constraint-binding/pipeline-smoke.test.ts`, `test/constraint-binding/prompt-invariant.test.ts`, `test/constraint-binding/task-schema.test.ts`, `benchmarks/swe-bench/tests/test_smoke_postmortem_regressions.py`. Full suite: **1497 passing, 6 pending, 0 failing**. All quality gates green on swarm-orchestrator.

---

## Known Gaps / Pending for v6.1

- **SWE-bench container-path execution.** Per-instance Docker image resolution is wired structurally but blocked on `PERINSTANCE_IMAGE_REGISTRY` constant definition and registry authentication. smoke9 validated diff capture correctness; sweep pending container-path resolution.
- **Constraint-binding full expansion.** 4 pilot tasks landed; 16 additional tasks + master-default fixture pending v6.1 after pilot-hypothesis-driven validator/fetch hygiene from PR #32 has had a chance to validate at scale.
- **Plan-generator UI-bug routing.** Bug-fix goal type routes to BackendMaster by default. UI-bug evidence case not yet observed; routing refinement deferred until evidence surfaces.
- **Reserved-paths completeness test.** Issue #34 tracks the gap between one-time completeness audit (done for PRs #33/#36) and ongoing invariant enforcement. Non-blocking.
- **Test-coverage gate dynamic require() handling.** Issue #28 tracks the gap noted during CI troubleshooting work.
