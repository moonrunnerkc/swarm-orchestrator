# v8 surface inventory

Source-of-truth scan of every documented v8 capability and CLI surface, with
cross-references to source files. Generated 2026-05-08 against
`v8-dev` head `3c4c8d5`.

## README.md

The shipped README documents v6/v7 only. v8 is not surfaced. The Phase 6
completion report (docs/v8-phase-6-completion.md:130) explicitly defers
the v8 README block to "the v8-default cutover commit per Phase 5
precedent". Phase 7 completion report likewise (docs/v8-phase-7-completion.md:99).

This is a deliberate deferral: the v8-dev branch ships v8 docs separately
under docs/v8-* until cutover.

| Surface | README ref | Code surface |
| --- | --- | --- |
| `swarm run --goal` | README.md:65, README.md:169 | src/cli.ts:225 → handleRunCommand (v6 path) |
| Five-layer falsification battery | README.md:27 | src/verification/* |
| Quality-gate engine | README.md:30 | src/quality-gates/* |
| `--tool <name>` selector | README.md:109 | src/adapters/adapter-factory.ts |
| `swarm recipes` | README.md:179 | src/recipe-loader.ts (v6) |

## docs/v8-overhaul-guide.md

§1–§4: design rationale (no testable surface).

§5 architecture layers, claims about behaviour:
- §5.1 contract obligations include `function-must-have-signature`,
  `property-must-hold`, `import-graph-must-satisfy` (v8-overhaul-guide.md:80).
- §5.2 personas listed: architect, refactorer, test-writer,
  security-reviewer, integration-verifier, documentation-writer,
  dependency-auditor (v8-overhaul-guide.md:90).
- §5.3 tournaments: 2–4 candidates, diversity budget, escalation
  (v8-overhaul-guide.md:104–106).
- §5.4 ledger is hash-chained, doubles as memoization cache, rollback
  primitive (v8-overhaul-guide.md:114–125).
- §5.5 verification is multi-point: pre-generation, mid-generation,
  post-generation pre-commit, post-merge (v8-overhaul-guide.md:131–137).
- §5.6 WASM deterministic floor for formatters, import sorters, simple
  AST renames, etc. (v8-overhaul-guide.md:142–151).
- §4.1 CLI execution preserved as **opt-in fallback mode**
  (v8-overhaul-guide.md:56).

## docs/v8-implementation-guide.md

§1 prerequisites: Node 20+, TS 5.x, Anthropic API access with prompt
caching (v8-implementation-guide.md:13–17).

§4 Phase 1 deliverables:
- `swarm v8 compile <goal>` CLI (line 82)
- contract validator with consistency checks (line 81)
- user-approval step with editor (line 82, 96)
- 3 obligation types: file-must-exist, build-must-pass, test-must-pass
  (line 87–89)
- contract is hash-stable (line 97)

§5 Phase 2 deliverables:
- `src/session/anthropic-session.ts` with proper cache breakpoint
  placement (line 110)
- `src/persona/persona-registry.ts` with 3 personas: architect,
  implementer, verifier (line 111)
- `swarm v8 run <contract-path>` CLI (line 113)
- cost benchmark hitting 30% reduction floor vs v6 (line 119, 123)
- pass rate within 5% of v6 (line 124)
- cache hit rate exposed in run output (line 125)

§6 Phase 3 deliverables:
- `src/population/tournament.ts` (line 137)
- losing candidates logged with diff hash but never applied (line 140)
- diversity injection when all candidates fail (line 144)
- hard cap of 3 rounds per obligation (line 145)

§7 Phase 4 deliverables:
- hash-chained JSONL ledger (line 162)
- `src/ledger/memoization.ts` (line 163)
- IRONROOT integration (line 164)
- `swarm v8 resume <run-id>` (line 165)
- ledger tamper detection: manually edited entry detected, run aborts
  (line 171)

§8 Phase 5 deliverables:
- `src/wasm/wasm-runtime.ts` (line 183)
- 3 first-party WASM modules: formatter wrapper, import sorter,
  scaffolding template engine (line 202)
- `deterministic-strategy: <name>` tag in contract schema (line 190)
- misclassification reroutes to synthesis (line 195)
- goal with deterministic-eligible obligation completes with **zero LLM
  tokens** (line 200)

§9 Phase 6 deliverables:
- `src/verification/streaming-verifier.ts` (line 214)
- mid-stream abort on contract violation (line 215)
- pre-generation skip pass (line 216)
- post-merge integration check (line 217)
- doomed-obligation aborts mid-generation (line 221)
- post-merge catches cross-obligation regressions (line 223)

§10 Phase 7 milestone exit (>= 7 personas, >= 8 obligation types) (line 251).

§12 migration:
- "After Phase 4, v8 becomes opt-out: default switches to v8, `--v6` flag
  preserves old behavior" (v8-implementation-guide.md:275).
- Recipes ship as contract templates: add-tests, add-auth, add-ci,
  migrate-to-ts, add-api-docs, security-audit, refactor-modularize
  (line 288).
- GitHub Action accepts goal, tool, recipe, plan, pr plus
  contract-only and cost-cap (line 290).

## src/cli/v8/ — actual wired CLI surface

`src/cli/v8/index.ts:19–35` dispatches three subcommands:
- `compile <goal>` → handleCompile
- `run <contract>` → handleRun
- `resume <run-id>` → handleResume

`compile-handler.ts:131` parses flags (no `--recipe` flag wired).
Flags: `--out`, `--repo-root`, `--yes`/`-y`, `--no-editor`,
`--extractor`, `--model`, `--temperature`, `--api-key`, `--help`/`-h`.

`run-handler.ts:273` parses flags. Flags: `--repo-root`, `--session`,
`--model`, `--api-key`, `--ledger`, `--max-obligations`,
`--command-timeout-ms`, `--run-id`, `--result`, `--mode`,
`--candidates`, `--no-deterministic`, `--no-streaming`,
`--no-pre-generation`, `--no-post-merge`, `--forbid-import`.
**Default mode: `single`** (line 286). Default streaming/pre-gen/post-merge:
true.

`resume-handler.ts:343` parses flags. Same flag set as run plus
`--ledger`, `--contract`. Default mode: `single` (line 355).

Top-level dispatch (`src/cli.ts:246–248`): `swarm v8 <subcommand>` is
the **only** v8 entry point. `swarm run` continues to use the v6 path
(handleRunCommand at src/cli.ts:225–227); the impl guide §12 promised
default-to-v8 behaviour is **not** implemented in the dispatcher.

## .github/workflows/

`v8-ci.yml`: lint, typecheck, test jobs for the v8-dev branch.

`swarm-example.yml`: example workflow_dispatch with inputs `goal`,
`tool`, `model` only.

`action.yml` (composite action root): inputs `goal`, `plan`, `recipe`,
`tool`, `model`, `max-retries`, `pr`, `sarif`. **Missing: contract-only,
cost-cap.**

## Recipes

7 recipes shipped under templates/recipes/:
- add-api-docs.json
- add-auth.json
- add-ci.json
- add-tests.json
- migrate-to-ts.json
- refactor-modularize.json
- security-audit.json

Loaded by src/recipe-loader.ts (v6 ExecutionPlan shape, NOT
contract-template shape). The impl-guide §12 claim that they "ship as
contract templates in v8" is **not** implemented; v8 compile has no
`--recipe` flag and no contract-template loader.
