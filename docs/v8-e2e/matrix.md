# v8 verification matrix

One row per testable surface. Status reflects E2E pass/fail at the
HEAD of v8-dev (`3c4c8d5`) at run time. Failures get a fix-commit hash
once landed.

Status legend: `untested` | `pass` | `fail` | `fixed` | `deferred`.

## CLI surface

| # | Source-of-truth | Command / call | Expected | Status | Evidence |
|---|---|---|---|---|---|
| C1 | impl guide §4 line 82 | `swarm v8 compile <goal>` | writes contract dir, returns 0 | pass | captures-postfix/01-F1-F2-real.txt |
| C2 | impl guide §5 line 113 | `swarm v8 run <contract>` | runs population, exit 0 on all-satisfied | pass | captures-postfix/02-F3-real.txt |
| C3 | impl guide §7 line 165 | `swarm v8 resume <run-id>` | resumes from ledger | pass | captures-postfix/06-F10-F11.txt |
| C4 | run-handler.ts:411 | `swarm v8 run --no-deterministic` | disables WASM floor | pass | exercised inline in F4-F11 captures |
| C5 | run-handler.ts:412 | `swarm v8 run --no-streaming` | disables streaming verifier | pass | exercised inline in F4-F11 captures |
| C6 | run-handler.ts:413 | `swarm v8 run --no-pre-generation` | disables pre-gen pass | pass | exercised inline in F4-F11 captures |
| C7 | run-handler.ts:414 | `swarm v8 run --no-post-merge` | disables post-merge check | pass | exercised inline in F4-F11 captures |
| C8 | run-handler.ts:415 | `swarm v8 run --forbid-import a,b` | streaming aborts on those imports | pass | captures-postfix/04-F7-F8-F9.txt (integration test + Phase 6 bench) |
| C9 | run-handler.ts:409 | `swarm v8 run --mode tournament` | candidates race, top scores commits | pass | captures-postfix/03-F4-F5-F6.txt |
| C10 | compile-handler.ts:209 | `swarm v8 compile --extractor stub` | compiles without ANTHROPIC_API_KEY | pass | captures/F2-compile.txt |

## Doc-vs-code mismatches found in Phase B

These are doc claims with no matching code surface. Each must be
either fixed (defect) or surfaced as deferred with justification.

