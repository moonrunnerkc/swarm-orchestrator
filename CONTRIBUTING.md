# Contributing

## Development

Get started: `npm install && npm run build && npm test`

- TypeScript strict mode, ES2020 target
- All source files use the structured logger (`src/logger.ts`) — no raw `console.log/error/warn`
- Before submitting a PR: run `npm test`, run `swarm gates .`, and keep commits descriptive

## Sub-Project Tests

Sub-project tests run independently inside their directories:

```bash
cd calculations-api && npm install && npm test
cd notes-api && npm install && npm test
cd calculator && npm test
cd logtail && npm test
cd web && npm test
cd tictactoe && npm test
pytest app/tests/ -v
```

Sub-projects that use only Node.js built-ins (`calculator/`, `logtail/`, `tictactoe/`) need no install step. Others require `npm install` first.

## Troubleshooting CI self-gates

The `build-and-test (22)` CI job runs a self-gate step (`node dist/src/cli.js gates .`) that `build-and-test (20)` skips (see `.github/workflows/ci.yml`, `if: matrix.node-version == 22`). If Node-20 passes and Node-22 fails, the failure is almost always a self-gate issue, not a Node-version incompatibility. Pull the failing step's log before debugging Node runtime differences.

Two specific gate failures to watch for:

**`runtime-checks`: `'require' is not defined  no-undef`**

The `runtime-checks` gate runs `npx eslint <changed-files>` on agent-changed files. The project's flat eslint config (`eslint.config.mjs`) sets language options per file glob. If you add a new plain-JS file (`*.js` / `*.cjs`) outside `src/`/`test/`, the gate will lint it and fail unless the file is covered by a block that enables Node globals.

The fix lives in `eslint.config.mjs`: the `files: ['**/*.js', '**/*.cjs']` block sets `sourceType: 'commonjs'` and declares Node globals (`require`, `module`, `process`, etc.). Any new JS file under a tracked path will be covered automatically. If you need to opt a path out of linting entirely (fetch caches, generated scaffolds), add a glob to the top-level `ignores` array.

**`test-coverage`: `no test coverage for <file>`**

The `test-coverage` gate treats `*.js`/`*.ts`/`*.jsx`/`*.tsx` files as product code unless they match a known tooling-dir regex in `src/quality-gates/gates/test-coverage.ts`. The regex currently excludes `server|config|scripts|examples?|deploy|benchmarks`. If you add tooling under a new top-level path (e.g. a new `tools/` directory), the gate will flag it unless you extend the regex.

Dynamic `require(variable)` imports are invisible to the gate's coverage-tracing regex (`(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]`), so a test that does `require(ENGINE_PATH)` won't register as covering `ENGINE_PATH`. Either switch to a static relative path (`require('../../../benchmarks/.../engine')`) or move the file under one of the excluded tooling dirs.
