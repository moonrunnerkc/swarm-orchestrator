# Broad-use upgrade evidence

Implementation, required local gates, installed-package validation and default-branch delivery
are complete. Exact-commit remote CI and the real GitHub Action controls passed.
No package publication or release tag is claimed.

## Source and environment

The tested executable source is `e9f680a7b72e48bef57551099c1ffe6db4269273`. All final commands below ran on that clean commit.
Later reporting-only commits are not described as having run beforehand. This upgrade began
from `103d3ce4868a7a7fcd74e41adf4626efaa0c2fc0`, preserving local work newer than reviewed remote
`43b6c5c764c18a053606185c26366f3f586ee09d`. The isolated branch is `upgrade/broad-use`.
The original worktree and its two untracked feedback-study artifacts are untouched. Full history
and `v12-final` were present; the conflicting local `v14.0.0` tag was not rewritten.

Node 24.15.0, npm 11.12.1, pnpm 9.15.0, uv 0.11.13, host Python 3.14.7, isolated Python
3.11.2, pytest 9.0.2, Vitest 4.1.11, Playwright 1.63.0, Chromium 153 and Docker 29.5.2.
Image identities, commands, durations, tarball digests and retained artifact paths are in
[observations.json](observations.json). Session evidence stays outside the workspace with
owner-only storage. Raw logs are retained under `/tmp/swarm-upgrade-evidence`; fixture records
and signed bundles are under `/Users/brad/.swarm/upgrade-validation` and `/Users/brad/.swarm/sessions`.
The manifest hashes identify those local artifacts; the source repository does not embed their
large logs or claim that a local path is a public download.

## Required local commands

| Command | Exit | Actual result |
| --- | --- | --- |
| `npm run gates` | 0 | 375 files, 3613 tests passed; no skipped tests |
| `npm run build` | 0 | Full package emitted |
| `npm run build:verify` | 0 | 144 standalone modules and 13 assets; boundary enforced |
| `npm run check:packaged` | 0 | Both installed CLIs met command/exit contracts; tampered bundle refused |
| `npm run fuzz:build` | 0 | All eight existing harnesses executed their seeds |

Actual final-gates output:

```text
 Test Files  375 passed (375)
      Tests  3613 passed (3613)
   Start at  00:47:57
   Duration  146.90s (transform 11.16s, setup 0ms, import 27.43s, tests 1123.90s, environment 18ms)
```

Checks retained full-history validation, generated policy agreement, documentation paths, repository
weight/headroom, packed derived evidence, 14 cited bundles and 138 independently re-derived CI
verdicts. Lint reported 22 existing warnings and one information message, with no suppressed
diagnostics. Fixture `not-applicable` and unmeasured capabilities remain in the raw output; they
are not skipped Vitest tests or additional passing measurements.

## Installed-package and behavior matrix

Every row below exited 0 as a validation script. Its deliberately wrong candidates exited 1
and were checked for the required behavioral rejection. These are separate runs, not an invented
combined test total. Verification used no model credentials. Fresh tarballs were installed into
empty prefixes; provider SDKs, selection, workers and TUI remain outside the standalone closure.

| Run | Recorded subprocess observations | Result and limits |
| --- | --- | --- |
| `installed-final` | 24 | Both CLIs: patch/branch bugfix, signer/integrity separation, wrong behavior and isolated native execution |
| `presets-final` | 36 | npm/pnpm/uv locked upgrades, installed versions, build/behavior and manifest-tampering rejection |
| `selected-final` | 24 | Mixed pnpm/Vitest + uv/pytest, existing venv, refactor, idempotent init and outside/shared scope refusal |
| `browser-final` | 14 | Both CLIs: isolated Chromium click interaction passes; doubled increment fails; bounded traces/screenshots |
| `http-final` | 14 | Both CLIs: owned HTTP POST and JSON assertions, good/bad behavior, cleanup and offline verifier |
| `python-container-final` | 11 | Both CLIs: network-disabled locked uv preparation, real pytest and pinned Python good/bad CLI result |
| `pr-standalone-final` | 5 | Standalone: actual public PR, patch and branch parity with honest vacuous-oracle result |
| `pr-full-final` | 5 | Full CLI: same actual PR/patch/branch parity |
| HTTP container follow-up | 4 | Both installed binaries matched the pinned good/bad host candidates with measured isolation |

