# upgrade-claimcheck: acceptance criteria

Sealed before either agent started. Neither agent sees this file, `requirements.json`, `judge.toml`
or `held-out/`.

- Category: upgrade
- Repository: claimcheck (read-only; every run works in a clone)
- Base: `d93aea51ed2e13148f93ea63ce410c4feabe9a5a`
- Source of the task: new; written for this comparison

## Requirement record

`requirements.json`, passed to `swarm-verify verify --requirements`. R1's text is the task as typed.

```json
[
 {
  "id": "R1",
  "text": "Upgrade claimcheck to vitest 5: vitest and @vitest/coverage-v8 to ^5, with package-lock.json updated. Stryker's 9.x vitest runner can't drive vitest 5, so move @stryker-mutator/core and @stryker-mutator/vitest-runner to ^10 as well, and move the Stryker version claimcheck installs into the repos it checks (src/adapters/worktree-toolchain.ts) to 10.x for repos on vitest 2 and later; repos on vitest 1 keep 8.7.1. Typecheck, build and the test suite must stay green.",
  "source": "user",
  "kind": "upgrade",
  "required": true,
  "assumptions": [],
  "versions": [
   {
    "name": "vitest",
    "ecosystem": "npm",
    "range": "^5",
    "latest": false,
    "wording": "vitest and @vitest/coverage-v8 to ^5"
   },
   {
    "name": "@vitest/coverage-v8",
    "ecosystem": "npm",
    "range": "^5",
    "latest": false,
    "wording": "vitest and @vitest/coverage-v8 to ^5"
   },
   {
    "name": "@stryker-mutator/core",
    "ecosystem": "npm",
    "range": "^10",
    "latest": false,
    "wording": "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10"
   },
   {
    "name": "@stryker-mutator/vitest-runner",
    "ecosystem": "npm",
    "range": "^10",
    "latest": false,
    "wording": "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10"
   }
  ],
  "evidence": {
   "tests": [],
   "checks": [
    "test",
    "typecheck",
    "build"
   ],
   "structure": [],
   "packages": [
    {
     "name": "vitest",
     "ecosystem": "npm",
     "version": "5.x"
    },
    {
     "name": "@vitest/coverage-v8",
     "ecosystem": "npm",
     "version": "5.x"
    },
    {
     "name": "@stryker-mutator/core",
     "ecosystem": "npm",
     "version": "10.x"
    },
    {
     "name": "@stryker-mutator/vitest-runner",
     "ecosystem": "npm",
     "version": "10.x"
    }
   ]
  }
 }
]
```

## Declared checks

`judge.toml`, written as the judging clone's `swarm.toml` after sealing (what `swarm init` infers
for this repository):

```toml
# The judge's declared checks: what swarm init infers for this repository at the base.
[checks]
test = "npm run test"
typecheck = "npm run typecheck"
build = "npm run build"
```

## Held-out check

Sealed with `swarm-verify init --seal 'src/**/*.held-out.test.ts'` from a `swarm.toml` whose only test check is
`held-out = { command = "npx vitest run src/adapters/stryker-overlay.held-out.test.ts", kind = "test" }`. The files are copied from
`held-out/` into the judging clone, sealed out of it, and overlaid only for the held-out run.

The compatibility check at the call site: prepareToolchain on a repo with a package-lock and vitest 5.1.0, 4.1.8 or 2.1.9 overlays @stryker-mutator/core and vitest-runner at one 10.x version, and on vitest 1.6.0 keeps 8.7.1. The package manager is mocked; nothing is installed.

- `held-out/src/adapters/stryker-overlay.held-out.test.ts` sha256 `3c1125307349a03a7641d68497daa4b305ecb6c75d49ad9a73dadf2d1de73d1d`

## How both patches are judged

The same way, by `judge.sh`: a fresh clone at the base, the held-out files sealed, `judge.toml`
as `swarm.toml`, then `swarm-verify verify --base d93aea51ed2e13148f93ea63ce410c4feabe9a5a --patch <patch.diff> --requirements
requirements.json`, isolated, dependencies prepared, then `swarm-verify replay`. The verdict's
requirement statuses and held-out result are the outcome.
