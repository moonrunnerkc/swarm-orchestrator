# September 27 upgrade audit corrections

Baseline: `a6a83eeb9201957d505824b135f0bc9c83ee9944`.
Status: corrective source delivered and remote checks passed. Publication is independently
recorded with the GitHub release; source delivery alone does not establish publication.
The user audit is `/Users/brad/Downloads/Swarm_Orchestrator_Upgrade_Audit.md`.
No previous campaign or evidence bytes are rewritten.

## Findings

- UG-01/09/12/17: candidate configuration can forge Playwright JSON before tests run.
- UG-05/07: package selection removes unavailable language checks.
- UG-19/20/21: nightly run 36304069339 failed with 3612 passed tests and one failure
  because Chromium was absent; later proof steps did not run. Issue notification also
  failed because `ci` was not a repository label.
- The previous owner-role protected-branch exception violated the requested no-bypass
  delivery constraint. Current ruleset 15229475 blocks every branch update and creation.
  The user subsequently explicitly authorized owner bypass as the delivery route, without
  requiring a ruleset change. That later authorization applies to this corrective delivery.

## Intended edits, declared before implementation

`docs/upgrade-completion.md`, this file, `src/gates/behavior-check.ts`,
`src/gates/browser-results.ts`, `src/evidence/behavior-check.ts`,
`src/evidence/verifier/behavior.mjs`, `src/gates/browser-check.integration.test.ts`,
`src/gates/browser-results.test.ts`, `src/gates/browser-trust.integration.test.ts`,
`src/gates/browser-instrument.ts`, `src/gates/browser-instrument-runner.mjs`,
`src/gates/goal-acceptance.ts`, `src/gates/gate-definition.ts`,
`src/gates/node-command-runner.ts`, `src/exec/execution-mode.ts`,
`src/exec/container-backend.ts`, `src/gates/package-scope.ts`,
`src/gates/package-scope.test.ts`, `.github/workflows/nightly-proof.yml`,
`scripts/nightly-proof.test.mjs`, `scripts/build-dist.test.mjs`,
`scripts/validate-browser-cli.mjs`, `scripts/validate-browser-container.mjs`,
`docs/broad-use.md`, `docs/security-coverage.md`, `CHANGELOG.md`.
Amendments will name additional files before editing them.

## Edit amendments

Amendment 1, before edits: `src/evidence/bundle.ts` strips the new independent
reader's builtin crypto import when embedding it. `src/evidence/browser-execution.ts`
validates persisted browser provenance. `src/evidence/verifier/behavior.d.mts` retains
its public unknown-input boundary if needed.

Amendment 2, before edits: `src/gates/browser-instrument.integration.test.ts`,
`.github/workflows/gates.yml`, `.github/workflows/publish.yml`,
`.github/workflows/publish-verify.yml` prepare the pinned browser image before Linux gates.
`src/gates/package-assessment.integration.test.ts` checks package omissions through recorded
seals and assessments. `src/gates/behavior-artifacts.ts` is included if diagnostic retention
needs adjustment for protected instrument paths.

Amendment 3, before edits: `src/gates/gate-command.ts` and
`src/gates/independent-verification.ts`. The final verifier also discarded inspection-backed
unavailable checks. Preserve their typed unavailable reason through final assessment,
in addition to package assembly. Existing verdict rules remain unchanged.

Amendment 4, before edits: `src/gates/node-gates.ts`, `src/gates/python-gates.ts`,
`src/evidence/verifier/status.mjs`, `src/evidence/verifier/status.test.ts`.
The first full run exposed an overbroad change: 45 tests failed because merely absent optional
static tooling was newly treated as a required executable check. The documented existing
policy (verify-only guide, mechanical unmeasured example) separates absent optional tools from
configured checks that cannot run. Preserve that distinction as typed gate data; retain every
unavailable observation in reports. Missing selected-package tests and setup failures remain
required and unmeasured. Configured blocking checks keep their severity and verdict rules.

