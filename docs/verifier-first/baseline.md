# G0: the repaired baseline

Baseline: `270811a4474284d9be2d07765eb26c35bc0c5453`, the tip of `v13-main` on 2026-09-27 and the
commit this campaign starts from. The audited commit `a6a83eeb9201957d505824b135f0bc9c83ee9944`
is its ancestor by ten corrective commits; nothing was reset to it.

Working tree at the start: clean except two untracked files from the feedback study under
`docs/evidence/2026-09-19/feedback-intervention/`, which belong to that study and were not
touched. Sibling worktrees (`swarm-broad-use` at the same commit, eight detached `swarm-redesign-*`
checkouts) were left as found.

## Prerequisite outcomes on the current implementation

Each of the four prerequisites is held by a regression test that ran in the local gate suite
below and by the remote runs on the same commit.

| Prerequisite | Held by | Result |
| --- | --- | --- |
| Candidate-controlled Playwright configuration, reporter or output cannot fabricate accepted browser evidence; runtime and offline derivation both refuse it | `src/gates/browser-trust.integration.test.ts` ("does not accept JSON forged by a real Playwright configuration before a failing test runs"), `src/gates/browser-results.test.ts` (wrong sealed identity, hidden retry, incomplete results), `src/evidence/verifier/behavior.mjs` under `src/evidence/verifier-parity.test.ts` | passed locally; remote gates run 36335616120 passed |
| Package-scoped verification retains package-qualified unavailable checks with reasons | `src/gates/package-scope.test.ts` (unavailable package checks retained; ambiguous override refused), `src/gates/package-assessment.integration.test.ts` | passed locally and remotely |
| Every mandatory clean-runner browser workflow provisions the browser; nightly proof reaches fuzzing and the valid/tampered bundle controls; failure notification needs no optional label | `scripts/nightly-proof.test.mjs` (both cases), `.github/workflows/nightly-proof.yml`; remote nightly proof run 36335615650 on this commit completed gates, fuzz and both proof arms | passed |
| Existing source, environment, contract and evidence protections still work | the full suite, including `src/evidence/redteam-adversarial.test.ts`, `src/gates/judge-gap-attack.test.ts`, `src/gates/report-forgery.test.ts`, `src/evidence/resign-attack.test.ts`; remote action-controls run 36335616129 (good and bad candidates) | passed |

## Local gate transcript

`npm run gates` on the baseline, run twice. The first run failed at `typecheck` because the
checkout's `node_modules` predated the fast-forward and lacked `@playwright/test`, which the
lockfile now pins; that is a stale local environment, not a source defect. After `npm ci` the
second run passed. Its full output is
[gates-baseline-270811a44.txt](../evidence/2026-09-27/verifier-first/gates-baseline-270811a44.txt).
The closing lines, verbatim:

```text
 Test Files  379 passed (379)
      Tests  3625 passed (3625)
   Start at  12:47:41
   Duration  150.71s (transform 11.61s, setup 0ms, import 27.30s, tests 1131.93s, environment 18ms)

EXIT=0
```

No test was skipped in this run. The checks stage reported gate 3a as zero with 138 recorded
verdicts re-deriving to what the tool claimed. Environment: Node 24.15.0, macOS, Docker 29.5.2
available, Chromium fixture image not built locally (browser integration tests that need it
report their capability outcome rather than skipping silently; none failed).

## What G0 does not establish

This is a development baseline. It says the repaired foundation holds under its own suite and
its own remote workflows. It says nothing about the verifier-first requirements, which start at
G1 with this commit as their base.