| # | Source-of-truth claim | Code | Decision |
|---|---|---|---|
| D1 | impl guide §12 line 275: "After Phase 4, v8 becomes opt-out: default switches to v8, `--v6` flag preserves old behavior" | src/cli.ts:225 dispatches `swarm run` to v6 (handleRunCommand). No `--v6` flag exists. | **fixed** in 8524d88 — `swarm run` defaults to v8 via src/cli/v8/run-wrapper.ts; `--v6` opt-out routes to handleRunCommand. |
| D2 | impl guide §12 line 288: "All current recipes (add-tests, add-auth, add-ci, migrate-to-ts, add-api-docs, security-audit, refactor-modularize) ship as contract templates in v8" | compile-handler.ts has no `--recipe` flag. No contract-template loader exists in src/contract/. | **fixed** in 8524d88 — `--recipe <name>` composes a goal from the recipe (description + step tasks) and runs the standard extractor pipeline. All 7 recipes confirmed yielding v1 contracts. |
| D3 | impl guide §12 line 290: "swarm action accepts ... new optional inputs (`contract-only`, `cost-cap`)" | action.yml inputs: goal, plan, recipe, tool, model, max-retries, pr, sarif. No contract-only, no cost-cap. | **fixed** in 8524d88 — action.yml + entrypoint.sh wired both. v8 run/resume gain `--cost-cap <usd>` with end-of-run gate (estimateUsageCostUsd vs cap, exit 6 if exceeded). |
| D4 | overhaul guide §4.1 line 56: "CLI execution is preserved as an opt-in fallback mode" | src/adapters/* still ship; default execution is `swarm run` which goes to v6 path. The "opt-in fallback" framing assumes v8 is the default, which (D1) it isn't. | **fixed-by-D1** — once D1 landed, the v6 path is the explicit `--v6` fallback, satisfying §4.1. |
| D5 | manager.ts:75 doc: "the v8 CLI defaults to `tournament` post-Phase 3" | run-handler.ts:286 + resume-handler.ts:355 both default `mode: 'single'`. | **fixed** in 8524d88 — comment now states "the v8 CLI defaults to `single` for cost-efficiency; pass `--mode tournament` to opt into the parallel-candidate path." |

## Required Phase C flows (per spec)

One row per spec-numbered flow. Evidence path is where the captured
output will land.

| # | Flow | Expected | Evidence |
|---|---|---|---|
| F1 | install + surface check (`npm install`, `npx swarm --version`, `npx swarm v8 --help`) | v8 subcommands listed; default execution path is v8 | captures/F1-install-surface.txt |
| F2 | contract compile w/ ≥4 obligation types incl. one Phase 7 type | schema-valid, hash-stable across two runs | captures/F2-compile.txt |
| F3 | `swarm v8 run` against fixture | population dispatches, ledger written, hash chain valid | captures/F3-run.txt |
| F4 | all 8 personas reachable | per-persona invocation evidence in ledger | captures/F4-personas.txt |
| F5 | all 8 obligation types reachable | per-type dispatch + verification result | captures/F5-types.txt |
| F6 | tournament parallelism (synthesis obligation, N≥2 candidates) | parallel generation, top scorer commits, losers logged | captures/F6-tournament.txt |
| F7 | WASM deterministic floor (formatter or import-sort obligation) | zero LLM tokens, ledger entry tagged with wasm strategy | captures/F7-wasm.txt |
| F8 | streaming verification (forbidden import) | mid-generation abort, savings in token accounting | captures/F8-streaming.txt |
| F9 | ledger tamper detection (hand-edit entry) | next run aborts with tamper detected | captures/F9-tamper.txt |
| F10 | resume (SIGTERM mid-run, restart) | prior obligations not redone, run completes | captures/F10-resume.txt |
| F11 | memoization (two identical obligations or two runs same goal) | second skips synthesis | captures/F11-memo.txt |
| F12 | cost benchmark (Phase 2 + Phase 7 scripts) | history.jsonl row appended; tokens cross-checked vs SDK response.usage | captures/F12-bench.txt |
| F13 | recipes (7) — `swarm v8 compile --recipe <name>` | each yields valid contract | captures/F13-recipes.txt |
| F14 | GitHub Action dry-run with `act` | accepts documented inputs, contract-only and cost-cap behave | captures/F14-action.txt |
| F15 | CLI fallback mode | deprecated CLI-subprocess path still runs when explicitly invoked | captures/F15-cli-fallback.txt |

## Phase 7 deferrals

Two of the original Phase 7 deferrals (X1, X2) were resolved
post-Phase-7 — see the e2e REPORT for the resolution. X3 remains
deferred per spec.

| # | Deferral | Status |
|---|---|---|
| X1 | tree-sitter AST signature checks (substring match acceptable) | RESOLVED. `function-must-have-signature` is AST-backed via the TypeScript compiler API and Python `ast` module. See `src/verification/ast-signature.ts`. |
| X2 | Anthropic extractor prompt expansion for Phase 7 obligation types | RESOLVED. The extractor's tool input_schema and system prompt cover all eight v1 obligation types. See `src/contract/extractor/anthropic-extractor.ts`. |
| X3 | tournament-mode streaming + auto-rollback | DEFERRED. Tournament mode does not stream (single-mode-only). `swarm v8 run --mode tournament` with `--forbid-import` set must either skip the assertion or no-op cleanly, not produce wrong output. |
| X4 | regex-based import-graph parser; AST resolver post-v8.0 | RESOLVED. `import-graph-must-satisfy` is AST-backed via the TypeScript compiler API and Python `ast` module. See `src/verification/ast-imports.ts`. |