Amendment 5, before edits: use the existing `src/evidence/verifier/status.test.ts` for
captured-regression cases instead of creating a duplicate test module. Extract final check
execution into `src/gates/independent-checks.ts` from the large independent verifier.
`src/gates/gate-set-seal.ts` includes the optional-absence declaration in newly sealed criteria.

Amendment 6, before edits: `README.md`, `docs/cli.md`, `docs/using.md`,
`docs/verifying.md`, `docs/verify-only.md`, and `packages/swarm-verify/README.md` add
concise links and migration notes for the corrected browser boundary and retained unknowns.

Amendment 7, before reporting edits: `docs/evidence/2026-09-27/upgrade-audit-observations.json`
will index retained logs, exact tested source, installed fixtures and external delivery state.
Update this report, `docs/upgrade-completion.md` and the already-declared `docs/broad-use.md`
with final local results and the unsupported candidate-server boundary. These are reporting-only
edits after executable commit `981f7ff0e612a2caf1434b46a14c7659885d86c5`.

## Corrected behavior

Browser acceptance now uses a sealed instrument, fixed test identities and image-owned
Playwright and Chromium, with generated configuration outside candidate write access. Candidate
Node imports are refused. Both runtime and independently implemented offline readers require
captured boundary provenance and the complete check digest. Project-controlled `argv` results
remain explicitly unjudged. The audit's exact forged valid JSON was emitted by the real CLI
with exit zero, and both installed packages refused to certify it. The passing isolated click
fixture passes; changing its behavior fails the same assertion and retains diagnostic artifacts.
See [browser usage and limitations](broad-use.md#acceptance-instruments).

Package assembly and final assessment now retain every unavailable check with its qualified
identity in seals, JSON and Markdown. Missing selected-package tests or configured tools leave
regression unmeasured. Merely absent optional static tools remain named nonpassing observations
under the existing optional-tool policy. A successful behavior check cannot certify the larger
partially checked change. Ambiguous package overrides of repository inspections are refused.

Nightly proof provisions Chromium before gates. Linux gate and publishing workflows build the
pinned browser fixture image. Failure notification no longer depends on the optional `ci` label.
These workflow changes have static regression coverage and the corrected remote nightly
completed gates, fuzz and both proof arms. Publication triggers were not broadened.

## Initial clean-source validation

Tested source: `981f7ff0e612a2caf1434b46a14c7659885d86c5`, clean worktree at execution.
This is the first complete local correction run. The later CI fixture timing correction and
its separate source-bound validation are recorded below.
The [observation index](evidence/2026-09-27/upgrade-audit-observations.json) records exact
commands, exit statuses, environment, source identity, tarball digests and retained log digests.
Raw logs and the two additional installed-CLI reproduction scripts are owner-only under
`~/.swarm/upgrade-validation/audit-evidence-qwjsubo4/`; fixture evidence stays under the recorded
owned validation directories. Historical campaign bytes are unchanged.

Full gate output for that source, verbatim:

```text
 Test Files  379 passed (379)
      Tests  3625 passed (3625)
   Start at  10:19:19
   Duration  148.86s (transform 11.97s, setup 0ms, import 28.81s, tests 1147.31s, environment 18ms)
```

`npm run gates` exited 0 with no skipped tests. It includes history, policy drift,
documentation paths, weight/headroom, archived/cited bundles, CI verdict checks, typecheck,
lint and the full suite. Lint and SDK warnings are preserved in the raw log.
Each following command separately exited 0:

- `npm run build`
- `npm run build:verify`
- `npm run check:packaged`
- `npm run fuzz:build`
- `node scripts/prove-bundle.mjs docs/evidence/2026-08-18/live-frontier`

The historical reference bundle returned 0; its one-byte-tampered copy returned 1, naming the
broken link. Neither historical bundle nor experiment evidence was rewritten.

Tarballs from that source were installed in clean directories without model credentials. Each validation
script exited 0 after checking the expected positive and negative command statuses:

| Installed validation | Observations | Evidence directory suffix |
| --- | --- | --- |
| Both CLIs: patch/branch, CLI/API, npm/pnpm/uv upgrades and tampering | 24 | `matrix-cd7txl` |
| Both CLIs: sealed Chromium passing/failing interaction and offline verification | 14 | `browser-cli-LRFk5B` |
| Both CLIs: mixed selected packages and existing Python environment | 24 | `selected-OQwuOV` |
| Both CLIs: empty and lint-only units alongside passing tests | 9 | `audit-missing-8ae1aW` |
| Both CLIs: real candidate configuration emits forged JSON before failing test | 9 | `audit-forgery-fLeGVp` |

These are separate observation counts, including setup and expected refusals, not an additive
test total. Missing-check and forgery controls require CLI exit 1. The forged report's offline
reader exits 0 because it agrees with the recorded **unjudged** task, not because the task passed.
The retained scripts assert these distinctions and examine captured process output.

The environment used Node 24.15.0, npm 11.12.1, pnpm 9.15.0, uv 0.11.13, host Python 3.14.7,
Playwright 1.63.0 and Docker client 29.7.2. The immutable browser image ID is in the index.
Container integration ran locally; no isolation-dependent browser test was skipped.
No new provider task was attempted in this correction. Prior local-model escalation remains
an observed rejected task, not a provider success claim.

## Failed attempts and limits

The original nightly failure, reproduced browser false acceptance and unavailable-check
omission are retained. Intermediate repairs exposed missing diagnostic artifacts, an incomplete
module hook, optional-tool policy regressions and asset ordering. Those failures led to fixes;
the index records each failed run rather than combining reruns into a passing total.

An earlier full gate run also encountered a transient Git worktree `commondir` read failure
before model dispatch: 378 files passed and one failed, with 3623 tests passed and one failed.
The isolated two-test rerun passed. No production exception or disabled assertion was added.
The final clean-source run above passed. An overlapping-edit run is explicitly diagnostic only.

Sealed tests are trusted authored acceptance code, not independent proof of test sufficiency.
Client-side subjects and trusted static-fixture setup are supported. Starting candidate
executables inside the assertion container is unsupported because it shares the instrument's
process boundary. Legacy project-runner results remain unjudged. Signatures still establish
integrity within stated trust assumptions, not machine trust or correctness by themselves.

## Delivery and release authorization

Origin and the current default were rechecked as
`https://github.com/moonrunnerkc/swarm-orchestrator`, `v13-main`, at
`a6a83eeb9201957d505824b135f0bc9c83ee9944` before delivery.
[Ruleset 15229475](https://github.com/moonrunnerkc/swarm-orchestrator/rules/15229475)
restricts all branch creation and updates and offers this account an owner-role bypass.
The earlier no-bypass instruction initially blocked delivery. The user then explicitly
instructed: "you can use owner bypass. this should be the only delivery route., adjust ruleset
if needed." This permits the corrective push through that existing route. No ruleset change
is needed or intended. This authorization does not retroactively authorize the prior delivery.
The original workspace and its two unrelated untracked evidence files remain preserved.

The local branch is `fix/upgrade-audit`. Corrective source
`95891957987ec758f58a81ebb800933439f252de` was pushed to `origin/v13-main` through the
explicitly authorized owner bypass. The ruleset was unchanged. Its complete remote results
are recorded below. Later edits to this report, the consumer Action pin and the publication
wording are documentation-only; their own commit checks remain visible in GitHub.

Root 14.2.0 and standalone 0.2.0 are built, packed and installation-tested. The user separately
authorized "GitHub release and npm publication." Publication uses the existing version-tag
workflows with provenance. The [GitHub releases](https://github.com/moonrunnerkc/swarm-orchestrator/releases)
record the actual tag, registry-install results and final delivery identity separately from
this source validation record. At the pre-tag observation, latest was `v14.1.0` and the standalone
registry query returned E404. Those observations are historical, not a continuing availability claim.

Amendment 8, before release preparation: update the already-declared `CHANGELOG.md`
to date the authorized 14.2.0 source release and correct the standalone version in its entry.
Later reporting updates will record actual remote CI and publication without rewriting
prior campaign evidence. User authorization now includes both npm packages and latest GitHub release.

Amendment 9, before CI corrective edits: the already-declared
`src/gates/browser-check.integration.test.ts` needs a bounded browser startup allowance.
macOS run 36333966390 rejected its good fixture after the three-second Playwright test budget;
the prior identical executable source passed. Use a 15-second fixture test budget and a
30-second process deadline, retaining the 300 ms wrong-output assertion and 500 ms hang control.
The paired integration case receives 65 seconds for its two bounded processes. No production
check timeout, assertion, skip or retry policy changes. Preserve the failed run and rerun gates.

Amendment 10, before final documentation edits: add `docs/examples/swarm-verification.yml`
to the declared set and update its Action pin, together with `docs/broad-use.md`, to the
corrected source `95891957987ec758f58a81ebb800933439f252de`. Keep the source installation
path in the already-declared verify-only guide and make publication status refer to release
evidence, rather than leaving an unqualified pre-publication assertion in released docs.

## Final source correction and remote proof

Release preparation run [36333966390](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36333966390)
failed on macOS: one test failed, 3606 passed and 18 were skipped. The known-good browser fixture
exceeded its three-second Playwright test budget. The preceding identical production source
passed. This failure was retained, then the fixture received a bounded 15-second allowance and
30-second process deadline. Its 300 ms wrong-output assertion and 500 ms hanging-command control
remain unchanged. No production timeout, assertion, retry or skip policy was weakened.

The corrective commit is `95891957987ec758f58a81ebb800933439f252de`. On this exact clean source,
the targeted real-browser suite passed three tests, then each of `npm run gates`, `npm run build`,
`npm run build:verify`, `npm run check:packaged` and `npm run fuzz:build` exited 0. The full gate
output for this separate run was:

```text
 Test Files  379 passed (379)
      Tests  3625 passed (3625)
   Start at  10:50:00
   Duration  148.06s (transform 11.38s, setup 0ms, import 28.56s, tests 1139.47s, environment 19ms)
```

A byte comparison found all 767 rebuilt full-package distribution files and all 308 standalone
files identical to the installed tarballs used for the earlier integration matrix. The later
change is fixture timing, not runtime behavior. The index records both source identities rather
than relabeling the earlier matrix as a new execution.

Exact-commit remote outcomes:

| Run | Result |
| --- | --- |
| [Gates 36334859453](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36334859453) | Ubuntu: 379 files, 3625 tests passed. macOS: 376 files, 3607 tests passed; 3 files and 18 tests skipped for unavailable container capability. Node 22 and 24 packaged jobs passed. Both platform fuzz steps passed. |
| [Action controls 36334859477](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36334859477) | Trusted good control confirmed exit 0; trusted bad control confirmed exit 1 and behavioral rejection. Failure evidence retained. |
| [Nightly proof 36334859662](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/36334859662) | 379 files, 3625 tests passed; fuzz passed; reference verifier exited 0 and one-byte tamper exited 1 naming the broken chain; transcript uploaded. |

Linux and local Docker execution measured the capabilities skipped on hosted macOS. A skip is
not a pass. The downloaded earlier corrective Action bundles also independently re-derived
the accepted and rejected outcomes. Installed `verify` returned 1 for both because their
self-generated ephemeral signers remain untrusted, while integrity was valid. An initial review
script incorrectly expected zero; that expectation was corrected, with no signer-policy change.

Source completion and package publication remain distinct facts. The final release evidence
binds its tag, default-branch commit, exact-commit checks, package provenance and registry
installation results. This report does not infer publication from a source push or a green test.