The real public PR control is `moonrunnerkc/swarm-orchestrator#73`, target/comparison
`a950d1bd51474ec24ec647c3fd9ed3c003dc93b8`, head
`8448e41ce5c8c5f60ee770a499533b59de88668f`. Both binaries gave equivalent PR, branch and patch
semantics while retaining a dirty untracked file. Its deliberately inadequate syntax oracle
produced `[false, unmeasured, vacuous, unmeasured, not-bonded]`; this is successful parity
validation, not successful acceptance of that PR's objective. Local real-Git tests cover exact
versus merge-base identity, binary content, dirty index preservation, hostile refs and special
entry refusal; the moving-PR transport control is deterministic, not a simulated remote result.

Base controls and independent bundle derivation run for bugfix/refactor/upgrade scenarios.
An ephemeral signer remains untrusted unless separately admitted. The embedded verifier's
integrity exit 0 is separate from the installed CLI's signer-policy exit 1. Advanced coverage,
assertion counting and deletion exemptions remain unmeasured for Vitest/pytest/package scopes.

## Failure history and corrections

- Baseline full gates: exit 0, 356 files and 3520 tests, 135.89s. Baseline build, verifier build,
  packaged check and fuzz build also exited 0.
- Incremental gates 4: exit 1, 3 failed/3579 passed tests, 138.09s. Old parser/coverage expectations
  and runtime declaration inventory were corrected. Run 5: exit 1, 3 failed/3593 passed, 138.20s,
  from stale command-shape expectations. Run 6 stopped at typecheck; run 8 stopped at formatting.
- Incremental gates 7: exit 1, 1 failed/3608 passed, 146.33s. Cancellation during preflight was
  misclassified as setup failure and preserved an untouched checkout. The original cleanup test
  reproduced it; cancellation now returns through the existing stop path. Run 9 passed 3612 tests.
- Final gates 1 at `be7780a83b663a4e368089da82435ed068c9ac81`: exit 1, 1 failed/3612 passed,
  151.18s. The goal-candidate test observed one missing dispatch. Its focused rerun passed both
  cases; diagnostics were improved, without weakening assertions or timeouts. The cause was not
  established. Final gates 2 above passed the entire suite, including that test.
- The explicit-PR-base regression first failed (1 failed/14 passed), then passed after retaining
  the PR target separately from an exact comparison override. The final repair-brief regression
  first failed with 28 tests deselected, then the complete two-file run passed 31 tests. Deselecting
  tests in that focused diagnostic is not a full-gates pass.
- Browser CLI controls exposed a nested acceptance-path refusal and Git's `does not match index`
  after snapshot restoration. Existing directory identities are preserved, acceptance paths stay
  within the owned checkout, and a controlled index refresh checks unchanged contents before patch
  restoration. Several fixture assertions also confused embedded integrity with installed signer
  policy; those expectations were corrected. No failing behavior was accepted to make a fixture pass.
- The first isolated Python image lacked hash-verified uv cache entries. The network-disabled
  verifier refused setup. Explicit image preparation with locked synchronization fixed the cache;
  candidate network access stayed disabled.
- A local emulation of the Action could not find Docker Desktop with a fresh HOME. It was a setup
  failure, not a GitHub workflow observation. The actual post-push workflow is required separately.

All retained failed attempts have log digests in the manifest. The original edit declarations
and detailed intermediate observations are preserved in [execution.md](execution.md).

## Live provider observations

