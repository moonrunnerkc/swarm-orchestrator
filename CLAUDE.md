# Swarm Orchestrator

A CLI and library with two surfaces. The **audit surface** (v10, the
headline) is `swarm audit <pr | --diff-file | --diff-stdin>`: it walks a
PR diff through a pluggable cheat-detector registry (test relaxation,
mock-of-hallucination, assertion strip, no-op fix, and six more),
fingerprints the AI agent that wrote the PR, optionally emits a
CycloneDX-ML or SPDX 3.0 AI-Profile AIBOM, and posts a deterministic
finding back to the PR. The **orchestrator surface** (v8) compiles a
natural-language goal into a typed contract and runs it through a
falsification-gated pipeline (extractor → session → predicate-runner →
falsifier → verifier), admitting only patches that satisfy every
obligation. v6 (the verified-branch pipeline that wrapped third-party
coding-agent CLIs) was removed in v9.0.0; pin to `8.0.x` if you still
depend on it.

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

- `src/cli.ts`: top-level CLI dispatcher (`audit`, `run`, `compile`, `resume`, `stats`, `doctor`, `init`, `v8`). `audit` is the v10 user-facing verb; `run` and friends are the v8 orchestrator surface.
- `src/cli/v8/`: per-subcommand handlers for both surfaces.
  - `src/cli/v8/audit-handler.ts`: `swarm audit` dispatcher; resolves `--pr` / `--diff-file` / `--diff-stdin`, walks the cheat-detector registry, renders the comment, optionally emits the AIBOM.
  - `src/cli/v8/pr-fetch.ts`: PR-ref → unified-diff resolver used by `swarm audit --pr`.
  - `src/cli/v8/init-handler.ts`: `swarm init` scaffolding.
  - `src/cli/v8/doctor-handler.ts`: `swarm doctor` diagnostics (with `--fix`).
  - `src/cli/v8/run-handler.ts`: `swarm run` with auto-discover and preset integration.
- `src/audit/`: the v10 audit surface.
  - `src/audit/cheat-detector/`: ten detectors (`test-relaxation`, `mock-of-hallucination`, `assertion-strip`, `no-op-fix`, `comment-only-fix`, `coverage-erosion`, `dead-branch-insertion`, `error-swallow`, `exception-rethrow-lost-context`, `fake-refactor`) behind a single registry in `index.ts`. Adding a category is one import + one array entry. Detectors are high-recall candidate generators; two verification stages run after them in `index.ts`: `verify-findings.ts` (deterministic refuters that drop or demote a candidate the diff shows is legitimate, plus `assignConfidence`) and `confirm-findings.ts` (the LLM-judge confirmation gate, opt-in, that must confirm a finding before it blocks). Shared utilities: `diff-walker.ts`, `subject-paths.ts`, `detector-types.ts`, `internal-roots.ts`, `audit-config.ts` (project-level `.swarm/audit-config.yaml` loader). The block-eligibility gate is a precision policy computed into `benchmarks/real-corpus/promotions.json` by `scripts/promotions/compute-promotions.ts` and held fresh in CI by `scripts/promotions/check-policy.ts` (`npm run promotions:check`).
  - `src/audit/pr-source/`: AI-agent fingerprinter (Claude Code, Cursor, Devin, Aider, Codex CLI, Copilot Workspace, Replit Agent, OpenHands).
  - `src/audit/report-comment/`: deterministic PR-comment renderer.
  - `src/audit/aibom/`: hand-rolled CycloneDX 1.6 ML-BOM and SPDX 3.0 AI-Profile emitters (`cyclonedx-ml.ts`, `spdx-ai-profile.ts`, `ledger-reader.ts`); no new runtime deps. Triggered by `--emit-aibom`.
- `src/errors.ts`: `SwarmError` base class with `code` and `remediation` fields; subclasses `ContractError`, `PopulationError`, `VerificationError`, `InferenceError`, `ConfigError`.
- `src/contract/`: contract compilation, validation, serialization, and approval.
  - `src/contract/auto-discover.ts`: automatic contract file discovery (contract.yaml, swarm-contract.yaml, .swarm/contract.yaml).
- `src/contract/extractor/`: pluggable extractor providers (deterministic, local, anthropic).
- `src/session/`: pluggable session providers that produce patches against the contract.
  - `src/session/auto-discover.ts`: automatic patches source discovery (patches.jsonl, swarm-patches.jsonl, patches/ dir).
