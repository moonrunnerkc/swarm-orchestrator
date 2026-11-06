# fix-claimcheck: acceptance criteria

Corrected on 2026-11-05, the one criteria change the 17.0.0 contract permits: R1's tests were
mapped by the path prefix `src::`, which leaves out `test/**`, a root claimcheck's vitest config
also collects. They are now the fix commit's three tests, named by their identity as the runner
reports them, which the sealed held-out run measures. The criteria as committed before either
agent ran are kept beside this file as `criteria.original.md` and `requirements.original.json`;
the reason is in `CORRECTION.md`.

Sealed before either agent started. Neither agent sees this file, `requirements.json`, `judge.toml`
or `held-out/`.

- Category: fix
- Repository: claimcheck (read-only; every run works in a clone)
- Base: `d381bec7f8c860672e334ae91d54db842d1c4f7c`
- Source of the task: claimcheck e050152 ("fix: don't BLOCK when a whole test is deleted"), base at its parent

## Requirement record

`requirements.json`, passed to `swarm-verify verify --requirements`. R1's text is the task as typed.

```json
[
 {
  "id": "R1",
  "text": "claimcheck blocks a change that deletes a whole test. compareTestFile in src/checks/test-weakening.ts reports assertion-removed whenever a test file's expect() count drops, so deleting an obsolete test or splitting a file reads as stripping an assertion, and the decision BLOCKs. Deleting a test is ambiguous, not the strip-an-assertion cheat. When the expect() count drops and the file also has fewer test cases (it/test calls, including variants such as it.skip, it.only, test.each and xit), report a new test-weakening kind, test-removed, which the decision only WARNs on, like expected-value-changed. A drop in expect() calls with the test count unchanged is still assertion-removed and still blocks. Fix it, with a test.",
  "source": "user",
  "kind": "fix",
  "required": true,
  "assumptions": [],
  "versions": [],
  "evidence": {
   "tests": [
    {
     "name": "src/checks/test-removed.held-out.test.ts::compareTestFile, held out > flags a deleted test as the ambiguous test-removed, not assertion-removed"
    },
    {
     "name": "src/checks/test-removed.held-out.test.ts::compareTestFile, held out > still flags an assertion removed from a surviving test as assertion-removed"
    },
    {
     "name": "src/core/test-removed-decision.held-out.test.ts::decide, held out > only warns when a whole test was removed, since deletion is ambiguous"
    }
   ],
   "checks": [
    "test",
    "typecheck",
    "build"
   ],
   "structure": [],
   "packages": []
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
`held-out = { command = "npx vitest run src/checks/test-removed.held-out.test.ts src/core/test-removed-decision.held-out.test.ts", kind = "test" }`. The files are copied from
`held-out/` into the judging clone, sealed out of it, and overlaid only for the held-out run.

The three test cases the fix commit e050152 added, verbatim, moved into two new files so an agent adding tests to the existing test files does not touch a sealed path.

- `held-out/src/checks/test-removed.held-out.test.ts` sha256 `403b904274a213859bb1814ada0ce6354c98736f1475fa60c10e397d64a63585`
- `held-out/src/core/test-removed-decision.held-out.test.ts` sha256 `8c716a7d9e74424a5585d2a39432a1893d3cc5640343631ab615d2db5b8f9584`

## How both patches are judged

The same way, by `judge.sh`: a fresh clone at the base, the held-out files sealed, `judge.toml`
as `swarm.toml`, then `swarm-verify verify --base d381bec7f8c860672e334ae91d54db842d1c4f7c --patch <patch.diff> --requirements
requirements.json`, isolated, dependencies prepared, then `swarm-verify replay`. The verdict's
requirement statuses and held-out result are the outcome.