Deterministic fixture providers test controller branches and the real ordinary-worker npm upgrade;
they do not establish commercial-model performance. A real local Ollama run of Gemma e2b explicitly
escalated once to Gemma 31b and still failed: 47,417 reported tokens, 11 steps, exit 1, objective
rejected. Its 167-record bundle is session `20260927T062434-8108c8`. That pre-final observation is
preserved, not promoted to final-source model success. The final packed-source observation is
recorded separately in the manifest: session `20260927T065327-552f3c`, 158 records, 37,610
reported tokens, 10 steps, 42.39 seconds, exit 1 and task rejected. It made two recorded e2b calls
and eight 31b calls, with exactly one intent/completed escalation pair. The bundle's embedded
verifier exited 0. That validates the recorded control path, not a successful model fix.
No cloud purchase or implicit local-to-cloud routing occurred.

## Distribution and remaining assurance limits

Root 14.2.0 and standalone 0.2.0 are built, packed and installation-tested source packages.
Branch publication and a mismatched verifier tag were both refused by the release validator
(exit 1 as expected). Publishing workflows require their matching release tags and support
provenance. No npm publication, tag or Marketplace listing was performed.

The support matrix is in [the guide](../../../broad-use.md). Host execution is restricted, not
isolated. Private PR object fetching currently requires a separately authorized local checkout;
branch mode works there. Symlinks, submodules and quoted/whitespace patch paths are explicitly
refused. Existing-venv verification refuses unsafe editable path injection. Pip-only projects
cannot assert a reproducible dependency upgrade. Browser tooling is optional and installed
explicitly. Fixtures are neither a new-user study nor a population false-green estimate; prior
research campaigns and their open evidence bars remain unchanged.

## Default-branch delivery

Source was delivered to `origin/v13-main` at `800cac0b783fdb663ac758bd9c5640d3cd0504f4`, and
`git ls-remote` confirmed that exact default-branch SHA. The delivery commit separately passed
local full gates: 375 files and 3613 tests, 148.74s, no skipped tests. Source, command and full-log
digests are in the manifest. The implementation tarball matrix remains bound to its recorded
`e9f680a7b72e48bef57551099c1ffe6db4269273` source; intervening delivery changes were documentation.

- [Gates workflow](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36301722988):
  Ubuntu and macOS full gates/fuzz builds passed; Node 22 and Node 24 installed-package jobs passed.
- [Action controls](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36301723063):
  both trusted controls passed. The good candidate returned verifier status 0/task accepted; the
  bad candidate returned status 1/task rejected while its regression still passed. Both measured
  isolated execution and retained complete summary, JSON and signed-bundle artifacts. Downloaded
  bundles independently verified with exit 0; report and summary digests are in the manifest.
- [Pages workflow](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36301723017) passed.

The exact remote test outputs were:

```text
Ubuntu: Test Files 375 passed (375); Tests 3613 passed (3613); Duration 245.33s
macOS:  Test Files 373 passed | 2 skipped (375)
        Tests 3596 passed | 17 skipped (3613); Duration 535.35s
```

The macOS skips were the existing Docker-capability conditions: nine container-backend tests,
three isolated-shell tests, three isolated-gates tests, one independent-verification test and
one new checkout-restoration integration test. Docker was unavailable on that runner. These
cases executed in the Docker-equipped local and Ubuntu runs; the isolated Python, HTTP and
browser matrices also executed locally. The macOS skip count is not reported as a passing
isolation measurement. GitHub also emitted nonblocking action-runtime deprecation annotations.
A targeted Biome invocation on the evidence JSON processed no files because evidence is excluded
by the existing configuration; the full configured lint passed and the JSON was parsed normally.

GitHub accepted the ordinary fast-forward push through the repository's existing owner-role
exception and printed `Bypassed rule violations: Cannot update this protected ref`. The ruleset
was not changed, and no force push or admin merge override was invoked. This platform message is
preserved explicitly rather than described as an unprotected push.

This is a reporting-only follow-up to those observed results. The final handoff checks the
reporting commit's remote SHA and CI again; it does not pretend that a later commit ran earlier.
Package publication remains unperformed. The original checkout's two untracked artifacts remain
untouched. No historical research evidence or agent policy was rewritten.