- `src/shared-types/`: shared obligation type definitions (breaks contract↔verification circular dep).
- `src/shared-predicates/`: shared predicate runner logic (breaks contract↔wasm circular dep).
- `src/shared-wasm/`: shared WASM strategy constants (breaks contract↔wasm circular dep).
- `src/falsification/adapters/`: CLI-based falsifiers (Codex, Copilot, Claude Code) that attempt to break verified patches.
- `src/falsification/scheduler.ts`, `src/falsification/dispatcher.ts`: falsifier orchestration.
- `src/verification/`: per-obligation verifier (`run-verifier.ts`), streaming verifier (`streaming-verifier.ts`), pre-generation check (`pre-generation.ts`), post-merge integration verifier (`post-merge.ts`), AST signature/imports checks (`ast-signature.ts`, `ast-imports.ts`), live cost tracker (`live-cost-tracker.ts`), predicate runner (`predicate-runner.ts`).
- `src/population/`: tournament-based population manager.
  - `src/population/manager.ts`: orchestration entry point (~490 LOC; decomposed from original 955 LOC).
  - `src/population/pipeline-config.ts`: `PipelineConfig` type and `resolvePipelineConfig()` with presets (full/fast/minimal).
  - `src/population/falsifier-dispatch.ts`: falsifier dispatch per obligation.
  - `src/population/deterministic-dispatch.ts`: deterministic floor dispatch.
  - `src/population/post-merge-handler.ts`: post-merge verification handler.
  - `src/population/single-mode-executor.ts`: single-mode execution path.
- `src/persona/`: persona registry and YAML loader.
- `src/inference/`: local-LLM inference (openai-compatible, ollama, llama-cpp, vllm backends).
- `src/ledger/`: append-only run ledger.
- `src/wasm/`: WASM runtime helpers.
- `src/logger.ts`: structured logger. Use it.
- `config/personas/`: persona YAML files loaded by the persona registry.
- `test/`: Mocha tests, fixtures in `test/fixtures/`.
- `.ocr/`: Open Code Review tooling — project config (`.ocr/config.yaml`), the nested `.ocr/.gitignore`, and (when present) IDE shims under `.claude/commands/ocr/`. The vendored skill tree (`.ocr/skills/`), command bodies (`.ocr/commands/`), runtime artifacts (`.ocr/data/`, `.ocr/sessions/`), and per-developer state (`.ocr/cli-config.json`, `.ocr/reviewers-meta.json`) are gitignored alongside `.swarm/`. Run `npx @open-code-review/cli init` after clone to regenerate them. Version pinned at `cliVersion: 1.11.0`.

## Conventions

**Structured logger only.** No `console.log/error/warn` in `src/`. Use `getLogger(scope?)`. The `src/cli.ts` `showUsage()` writes to `process.stdout` directly (not via the logger) because help output should not carry diagnostic prefixes. Help output aside, every other `src/` callsite goes through the logger.

**No `any` in `src/`.** `no-explicit-any: 'error'`. Tests are the only exception.

**Preserve caught errors.** `preserve-caught-error: 'error'`. Attach `cause` when rethrowing.

**No empty catch blocks.** `allowEmptyCatch: false`.

**Unused-var opt-out is `^_` only.** Don't prefix random names with underscore to silence warnings.

**Prettier:** semi, single quotes, trailing-comma all, 100 cols, 2 spaces, LF, `arrowParens: 'always'`.

**EditorConfig:** 2-space indent, LF, UTF-8, trim trailing whitespace, final newline. Markdown exempt from trim. Makefile uses tabs.

**Commits:** conventional-commit-ish with scoped stage tags. Recent history uses `chore(phase-N):`, `feat(phase-N):!`, `fix(phase-N):`, `refactor(falsification):`.

## Config precedence

- **Personas:** project `config/personas/*.yaml`, then install-level fallback.
- **Provider:** flag, then env var (`EXTRACTOR_PROVIDER`, `SESSION_PROVIDER`), then `.swarm/config.yaml`, then deterministic default.
- **Falsifiers:** `off` by default for deterministic provider, `on` for anthropic/local. Override with `--falsifiers <on|off>`.
- **Contract/patches:** auto-discovered from cwd (contract.yaml/json, patches.jsonl, etc.) before falling back to `--contract-file` / `--external-patches-queue`.
- **Pipeline:** `--preset <full|fast|minimal>` or individual flags; preset defaults to `full`.
- **Env:** project `.env`, then orchestrator install `.env`, then `~/.env`. Loading logic in `src/env-loader.ts`.

