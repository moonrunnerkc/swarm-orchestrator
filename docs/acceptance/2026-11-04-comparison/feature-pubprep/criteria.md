# feature-pubprep: acceptance criteria

Sealed before either agent started. Neither agent sees this file, `requirements.json`, `judge.toml`
or `held-out/`.

- Category: feature
- Repository: pubprep (read-only; every run works in a clone)
- Base: `99d8d054753b4e8979431eb58792895c754fbdc9`
- Source of the task: new; written for this comparison

## Requirement record

`requirements.json`, passed to `swarm-verify verify --requirements`. R1's text is the task as typed.

```json
[
 {
  "id": "R1",
  "text": "Add a --reviewers option to pubprep so a run can use only some of the three reviewers. It takes a comma-separated list of short names: tech-debt, docs and security, for tech-debt-reviewer, readme-docs-reviewer and security-reviewer. parseArgs returns the choice as `reviewers`, the full agent names in the order tech-debt, docs, security whatever order they were typed, each once even when repeated. Without the flag, leave `reviewers` unset; a run then uses all three, as now. A missing or empty value is an error naming the valid short names, and a name that isn't one of the three is an error naming it and the valid short names. orchestrate takes the same list as an optional `reviewers` param (all three when omitted) and runs only those reviewers, in parallel or in sequence, so only their reports are written and concatenated into combined-review.md; main passes the parsed list through. Document the flag in the --help text. Add tests.",
  "source": "user",
  "kind": "feature",
  "required": true,
  "assumptions": [],
  "versions": [],
  "evidence": {
   "tests": [
    {
     "name": "test::"
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

Sealed with `swarm-verify init --seal 'test/**/*.held-out.test.ts'` from a `swarm.toml` whose only test check is
`held-out = { command = "npx vitest run test/reviewers.held-out.test.ts", kind = "test" }`. The files are copied from
`held-out/` into the judging clone, sealed out of it, and overlaid only for the held-out run.

Written from the task's wording: the parse cases (unset default, canonical order, repeats, empty, unknown, missing value, --help) and orchestrate running only the chosen reviewers, in parallel and in sequence.

- `held-out/test/reviewers.held-out.test.ts` sha256 `7fabee0266a3d73213ac5c6d618ed8e359d0b7f6a906d88bfd882fb6f63d7050`

## How both patches are judged

The same way, by `judge.sh`: a fresh clone at the base, the held-out files sealed, `judge.toml`
as `swarm.toml`, then `swarm-verify verify --base 99d8d054753b4e8979431eb58792895c754fbdc9 --patch <patch.diff> --requirements
requirements.json`, isolated, dependencies prepared, then `swarm-verify replay`. The verdict's
requirement statuses and held-out result are the outcome.
