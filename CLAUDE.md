# Swarm Orchestrator

A CLI and library that compiles a natural-language goal into a typed
contract, runs the contract through a falsification-gated v8 pipeline
(extractor → session → predicate-runner → falsifier → verifier), and
admits only patches that satisfy every obligation. v6 (the verified-
branch pipeline that wrapped third-party coding-agent CLIs) was
removed in v9.0.0; pin to `8.0.x` if you still depend on it.

**The architectural rule:** nothing reaches `main` without passing
verification end-to-end. Don't introduce a merge path that bypasses
`verifyObligation` / `postMergeVerify`.

## Stack

- Node.js ≥ 20 (engines-enforced). CI runs 20 and 22.
- TypeScript strict mode, `target: ES2022`, `module: commonjs`, `exactOptionalPropertyTypes: true`.
- CommonJS. `require()` is the native import form. `@typescript-eslint/no-require-imports` is intentionally disabled.

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

Before any PR: `npm test`, `npm run typecheck`, then a descriptive commit. The LOC budget gate (`scripts/loc-budget-gate.sh`) runs in CI against `evidence/loc-budget.txt`.

## Where things live

- `src/cli.ts`: top-level CLI dispatcher (`run`, `compile`, `resume`, `stats`, `doctor`, `v8`).
- `src/cli/v8/`: per-subcommand handlers for the v8 pipeline.
- `src/contract/`: contract compilation, validation, serialization, and approval.
- `src/contract/extractor/`: pluggable extractor providers (deterministic, local, anthropic).
- `src/session/`: pluggable session providers that produce patches against the contract.
- `src/falsification/adapters/`: CLI-based falsifiers (Codex, Copilot, Claude Code) that attempt to break verified patches.
- `src/falsification/scheduler.ts`, `src/falsification/dispatcher.ts`: falsifier orchestration.
- `src/verification/`: per-obligation verifier (`run-verifier.ts`), streaming verifier (`streaming-verifier.ts`), pre-generation check (`pre-generation.ts`), post-merge integration verifier (`post-merge.ts`), AST signature/imports checks (`ast-signature.ts`, `ast-imports.ts`), live cost tracker (`live-cost-tracker.ts`), predicate runner (`predicate-runner.ts`).
- `src/population/`: tournament-based population manager.
- `src/persona/`: persona registry and YAML loader.
- `src/inference/`: local-LLM inference (openai-compatible, ollama, llama-cpp, vllm backends).
- `src/ledger/`: append-only run ledger.
- `src/wasm/`: WASM runtime helpers.
- `src/logger.ts`: structured logger. Use it.
- `config/personas/`: persona YAML files loaded by the persona registry.
- `test/`: Mocha tests, fixtures in `test/fixtures/`.

## Conventions

**Structured logger only.** No `console.log/error/warn` in `src/`. Use `getLogger(scope?)`. The `src/cli.ts` `showUsage()` writes to `process.stdout` directly (not via the logger) because help output should not carry diagnostic prefixes. Help output aside, every other `src/` callsite goes through the logger.

**No `any` in `src/`.** `no-explicit-any: 'error'`. Tests are the only exception.

**Preserve caught errors.** `preserve-caught-error: 'error'`. Attach `cause` when rethrowing.

**No empty catch blocks.** `allowEmptyCatch: false`.

**Unused-var opt-out is `^_` only.** Don't prefix random names with underscore to silence warnings.

**Prettier:** semi, single quotes, trailing-comma all, 100 cols, 2 spaces, LF, `arrowParens: 'always'`.

**EditorConfig:** 2-space indent, LF, UTF-8, trim trailing whitespace, final newline. Markdown exempt from trim. Makefile uses tabs.

**Commits:** conventional-commit-ish with scoped stage tags. Recent history uses `chore(phase-N):`, `feat(phase-N)!:`, `fix(phase-N):`, `refactor(falsification):`.

## Config precedence

- **Personas:** project `config/personas/*.yaml`, then install-level fallback.
- **Provider:** flag, then env var (`EXTRACTOR_PROVIDER`, `SESSION_PROVIDER`), then `.swarm/config.yaml`, then deterministic default.
- **Env:** project `.env`, then orchestrator install `.env`, then `~/.env`. Loading logic in `src/env-loader.ts`.

## Run artifacts

Every execution writes to `.swarm/ledger/<run-id>.jsonl` (append-only ledger) and `.swarm/contracts/<id>/` (contract.jsonl + manifest.json). Both are gitignored at the consumer-repo level.

## Hard don't-do rules

- Don't commit anything listed in `.gitignore`. Run artifacts (`runs/`, `reports/`, `plans/`, `.context/`, `.locks/`, `.quickfix/`) are gitignored on purpose.
- Don't commit secrets. `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `service-account*.json` are blocked. Secrets come from environment only. Never from config files, CLI args, or GitHub Actions `with:` inputs. Use the `env:` block.
- Don't commit internal planning docs: `.github/copilot-instructions.md`, `.github/cso-upgrade-plan.md`, `.github/cso-upgrade.md`, `.github/security-recommendations.md`, `.copilot-instructions.md`, `IMPROVEMENTS.md`, `plans/`, `swarm-orchestrator-optimization-plan.md`, `coding-optimization-report.md`.
- Don't use long-lived Google service-account JSON keys. Prefer Workload Identity Federation. If unavoidable, TTL must be ≤ 1 hour.
- Don't open public issues for vulnerabilities. Use GitHub Security Advisories.
- Don't add a merge path that bypasses verification.

## When generating code

- Match existing module boundaries. `src/contract/` owns compilation. `src/session/` owns patch production. `src/falsification/` owns adversarial probing. `src/verification/` owns obligation checking. `src/population/manager.ts` orchestrates tournaments.
- New falsifier adapter: add a profile under `src/falsification/adapters/profiles/` and register it in `src/falsification/adapters/index.ts`.
- New extractor or session provider: implement the interface in `src/contract/extractor/types.ts` or `src/session/types.ts` and add the factory case.
- Tests go under `test/`, mirror the module path, end in `.test.ts`, run under Mocha.
