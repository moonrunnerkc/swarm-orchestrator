# Contributing

## Development

```bash
npm install && npm run build && npm test
```

Before any PR: `npm test`, then `node dist/src/cli.js gates .`, then a descriptive commit. The self-gate runs in CI; orchestrator regressions fail their own gates.

## Code Style

- **TypeScript strict mode**, ES2022 target, CommonJS modules. `exactOptionalPropertyTypes` is on.
- **Named exports only.** No `export default`.
- **Kebab-case filenames.** `share-parser.ts`, not `ShareParser.ts` or `shareParser.ts`.
- **No `any`** in `src/`. Tests and `src/dashboard.tsx` are the only exceptions; the linter enforces this.
- **Full JSDoc on public functions.** What it does, params, return, throws. Internal helpers can be lighter.
- **300-line soft limit per file.** If a file is pushing 300, decompose along natural seams, not arbitrary splits.
- **Structured logger only.** `getLogger(scope?)` from `src/logger.ts`. No `console.log/error/warn` in `src/`.
- **Preserve caught errors.** `throw new Error('context', { cause: err })` when rethrowing.
- **No empty catch blocks.** No `_` underscore prefixes except for genuinely unused params.
- **No TODO comments.** If it is a real issue, file it or fix it.
- **No defensive coding** for cases that cannot happen. Trust internal invariants; validate at system boundaries.
- **Tests validate real behavior**, not wiring. A test that asserts "function X was called" without verifying the result is worse than no test.
- **Root cause only in commit messages.** Conventional-commits style, scoped stage tags where they apply.

Prettier: semi, single quotes, trailing-comma all, 100 cols, 2 spaces, LF, `arrowParens: 'always'`. EditorConfig: 2-space indent, LF, UTF-8, trim trailing whitespace, final newline (markdown exempt).

## Falsification Battery Development

The five-layer battery lives under `src/verification/`. Each layer has an entry point, an input type, and a result type exported from `src/verification/index.ts`.

### Adding a new advisory rule

Layer 3 (cheat-detector) is the rule extension point. To add a rule:

1. Add the heuristic in `src/verification/cheat-detector.ts` as a `detectXxx(files, ...)` helper that returns `CheatFinding[]`. Keep it under 30 lines.
2. Wire it into `runCheatDetector` in the same file alongside the existing `detect*` calls.
3. Add a Semgrep rule pack file under `config/semgrep-rules/` with the matching `id` (`swarm-agent-<rule-name>`).
4. Add a unit test under `test/verification/cheat-detector.test.ts` that asserts the heuristic fires on a hand-crafted minimal diff and does not fire on a clean control diff.

Do not add new layers to the battery. The five-layer structure is fixed for the 7.x line.

### Extending the composite scoring

The composite is computed by `computeCompositeScore` in `src/verification/composite-score.ts` from three layer scores (cheat detector, property gate, attestation) and an advisory-gate penalty. Defaults live in `DEFAULT_COMPOSITE_CONFIG`; `.swarm/gates.yaml` overrides them per project.

To change the default weighting, edit `DEFAULT_COMPOSITE_CONFIG` and the corresponding test in `test/verification/composite-score.test.ts`. Do not change weights without an explicit reason in the commit message; downstream operators tune per-project via `.swarm/gates.yaml`.

To penalise a specific advisory gate ID more than the default, project operators set `gateWeights.<gateId>` in `.swarm/gates.yaml`. The orchestrator does not need code changes for new gate-ID-specific weights.

### Eval scripts

Eval harnesses are under `scripts/eval/`:

- `synthesizer-eval.ts` — Layer 1 false-positive and false-negative rates against a labelled instance set.
- `cheat-detector-eval.ts` — Layer 3 false-positive rate on gold patches and true-positive rate on synthetic cheats.
- `property-gate-eval.ts` — Layer 4 signal-to-noise ratio of counterexamples.

The cheat-detector eval is the most tractable to run locally; the other two need the SWE-bench Docker harness for dep-installed checkouts.

Any change to a gate's heuristic must include a re-run of the corresponding eval.

## Adapters

The three current adapters (`copilot-adapter.ts`, `claude-code-adapter.ts`, `codex-adapter.ts`) are the supported set for v7. Do not add a new agent adapter as part of v7 work. Adapter capability matrix lives in [docs/adapters.md](docs/adapters.md). All three default to cold-start; persistent-interactive mode is experimental and requires `SWARM_ENABLE_PERSISTENT_INTERACTIVE=1`.

## Attestation Signing

Cosign keyless signing is the supported path: Fulcio issues short-lived certificates via OIDC, no long-lived keys are stored anywhere. The signing helper is in `src/verification/cosign-attestation.ts`; the unsigned fallback (`unsignedTestSigner`) is for tests only.

Do not commit cosign keypairs to the repository. `.gitignore` blocks `*.pem`, `*.key`, `*.p12`, `*.pfx`. Service-account JSON for any adjacent infra must use Workload Identity Federation; long-lived service-account keys are not allowed.

## Sub-Project Tests

`app/`, `calculator/`, `calculations-api/`, `logtail/`, `notes-api/`, `tictactoe/`, `web/` are generated demo scaffolds. They are gitignored as top-level paths and regenerated by orchestrator runs, so a fresh clone will not contain them. Do not edit them by hand expecting changes to stick.

When a scaffold is present locally, you can run its tests independently:

```bash
cd calculations-api && npm install && npm test
cd notes-api && npm install && npm test
cd calculator && npm test
cd web && npm test
cd tictactoe && npm test
```

`calculator/`, `tictactoe/` use only Node built-ins, no install. `web/` and the API scaffolds need `npm install` first. The Python `app/` scaffold needs its own venv with FastAPI dependencies installed before `pytest app/tests/ -v` will run.

## Troubleshooting CI Self-Gates

The Node-22 CI matrix runs the project's own quality-gate self-check (`node dist/src/cli.js gates .`); the Node-20 matrix skips it. If Node-20 passes and Node-22 fails, look at the self-gate output before suspecting Node-version drift.

Two specific gate failures to watch for:

**`runtime-checks`: `'require' is not defined  no-undef`** — the runtime-checks gate runs ESLint on agent-changed files. The flat config (`eslint.config.mjs`) sets language options per file glob; the `files: ['**/*.js', '**/*.cjs']` block sets `sourceType: 'commonjs'` and declares Node globals. New JS or CJS files outside that pattern need to be added there or excluded via the top-level `ignores` array.

**`test-coverage`: `no test coverage for <file>`** — the test-coverage gate treats `*.js`/`*.ts`/`*.jsx`/`*.tsx` as product code unless they match the tooling-dir regex in `src/quality-gates/gates/test-coverage.ts` (currently `server|config|scripts|examples?|deploy|benchmarks`). Dynamic `require(variable)` imports are invisible to its coverage tracer; switch to a static path or move the file under one of the excluded tooling dirs.