## Run artifacts

Every execution writes to `.swarm/ledger/<run-id>.jsonl` (append-only ledger) and `.swarm/contracts/<id>/` (contract.jsonl + manifest.json). Both are gitignored at the consumer-repo level.

## Hard don't-do rules

- Don't commit anything listed in `.gitignore`. Run artifacts (`runs/`, `reports/`, `plans/`, `.context/`, `.locks/`, `.quickfix/`) are gitignored on purpose.
- Don't commit `.ocr/data/`, `.ocr/sessions/`, `.ocr/cli-config.json`, `.ocr/reviewers-meta.json`, `.ocr/skills/`, `.ocr/commands/`, or `.claude/settings.local.json` — per-developer or regenerated state.
- Don't commit secrets. `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `service-account*.json` are blocked. Secrets come from environment only. Never from config files, CLI args, or GitHub Actions `with:` inputs. Use the `env:` block.
- Don't commit internal planning docs: `.github/copilot-instructions.md`, `.github/cso-upgrade-plan.md`, `.github/cso-upgrade.md`, `.github/security-recommendations.md`, `.copilot-instructions.md`, `IMPROVEMENTS.md`, `plans/`, `swarm-orchestrator-optimization-plan.md`, `coding-optimization-report.md`.
- Don't use long-lived Google service-account JSON keys. Prefer Workload Identity Federation. If unavoidable, TTL must be ≤ 1 hour.
- Don't open public issues for vulnerabilities. Use GitHub Security Advisories.
- Don't add a merge path that bypasses verification.

## When generating code

- Match existing module boundaries. `src/contract/` owns compilation. `src/session/` owns patch production. `src/falsification/` owns adversarial probing. `src/verification/` owns obligation checking. `src/population/manager.ts` orchestrates tournaments, delegating to `falsifier-dispatch.ts`, `deterministic-dispatch.ts`, `post-merge-handler.ts`, and `single-mode-executor.ts`.
- New falsifier adapter: add a profile under `src/falsification/adapters/profiles/` and register it in `src/falsification/adapters/index.ts`.
- New extractor or session provider: implement the interface in `src/contract/extractor/types.ts` or `src/session/types.ts` and add the factory case.
- Shared types that break circular deps go in `src/shared-types/`, `src/shared-predicates/`, or `src/shared-wasm/`.
- Throw `SwarmError` subclasses (from `src/errors.ts`) with a `remediation` hint so the user knows how to fix the problem.
- Tests go under `test/`, mirror the module path, end in `.test.ts`, run under Mocha.

## README and docs writing rules

These rules apply to `README.md`, all `docs/*.md`, and any other public-facing
prose in the repo. They are stricter than the in-code style guide and override
it where they conflict.

- **Section order is fixed.** Title plus one-line description, badges row,
  "What This Does" (3 sentences max), install or quick start, usage examples,
  architecture (only if complex), API reference (only if applicable),
  contributing, license.
- **"What This Does" stays under 3 sentences.** If it needs more, the project
  is not focused enough yet.
- **Badges row goes immediately after the title.** CI, version, license, test
  count if real, coverage if measured honestly. No vanity badges.
- **No AI tells.** Do not use "empowering developers," "seamlessly,"
  "leverages," "robust," "comprehensive solution," "powerful," "elegant,"
  "intuitive," "battle-tested," "production-ready," or similar marketing
  vocabulary.
- **No em dashes anywhere.** Use commas, colons, semicolons, parentheses, or
  split sentences. Hyphens inside compound terms (mock-of-hallucination) are
  fine; an em dash as a sentence connector is not.
- **No feature walls.** Do not dump bullet lists of capabilities just to
  look substantial.
- **No symmetrical pros/cons blocks** or balanced "tradeoffs" tables. Real
  tradeoffs are asymmetric.
- **Every claim is backed by a number or a link.** No unverified benchmarks,
  no invented stats. If a number is in the README it points to a test, a
  benchmark run, or a fixture count that the reader can reproduce.
- **Evidence-first.** If you cannot point to a test, a benchmark, a
  screenshot, or a working demo, do not claim it.
- **Code examples must run as written.** No pseudo-code passed off as usage.
  Every command and code block in the README is something a reader can paste
  into a shell or file and have work.
- **Human-written voice.** Write like the person who built it, not a
  marketing team or an AI imitating one.
