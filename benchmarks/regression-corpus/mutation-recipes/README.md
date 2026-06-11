# Mutation recipes

Per-repo adjustments for corpus repos whose test suite cannot start under
the generic Stryker sandbox. A recipe is `<repo-slug>.json` with two
optional keys:

- `env`: extra environment variables for the `stryker run` process only
  (example: `NX_DAEMON=false` for the nx daemon hang the viability table
  records).
- `strykerConfig`: keys merged over the generated Stryker config (example:
  a `vitest.configFile` pointing at the package config, or a longer
  `timeoutMS` for a slow suite).

A recipe never changes what gets mutated, only how the suite executes, so
it cannot manufacture signal; it can only turn a `did not run` into a
measured run. Loaded by `scripts/real-prs/run-execution-grounded.ts`,
applied in `src/audit/execution-grounded/mutation-check.ts`, and folded
into the eg-cache key so recipe changes invalidate stale cached outcomes.

Add a recipe only with the failure reason it addresses written down in
the commit message; a recipe nobody can explain is a config landmine.

## Investigated and not recipe-fixable

Each repo below was debugged in a provisioned workspace (shallow clone at
a corpus PR head, lockfile install, the exact generated Stryker config).
The root causes are recorded so nobody re-spends the debugging time. A
recipe can only adjust env and Stryker config keys; none of these
blockers lives in that surface.

- **vitejs-vite** (debugged at PR 19057, 2026-06-10). Four stacked causes.
  (1) The vitest runner's `related: true` default finds no tests for the
  mutated client-side file, producing the recorded "No tests were
  executed"; `vitest: { related: false }` fixes that. (2) The generated
  `disableTypeChecks: true` prepends `// @ts-nocheck` to fixture files
  whose raw content the suite snapshots (`runner.import('...?raw')`);
  `disableTypeChecks: false` fixes that. (3) Node 22.18+ backported
  TypeScript type stripping, and the suite's version guard expects it
  only on 23.6+/24+, so one test fails on the harness's Node 22;
  `env: { NODE_OPTIONS: --no-experimental-strip-types }` fixes that.
  (4) Terminal: 16 tests across 9 spec files assert real-tree paths and
  module resolution, so the suite cannot run from a Stryker sandbox copy
  (measured by running the suite from a sandbox-style copy), and the
  `inPlace` alternative crashes with SIGABRT because
  `@stryker-mutator/vitest-runner` hard-codes `pool: 'threads'` plus an
  injected setup file. Needs an upstream vitest-runner pool passthrough.
- **mui-material-ui** (debugged at PR 41666, 2026-06-10). The suite's own
  vanilla `mocha` run fails on the harness's Node 22 before Stryker is
  involved: `setupJSDOM` assigns `global.navigator`, which Node 21+
  makes getter-only, and mocha 10's import-first loader trips modern
  module-syntax detection in the babel-register pipeline. The suite
  pinned Node-20 semantics at this corpus commit. No Stryker config or
  env key changes the Node runtime, and pointing a committed recipe's
  PATH at a machine-local old Node is exactly the config landmine this
  file warns about.
- **cloudflare-workers-sdk** (from the recorded run plus runner source).
  The suite requires `@cloudflare/vitest-pool-workers`, which executes
  tests inside workerd. `@stryker-mutator/vitest-runner` hard-codes
  `pool: 'threads'` (see `vitest-test-runner.js` in the installed
  package), replacing the workerd pool, so the initial test run can
  never succeed. Same upstream pool passthrough needed as vite.
- **withastro-astro** (from package.json inspection at PR 16366/16555
  heads). `astro-scripts test` wraps `node:test`; no Stryker runner
  adapter exists for it, and the unsupported-runner gate in
  `mutation-check.ts` fires before recipes are applied, so a recipe
  cannot reach the failure. Driving astro means writing a node:test
  runner adapter, not a recipe.
- **vercel-next.js** (debugged at PR 55978, 2026-06-10). The repo
  exact-pins `@babel/core` to 7.18.0 (June 2022), and pnpm dedupes
  `@stryker-mutator/instrumenter`'s own `^7.x` babel dependency onto that
  copy. The instrumenter's `import { types } from '@babel/core'` then
  fails at startup: 7.18.0's getter-style CommonJS exports defeat Node
  22's cjs-module-lexer named-export detection (verified:
  `import('@babel/core')` exposes no `types` named export at that
  version). Stryker crashes before any config or env is consulted, so no
  recipe key can reach it. Fixing it means the workspace resolving a
  newer `@babel/core` for the instrumenter (a manifest change, outside
  the recipe surface) or an upstream instrumenter that imports the CJS
  default.
