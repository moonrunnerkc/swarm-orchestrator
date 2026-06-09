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