- **No closing fluff.** No "Built with love," no "Star this repo if you like
  it," no thank-you paragraphs.

## Complexity-reduction changes (v9)

The v9 cycle reduced complexity without removing verification stages or quality
gates:

- **Falsifiers auto-off for deterministic provider.** Previously every user
  typed `--falsifiers off` because adapter CLIs are not installed by default.
  Now `--falsifiers` defaults to `off` when the session is deterministic and
  `on` otherwise.
- **Auto-discovery.** `findContractFile(cwd)` and `findPatchesSource(cwd)`
  search the project directory so `--contract-file` and
  `--external-patches-queue` are optional in the common case.
- **Pipeline presets.** `--preset fast` and `--preset minimal` replace
  combinations of `--no-falsifiers --no-streaming --no-pre-generation`.
- **`swarm init`.** Scaffolds contract.yaml + patches.jsonl for the detected
  or specified language.
- **`swarm doctor --fix`.** Auto-resolves 8 categories of common setup
  problems.
- **manager.ts decomposition.** 955 LOC → 4 focused modules (~487 LOC main).
- **Shared-type modules.** `shared-types/`, `shared-predicates/`,
  `shared-wasm/` eliminate circular deps between contract, verification, and
  wasm.
- **Typed errors with remediation hints.** `SwarmError` + 5 subclasses;
  every throw site includes a `remediation` string.
- **58 dead exports removed.** Public surface reduced from 581 to 523
  exported symbols.

## Auditor repositioning (v10)

v10 repositions the project around the audit surface without disturbing the v8
orchestrator. Internal API names (`Obligation`, `Contract`, `verifier`) are
unchanged; only the docs vocabulary, the headline action, and the top-level
CLI surface shifted.

- **`swarm audit` subcommand** with three input modes: `--pr <ref>`,
  `--diff-file <path>`, `--diff-stdin`. Also exposed as a `swarm-audit`
  bin alias.
- **Cheat-detector registry** with ten detectors covering test relaxation,
  mock-of-hallucination, assertion strip, no-op fix, comment-only fix,
  coverage erosion, dead-branch insertion, error swallow, exception
  rethrow with lost context, and fake refactor. Project consumers can
  exempt paths via `.swarm/audit-config.yaml`.
- **PR-source fingerprinter** identifies the AI agent that authored the
  PR (Claude Code, Cursor, Devin, Aider, Codex CLI, Copilot Workspace,
  Replit Agent, OpenHands).
- **Deterministic PR-comment renderer.** Same input → identical Markdown
  output; safe to re-post.
- **AIBOM emitters.** CycloneDX 1.6 ML-BOM and SPDX 3.0 AI-Profile, both
  hand-rolled, no new runtime deps. Triggered by `--emit-aibom`.
- **Ledger extensions.** Optional `aiAgent: { vendor, version?,
  confidence?, source? }` on every entry; three new entry kinds
  (`pr-audit-started`, `pr-audit-finding`, `pr-audit-completed`).
- **GitHub Action `audit-mode: true`.** Composite sub-action at
  `.github/actions/swarm-audit/` emits `audit-pass`, `audit-findings`,
  `audit-ledger` outputs and posts the rendered finding back to the PR
  via `GITHUB_TOKEN`. Dogfooded on every PR via
  `.github/workflows/pr-audit.yml`.
- **500/500 broken/clean fixture corpus** under
  `benchmarks/falsification-corpus/v10-synthetic-corpus/` (renamed in
  v10.1 from `v10-corpus/` so the leaderboard UI can show real-corpus
  numbers as the headline and the synthetic numbers as a regression
  sidebar), generated by `scripts/corpus/`.
- **Reproducible leaderboard** at `benchmarks/leaderboard/` rendered as
  a static site under `docs/leaderboard/`.

<!-- OCR:START -->
## Open Code Review Instructions

> **Managed block.** Content between `<!-- OCR:START -->` and `<!-- OCR:END -->`
> is regenerated by `ocr init`. Edits here will be overwritten — file issues
> against the OCR skill instead. Mirrored in `AGENTS.md`.

These instructions are for AI assistants handling code review in this project.

**When to load the skill.** Open `.ocr/skills/SKILL.md` whenever the request
asks for code review, PR review, multi-perspective feedback, or navigation of
a large changeset.

**What the skill provides.** The 8-phase review workflow, the Code Review Map
(via `references/map-workflow.md`), the available reviewer personas, and
session output format.

<!-- OCR:END -->
