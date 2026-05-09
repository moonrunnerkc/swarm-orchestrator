# Swarm Orchestrator

A CLI and library that wraps third-party coding-agent CLIs (Copilot, Claude Code, Codex, Claude Code Teams) as subprocesses, runs worker and reviewer steps on isolated git branches with analyzer-gated concurrency, parses `/share` transcripts for evidence, runs quality gates, and merges only what verifies.

**The architectural rule:** nothing reaches `main` without passing both the verification engine and the quality-gate pipeline. Don't introduce a merge path that bypasses either.

## Stack

- Node.js ≥ 20 (engines-enforced). CI runs 20 and 22.
- Python ≥ 3.11 for the `app/` sub-project only.
- TypeScript strict mode, `target: ES2022`, `module: commonjs`, `exactOptionalPropertyTypes: true`.
- CommonJS. `require()` is the native import form. `@typescript-eslint/no-require-imports` is intentionally disabled.
- React + Ink for the TUI (`src/dashboard.tsx`).

## Commands

| Command | What it does |
|---|---|
| `npm run build` | `tsc -p tsconfig.build.json`, then `chmod 0755 dist/src/cli.js`. Runs `clean` first via `prebuild`. |
| `npm test` | Builds, then `mocha --recursive 'dist/test/**/*.test.js'`. |
| `npm run test:ci` | Mocha without a build (CI pre-builds). |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.build.json`. |
| `npm run lint`, `npm run lint:fix` | ESLint on `src/**/*.{ts,tsx}` and `test/**/*.ts`. |
| `npm run format` | Prettier write. `format:check` exists but the codebase has historical drift; do not rely on it as a gate. |
| `npm start` | `node dist/src/cli.js`. |

Before any PR: `npm test`, then `node dist/src/cli.js gates .`, then a descriptive commit. The self-gate runs in CI, so a regression in the orchestrator's own code fails its own gates.

## Where things live

- `src/cli.ts`: CLI dispatcher. Sub-handlers in `src/cli/`.
- `src/swarm-orchestrator.ts`: scheduler, dependency resolution, octopus merge, governance, cost tracking.
- `src/plan-generator.ts`: plan creation and dependency validation.
- `src/session-executor.ts`: Copilot CLI subprocess and transcript capture.
- `src/share-parser.ts`: transcript parsing (files, commands, tests, commits, claims).
- `src/verifier-engine.ts` plus `src/verifier/`: evidence checking.
- `src/repair-agent.ts`: failure-classified retry, up to 3 attempts.
- `src/adapters/`: one file per agent backend, with shared `process-supervisor.ts` and `adapter-factory.ts`.
- `src/quality-gates/`: gate engine. Nine built-in gates registered in `registry.ts` (`scaffoldDefaults`, `duplicateBlocks`, `hardcodedConfig`, `readmeClaims`, `testIsolation`, `runtimeChecks`, `accessibility`, `testCoverage`, `testFileProtection`). Projects register custom gates via `.swarm/gates/index.js`. The README says "eight" in one place; the registry is ground truth.
- `src/logger.ts`: the structured logger. Use it.
- `config/`: agent profiles and gate config (YAML).
- `test/`: Mocha tests, fixtures in `test/fixtures/`.
- `.github/workflows/codex-canary.yml`: weekly canary against the unpinned `@openai/codex` CLI; opens an `adapter-drift` issue on schedule failure. Implements the version-drift mitigation from `docs/adapter-integration.md`.

## Conventions

**Structured logger only.** No `console.log/error/warn` in `src/`. Use `getLogger(scope?)`. Two legacy call sites exist (`src/cli/usage.ts`, and a string literal in `src/tier-maps.ts`); don't add more. When the Ink dashboard owns stdout, logger output routes to stderr. Respect that.

**No `any` in `src/`.** `no-explicit-any: 'error'`. Tests and `src/dashboard.tsx` are the only exceptions.

**Preserve caught errors.** `preserve-caught-error: 'error'`. Attach `cause` when rethrowing.

**No empty catch blocks.** `allowEmptyCatch: false`.

**Unused-var opt-out is `^_` only.** Don't prefix random names with underscore to silence warnings.

**Prettier:** semi, single quotes, trailing-comma all, 100 cols, 2 spaces, LF, `arrowParens: 'always'`.

**EditorConfig:** 2-space indent, LF, UTF-8, trim trailing whitespace, final newline. Markdown exempt from trim. Makefile uses tabs.

**Commits:** conventional-commit-ish with scoped stage tags. Recent history uses `chore(stage-N):`, `fix(stage-N):`, `docs(stage-N):`, `refactor(stage-Na):`, `feat(followup):`, `fix(tui):`, `fix(ux):`.

## Config precedence

- **Agent config:** project `config/default-agents.yaml`, then install-level, then `.github/agents/*.agent.md`.
- **Quality gates:** built-in defaults, then `.swarm/gates.yaml`, then `--quality-gates-config`.
- **Env:** project `.env`, then orchestrator install `.env`, then `~/.env`. Loading logic in `src/cli.ts:56-79`.

## Run artifacts

Every execution writes to `runs/<execution-id>/`: `session-state.json`, `metrics.json`, `cost-attribution.json`, `knowledge-base.json`, `wave-N-analysis.json`, `report.md`, `report.json`, optional `owasp-compliance.{md,json}`, `steps/step-N/share.md`, `verification/step-N-verification.md`. Everything under `runs/` is gitignored. Artifacts auto-redact known secrets at end of run.

## Hard don't-do rules

- Don't commit anything listed in `.gitignore`. Run artifacts (`runs/`, `reports/`, `plans/`, `test-runs/`, `knowledge-base.json`, `.context/`, `.locks/`, `.quickfix/`) are gitignored on purpose. Generated completed-run examples are local artifacts; publish them separately only when a release or review needs that evidence.
- Don't commit secrets. `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `service-account*.json` are blocked. Secrets come from environment only. Never from config files, CLI args, or GitHub Actions `with:` inputs. Use the `env:` block.
- Don't commit internal planning docs: `.github/copilot-instructions.md`, `.github/cso-upgrade-plan.md`, `.github/cso-upgrade.md`, `.github/security-recommendations.md`, `.copilot-instructions.md`, `docs/orchestrator-copilot-benchmarks.md`, `IMPROVEMENTS.md`, `plans/`.
- Don't use long-lived Google service-account JSON keys. Prefer Workload Identity Federation. If unavoidable, TTL must be ≤ 1 hour.
- Don't open public issues for vulnerabilities. Use GitHub Security Advisories.
- Don't add a merge path that bypasses verification or the quality-gate pipeline.

## Sub-projects

`app/`, `calculator/`, `calculations-api/`, `logtail/`, `notes-api/`, `tictactoe/`, `web/` are generated demo scaffolds, gitignored as top-level paths, regenerated by the orchestrator. Don't edit them manually expecting the changes to stick.

Sub-project tests: `calculations-api/` and `notes-api/` need `npm install` first. `calculator/`, `logtail/`, `tictactoe/` use only Node built-ins. Python: `pytest app/tests/ -v`.

## When generating code

- Match existing module boundaries. `swarm-orchestrator.ts` owns scheduling and merge. `plan-generator.ts` owns planning. Verifier logic splits across `verifier-engine.ts` and `src/verifier/`. Adapters each live under `src/adapters/` using the shared supervisor.
- New quality gate: register in `src/quality-gates/registry.ts`, implement under `src/quality-gates/gates/`.
- New agent backend: add an adapter under `src/adapters/` that uses `process-supervisor.ts`.
- Tests go under `test/`, mirror the module path, end in `.test.ts`, run under Mocha.
