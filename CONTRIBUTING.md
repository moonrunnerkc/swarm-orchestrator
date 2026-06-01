# Contributing

## Development

```bash
npm install && npm run build && npm test
```

Before any PR: `npm test`, `npm run typecheck`, then a descriptive commit. CI runs the LOC-budget gate (`scripts/loc-budget-gate.sh`) against `evidence/loc-budget.txt`.

## Code Style

- **TypeScript strict mode**, ES2022 target, CommonJS modules. `exactOptionalPropertyTypes` is on.
- **Named exports only.** No `export default`.
- **Kebab-case filenames.** `run-verifier.ts`, not `RunVerifier.ts` or `runVerifier.ts`.
- **No `any`** in `src/`. Tests are the only exception; the linter enforces this.
- **300-line soft limit per file.** If a file is pushing 300, decompose along natural seams, not arbitrary splits.
- **Structured logger only.** `getLogger(scope?)` from `src/logger.ts`. No `console.log/error/warn` in `src/`.
- **Preserve caught errors.** `throw new Error('context', { cause: err })` when rethrowing.
- **No empty catch blocks.** No `_` underscore prefixes except for genuinely unused params.
- **No TODO comments.** If it is a real issue, file it or fix it.
- **No defensive coding** for cases that cannot happen. Trust internal invariants; validate at system boundaries.
- **Tests validate real behavior**, not wiring. A test that asserts "function X was called" without verifying the result is worse than no test.
- **Root cause only in commit messages.** Conventional-commits style.

Prettier: semi, single quotes, trailing-comma all, 100 cols, 2 spaces, LF, `arrowParens: 'always'`. EditorConfig: 2-space indent, LF, UTF-8, trim trailing whitespace, final newline (markdown exempt).

## Falsification Adapters

The falsifier subsystem lives under `src/falsification/adapters/`. Three CLI-backed profiles ship by default: Codex (`property-must-hold`), Copilot (`import-graph-must-satisfy`, `function-must-have-signature`), and Claude Code (opt-in). To add a new profile, implement the `AdapterProfile` interface and register it in `src/falsification/adapters/index.ts`.

Subsystem overview: [`docs/falsification-adapters.md`](docs/falsification-adapters.md).

## Cheat detectors and the oracle

New cheat detector PRs must include at least one injector under `src/audit/oracle/inject/` so recall is measurable from day one. The `category-mapping` test fails CI if an injected category resolves to no detector and no judge-primary path. See [`docs/audit/methodology.md`](docs/audit/methodology.md).
