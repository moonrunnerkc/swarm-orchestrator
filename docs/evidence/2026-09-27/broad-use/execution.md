# Broad-use upgrade completion ledger

Status: in progress. No source delivery or package publication is claimed.

Baseline: `103d3ce4868a7a7fcd74e41adf4626efaa0c2fc0`, preserving local work newer
than remote `43b6c5c764c18a053606185c26366f3f586ee09d`. Isolated worktree:
`/Users/brad/projects/swarm-broad-use`, branch `upgrade/broad-use`.
The original worktree and its two untracked feedback-study artifacts are untouched.
Remote identity: `https://github.com/moonrunnerkc/swarm-orchestrator`; default: `v13-main`.
Full history and `v12-final` present. Tag fetch refused to replace local `v14.0.0`;
local and remote tag identities differ, so neither was rewritten.

## Edit declarations

1. Before implementation: this ledger; `src/cli-ci.ts`, `src/cli-verify-options.ts`,
   `src/cli-command-definitions.ts`; source-resolution and reviewer-report modules
   and adjacent tests under `src/gates` and `src/evidence`; standalone package metadata,
   package validation scripts, Action files and workflows; README, CLI/using/verification/
   verify-only guides, package README, changelog and build/security documentation.
   Additional concrete files will be declared before editing.

## Requirements

| ID | Production implementation | Verification/evidence | Status |
| --- | --- | --- | --- |
| UG-01 | Existing ledger, seals, ratchets and independent verifier retained | Baseline full gates passed; current full run has three test expectation failures | Open |
| UG-02 | Shared-source prepack and tag-only verifier publication workflow | Clean packed CLI installs exercised; no registry publication | Open |
| UG-03 | Shared patch/branch/PR resolver pins immutable objects | Dirty-workspace, binary and hostile-input tests; real PR 73 retrieval recorded | Open |
| UG-04 | Trusted composite Action with container requirement and retained status | Local and post-push Action exercise still pending | Open |
| UG-05 | Versioned CI JSON and escaped Markdown projection | Summary escaping tests; detailed requirement presentation still being completed | Open |
| UG-06 | Manifest/lock/environment detection and non-installing initialization | Real uv 0.11.13, existing venv and pnpm 9.15.0 commands passed controls | Open |
| UG-07 | Explicit repeated package selection and outside-scope refusal | Mixed-unit assembly tests; packed mixed-project matrix pending | Open |
| UG-08 | Native reports plus typed Vitest/pytest outcome readers | Real positive/negative runner controls; advanced authority remains unmeasured | Open |
| UG-09 | Behavior definitions extend sealed goal contracts | Goal and independent bundle tests; read-only acceptance mounts added | Open |
| UG-10 | Argument-vector CLI checks with finite input and bounded streams | Real stdin, wrong exit/output, timeout, missing executable and cancellation tests | Open |
| UG-11 | Owned local HTTP service and bounded response assertions | Real correct/wrong response, redirect refusal and cleanup tests | Open |
| UG-12 | Optional project Playwright command and individual result validation | Real Chromium good/bad interaction; zero tests and startup failure controls | Open |
| UG-13 | Deterministic failure classification and repeated signatures | Pure policy and repair tests; engine escalation regression under investigation | Open |
| UG-14 | Explicit alternate model, one escalation, budget reserves | Policy tests pass; complete worker switch test not yet passing | Open |
| UG-15 | Escalation/check intent records and reconciliation guards | Container cleanup/recovery and unanswered-check intent tests | Open |
| UG-16 | Bugfix base-output control and final candidate acceptance | Packed patch/branch reproducer fixture passed; independent goal derivation agrees | Open |
| UG-17 | Pinned base/candidate goal checks for refactors | Production path present; real refactor matrix pending | Open |
| UG-18 | Narrow dependency manifest validation and locked preparation | Tampered scripts/metadata rejected in tests; npm/pnpm/uv upgrade matrix pending | Open |
| UG-19 | Packed fixture and real toolchain validation scripts | Current matrix incomplete; no complete support claim | Open |
| UG-20 | Package install documentation and this ledger | User guides, walkthroughs and support matrix still being completed | Open |
| UG-21 | Isolated branch and coherent local commits | Nothing pushed; final local and remote verification pending | Open |

## Observations

- Clean `npm ci`: exit 0, 217 packages added, zero reported vulnerabilities.
- Node 24.15.0; Docker server 29.5.2; GitHub authenticated as moonrunnerkc.
- Baseline command logs are retained outside the repository under
  `/tmp/swarm-upgrade-evidence`; results will be recorded after commands finish.

Amendment 2 (before edits): `src/swarm-verify.test.ts` for changed shared parser diagnostics;
`src/evidence/ci-summary.ts` and its adjacent test, and the existing CLI reporting composition for reporting.
Baseline gates exit 0: 356 test files passed, 3520 tests passed, duration 135.89s.
Baseline build, build:verify, check:packaged and fuzz:build exited 0. Source-input targeted
run initially failed one legacy help-diagnostic assertion (99 passed); retained in
`/tmp/swarm-upgrade-evidence/source-tests.log`. No product verdict failed in that run.

## Source-input increment

Implementation: `src/gates/change-source.ts`, `src/gates/github-source.ts`, shared
`src/cli-verify-options.ts` and `src/cli-ci.ts`. Source IDs, actual comparison base and
patch digest are recorded before verification. Local source tests cover binary diffs,
dirty index/worktree preservation, exact versus merge-base comparison, hostile refs,
unsupported special entries and pinned PR transport behavior. The PR transport test
is deterministic and is not evidence of a remote GitHub run.

Reporting: `src/evidence/ci-summary.ts`, `--summary`, additive JSON source/evidence IDs.
Standalone distribution: prepack builds the shared-source closure; verifier publication
has a separate matching-tag interlock. No packages were published.

Amendment 3 (before edits): `src/gates/project-type.ts`, `src/gates/project-environment.ts`
and adjacent tests; `src/config/init.ts`, `src/cli-init.ts`, `src/cli-options.ts`,
`src/gates/default-gates.ts`, `src/gates/dependency-install.ts` and adjacent tests for
manager/interpreter selection and lock-preserving setup. Package scope integration will
amend the gate assembly separately. First source increment: `a05080011`; targeted run
`source-tests-5.log`: 5 files, 100 tests passed, exit 0.

Amendment 4 (before edits): package selection in `src/gates/package-scope.ts` and
adjacent tests, `src/gates/engine.ts`, `src/gates/independent-verification.ts`,
`src/cli-gates.ts`, and the shared CLI parser. Selection remains repository-relative;
`--workspace` continues to identify the repository. Scoped coverage without a controlled
runner stays explicitly unmeasured.

Amendment 5: `src/config/package-discovery.ts` and its tests for bounded workspace
manifest discovery, plus package selection in `src/config/init.ts` and `src/cli-init.ts`.

Amendment 6 (before edits): typed behavior checks in `src/evidence/behavior-check.ts`,
`src/gates/behavior-check.ts`, adjacent tests, `src/evidence/goal-contract.ts`,
`src/gates/goal-acceptance.ts`, and the independent bundled verifier rules. Finite stdin
and output bounds flow through `src/gates/gate-definition.ts`,
`src/gates/node-command-runner.ts`, `src/exec/run-process.ts`,
`src/exec/execution-mode.ts`, and `src/exec/container-backend.ts`.

Amendment 7: `src/evidence/bundle.ts` embeds the additional independent behavior rule
in the existing dependency-free verifier; `src/cli-ci.ts` and the shared parser expose
ordinary sealed goal contracts to verification-only callers. Historical bundles remain
unchanged. Browser instruments still require real integration and adversarial validation.

Amendment 8 (before dependency installation): root `package.json` and `package-lock.json`
add pinned development-only Playwright for real browser acceptance fixtures. This dependency
is necessary to test the advertised browser adapter; it remains outside the standalone
runtime package closure and does not install browsers for consumers automatically.

Amendment 9 (before edits): `src/gates/repair-policy.ts`, `src/agent-escalation.ts`,
adjacent tests, `src/agent-run.ts`, `src/gates/auto-resolve.ts`, `src/evidence/run-spec.ts`,
`src/durable/recovery-context.ts`, `src/cli.ts`, and `src/cli-options.ts` for explicit,
once-per-task escalation under the original budget and recoverable intent records.

Amendment 10: `.github/workflows/gates.yml` explicitly prepares the pinned development
browser before the full suite. Browser installation remains a development/CI action,
not an implicit consumer verification effect.

Amendment 11 (before edits): preset policy in `src/evidence/task-preset.ts`,
`src/gates/upgrade-contract.ts`, `src/gates/preset-verification.ts`, adjacent tests,
and existing goal/independent verification composition. Presets reuse the sealed goal
contract and the existing worker loop; they do not create another solver or acceptance DSL.

Amendment 12: normal task CLI composition accepts `--preset` with the existing
`--goal-contract` acceptance material, preserves that material before model dispatch,
and performs final independent verification through the same engine as `ci`.

Amendment 13: `src/gates/behavior-artifacts.ts` retains bounded Playwright trace and
screenshot observations before owned-checkout cleanup. They remain diagnostic artifacts,
not acceptance verdicts, and every retained byte has a digest.

Amendment 14: `scripts/build-dist.test.mjs` updates the explicit asset inventory for
new runtime scripts; package scope assembly retains all existing root inspection gates.
The current full-suite runs are diagnostic because source changed while they ran; they
will not be cited as final-tree evidence.

Amendment 15: `src/gates/runner-results.ts`, `src/gates/structured-runner.ts` and adjacent
tests add bounded Vitest/pytest result readers. `src/gates/parsers.ts` and the independent
re-deriver recognize their structured results without granting coverage, assertion counts,
or test-deletion exemptions. Original native-runner controls remain intact.

Amendment 16: `scripts/validate-upgrade-fixtures.mjs` executes real toolchain and packed
CLI controls and writes bounded results outside the repository. Fixture output is not a
new-user study or evidence about provider performance.

Amendment 17 (before edits): `src/gates/browser-results.ts` and adjacent tests validate individual Playwright results, duplicates, and totals. Existing browser rules retain independent derivation. `src/gates/project-type.test.ts` updates supported runner expectations while retaining unsupported-command controls.

Installed CLI fixture run: `/Users/brad/.swarm/upgrade-validation/matrix-M42ieB/results.json`, 19 subprocess observations, exit 0. Both packed CLIs accepted the genuine failing-base/passing-candidate bugfix through patch and branch input; a wrong-behavior candidate was rejected. This is host execution evidence, not isolation evidence.

Amendment 18: `src/evidence/verifier/behavior.d.mts` declares the independent runtime rule for strict TypeScript callers. `scripts/validate-toolchains.mjs` records real pinned toolchain runs outside Git.

Amendment 19 (before edits): controlled command options and the existing container backend
carry read-only acceptance files. New behavior adapters require that capability when a
check supplies files, with an explicit unavailable result on the host. Container regression
tests exercise replacement attempts. Legacy non-behavior contracts retain their semantics.

Amendment 20 (before edits): `src/gates/goal-effects.ts` and adjacent tests reject unanswered
check intents during recovery. The existing goal executor preserves ambiguous owned
checkouts for reconciliation instead of restoring or deleting them while effects are unknown.
The HTTP runner refuses an already occupied local port before starting a service.

Amendment 21 (before edits): gate parser schemas and `src/config/swarm-toml.ts` name
`structured-test-output` explicitly. Supported structured runners never fall back to an
exit-only or text-summary verdict when their JSON is malformed or prefixed with forged output.

Amendment 22: `src/workers/controller-configuration.ts`, `src/gates/gate-runner.ts`, and
`src/evidence/verifier/rederive.d.mts` validate the same additive structured parser identity
at their existing persisted boundaries.

Amendment 23 (before edits): `src/cli-verification-evidence.ts` owns verifier session
export, including retrieval and contract failures before candidate execution. The full and
standalone CLIs continue to share that path.

Incremental gates run 4: `npm run gates`, exit 1; 3 tests failed and 3579 passed (3582), 138.09s. Source HEAD `49e9c9728cd13a3c2d04b07bcb748a92df7d769e`, executable/package diff SHA-256 `d3c47f4898047777f9837b433db863f953c9fe8f03ba1a144de009bc36be0504`. Actual output: `/tmp/swarm-upgrade-evidence/gates-incremental-4.log`. Failures: old Vitest coverage/parser expectations and the newly added runtime declaration asset inventory.

Amendment 24: `src/gates/default-gates.test.ts` and `src/gates/gate-overrides.test.ts` name the new structured parser and its explicit coverage limitation. The build inventory includes the independent behavior declaration.

Amendment 25 (before edits): `src/agent-run.test.ts` exercises an actual worker repair
cycle and one alternate fake provider through the existing engine; recovery tests validate
interrupted escalation state independently from optional live model observations.

Real runner matrix: `/Users/brad/.swarm/upgrade-validation/toolchains-mbMkFG/observations.json`, 13 observations, exit 0. Positive and deliberately wrong assertions executed with uv/pytest, an existing venv and pnpm/Vitest. This does not establish packed initialization or mixed-package verification.

Adapter regression run: 9 files, 80 tests passed, exit 0 (`adapters-tests-current.log`). Source/repair targeted run: 6 files, 128 tests passed, exit 0 (`source-repair-tests-current.log`). Full-run expectation corrections: 3 files, 15 tests passed (`gates-corrections.log`). These are separate runs, not one passing total.

Amendment 26 (before edits): `src/gates/goal-checkout.ts` restores snapshots while preserving
existing directory identities, and `src/gates/goal-checkout.integration.test.ts` reproduces
container visibility across restoration. Real failing control: host Git could read HEAD but
the next Docker command saw removed directory entries (`container-preset-debug-2.log`).
Escalation event names now avoid credential-shaped budget keys without changing scrubbing.

Amendment 27 (before edits): `src/gates/prepared-python.ts` and adjacent tests stage a
bounded copy of an explicitly existing project `.venv` into the owned verification checkout.
This preserves the user's environment, installs nothing, and refuses editable path injection.
The existing independent verifier invokes it before checks when installation was not requested.

Amendment 28 (before edits): behavior definitions may declare bounded locale, timezone and
Playwright browser-location variables. The container backend carries only those explicitly
supported additions through the shared child-environment validator. Existing unsupported
measurement overlays still refuse rather than being silently dropped.

Amendment 29 (before edits): `scripts/validate-browser-container.mjs` runs the same pinned
interaction against correct and broken application source in the measured container backend,
retaining diagnostic artifacts. Container artifact paths map only into the owned checkout.

Amendment 30 (before edits): `src/evidence/run-assessment.ts`, `src/evidence/verdict.ts`,
the independent bundle verifier and adjacent tests bind final preset acceptance to the prior
worker assessment and the exact independently checked patch. The live local trial exposed an
attestation mismatch when the CLI changed its display verdict without recording that projection.
The failed trial remains preserved and is not counted as a successful model observation.

Amendment 31 (before edits): `scripts/fixtures/browser.Dockerfile` prepares a development
browser image from the already measured Node backend image, with pinned Playwright 1.63.0.
The official Noble image reports contradictory ownership for the mounted root through its
Git/stat path on this Docker Desktop host; no Git safety exception or privileged candidate
execution is introduced to bypass that refusal.

Amendment 32 (before edits): `src/exec/isolation-option.ts` and adjacent tests reject image
strings that could be parsed as container options. The backend validates the same boundary
before constructing argv; the Action cannot turn an image input into a runtime privilege flag.

Amendment 33 (before edits): `src/exec/container-image.ts` shares image validation between
option parsing and dispatch. Preset schema and upgrade tests require matching manager,
manifest and lockfile identities and unique dependency authorizations. Prepared Python
staging verifies the copied inventory before recording completion.

Amendment 34 (before edits): initialization and runner assembly use the same structured
commands, including configured pytest. Vitest resolves the installed runner from the selected
package so ordinary hoisted workspace installations work. Adjacent initialization and real
selected-package fixtures cover the generated configuration instead of relying on defaults.

Amendment 35 (before edits): `src/cli-ci.ts`, summary projection and adjacent tests add
changed-path and goal-obligation findings with assessment evidence references. The Action
accepts an external sealed goal contract. `.github/workflows/action-controls.yml` and
`scripts/action-fixture.mjs` exercise correct and broken candidates from separately checked
trusted source, with a trusted assertion of the failing verifier status.

Amendment 36 (before edits): `src/gates/upgrade-resolution.ts` records installed dependency
versions together with manifest and lock digests after locked preparation, refusing mismatched
resolutions. The independent verification path calls this before behavioral acceptance.
`scripts/validate-presets.mjs` exercises npm, pnpm and uv upgrades plus manifest tampering
through real CLI subprocesses, and retains each attempted result outside the repository.

Amendment 37 (before edits): `src/cli-task-goal.ts` owns normal-task preset preflight and
final verification through the existing independent engine. It establishes base controls
before model spending, records setup failures, and preserves an original deadline with time
reserved for final verification. The CLI delegates this responsibility rather than duplicating
verification and assessment logic.

Amendment 38 (before edits): durable recovery carries the sealed goal contract and original
install authorization into normal-task continuation. Missing or contradictory goal settings
and unresolved environment staging refuse replay. Recovery tests preserve these boundaries.

Amendment 39 (before edits): `docs/broad-use.md` centralizes the source-upgrade walkthroughs
and capability limits. README, CLI, using, verifying, verify-only, build, security coverage,
package README and changelog link the same implemented interfaces. No registry availability,
new-user study or production superiority claim follows from these fixtures.

Current separate observations:
- Final worker assessment and attestation regression: 2 files, 37 tests passed
  (`final-assessment-full.log`).
- Prepared environment, initialization and manifest checks: 5 files, 28 tests passed
  (`setup-refinements.log`).
- Browser/report/CLI adapter targeted run: 4 files, 18 tests passed
  (`report-browser-tests.log`).
- Real runner matrix after hoisted-runner resolution: 13 observations, exit 0,
  `/Users/brad/.swarm/upgrade-validation/toolchains-iYqzh6`.
- Real isolated Chromium fixture: correct application accepted, wrong button value rejected,
  PNG and ZIP retained, `/Users/brad/.swarm/upgrade-validation/browser-iPq5Cx/results.json`.
  Earlier attempts failed checkout ownership or artifact mapping; none counted as a browser pass.
- npm/pnpm/uv upgrade controls: 33 observations, exit 0,
  `/Users/brad/.swarm/upgrade-validation/presets-XFnFhN/observations.json`.
  The first attempt requested nonexistent `is-number@7.0.1`; a second exposed an incorrect
  fixture expectation for the existing CLI error exit code. Both failed logs are preserved.
- Preset recovery: 4 files, 24 tests passed (`preset-recovery-tests-2.log`). The first run
  exposed a record-rule name matching a known credential pattern; the rule was renamed,
  preserving the scrubber and failed evidence.
- Genuine versus vacuous base reproducer: 1 real subprocess test passed
  (`preset-preflight-tests.log`).

Incremental full gates 5: exit 1; 2 files failed and 368 passed (370), 3 tests failed
and 3593 passed (3596), 138.20s. These were old command-shape expectations in
`project-type.test.ts` and `project-environment.test.ts` after structured initialization
and hoisted Vitest resolution. Exact source/diff identity is in
`/tmp/swarm-upgrade-evidence/gates-incremental-5-source.json`; actual full output is in
`gates-incremental-5.log`. This is not a passing full-gates claim.

Amendment 40 (before edits): those adjacent detection tests now require structured output
and the selected interpreter/installed-runner identity. Existing positive and negative real
runner demonstrations remain separate from these configuration assertions.

Amendment 41 (before edits): `scripts/action-artifacts.mjs` limits retained Action evidence
without rewriting the original ledger. Incomplete retention is reported separately and cannot
leave a successful Action result. Its adjacent subprocess test covers over-limit evidence.

Amendment 42 (before edits): both package publication workflows install the pinned development
browser before their existing full-gates interlock. Tag/version and provenance rules remain in
place; branch pushes still do not publish. CLI help lists the implemented additive flags.

Amendment 43 (before edits): default Node gate assembly includes an existing declared build
script as a blocking check. Upgrade fixtures assert that its result is present; a successful
installation or test-only subset cannot stand in for the declared build.

Amendment 44 (before edits): `src/gates/prepare-dependencies.ts` prepares the selected units'
lock roots, including a shared Node workspace lock and independent Python locks. Initialization
and gate assembly share selected-project environment detection. `scripts/validate-selected.mjs`
checks a mixed pnpm/Vitest and uv/pytest selection, existing-venv verification, refactor controls
and refusal of shared/out-of-scope changes through the real CLI.

Amendment 45 (before edits): the HTTP adapter names redirect refusal before any body
assertion, including contracts that expected a redirect status. Browser setup errors are
classified as unjudged with an installation remedy while raw process failure remains recorded.
Independent behavior derivation and real missing-browser/timeout tests cover these outcomes.

Amendment 46 (before edits): goal verification exposes its recorded per-check statuses,
remedies and evidence digests to the existing report projection. Reviewer summaries link each
behavior finding to its captured record and name setup remedies instead of suggesting missing
criteria when a configured instrument could not run.

Amendment 47 (before edits): upgrade authorization and installed-version records are required
inputs to goal acceptance and independent bundle derivation. `src/evidence/verifier/upgrade.mjs`
provides a dependency-free independent check; bundle assets and known-answer tests include it.
For uv, authorization preserves all manifest bytes except uniquely identified dependency
literals, so formatting or unrelated TOML edits need a separate declared change. Ordinary
pinned dependency edits and locked uv preparation remain supported.

Amendment 48 (before edits): independent checks retain raw observations and parser/severity
identities. A configured blocking check that collected no usable results stays unmeasured even
when another check passed. The shared gate acceptance predicate enforces the same generic rule;
missing optional inspection capabilities remain distinct. Adjacent regression and parser tests
cover the previous partial-suite false green.

Amendment 49 (before edits): `src/evidence/verifier/status.mjs` separates existing independent
status readers from the report CLI and independently derives regression from captured check
observations. Historical records without those observations retain their original policy.
New configured blocking checks must finish with usable passing results to establish regression
pass; an inherited base failure stays named and cannot be hidden by a passing build.

Amendment 50 (before edits): adjacent independent status tests exercise forged regression
summaries, inherited failures and unavailable required checks. Gate capability tests cover a
passing package alongside an unmeasured package. The existing locked-install fixture gains a
real dependency-free npm lockfile; an untouched tree with a configured unusable test command
no longer establishes a passing required check.

Amendment 51 (before edits): the independent re-derivation declaration exposes captured checks.
`src/gates/environment-preflight.ts` and adjacent subprocess tests check declared managers,
interpreters and runner metadata before model calls. `src/agent-run.ts` reuses selected locked
preparation and emits planned gates and missing-tool remedies. Built host/container environments
disable implicit Corepack and Python downloads; explicit dependency preparation stays separate.

Amendment 52 (before edits): the normal task's sealed goal check joins its existing gate
cycle as an explicit acceptance instrument. `src/cli-task-goal.ts`, gate assembly and task
composition reuse independent verification so a failed behavior check reaches bounded repair
instead of being discovered only after the worker exits. Setup refusals stop spending; the
final independent check and assessment remain mandatory. Adjacent engine integration tests
exercise initial regression success with failed required behavior followed by a real repair.

Amendment 53 (before edits): split language-specific command assembly from default gate
composition into `gate-command.ts`, `node-gates.ts` and `python-gates.ts`. This preserves the
existing Go/Rust definitions and parser names while keeping each new module focused and below
300 lines. Existing gate assembly and runner tests cover the move.

Amendment 54 (before edits): Python detection recognizes pytest configuration in TOML,
setup.cfg, pytest.ini and tox.ini, plus explicitly declared tool dependencies. It no longer
assumes pytest for every bare Python manifest. Adjacent project detection tests cover absent
optional tools, configured tools and dependency declarations without running setup.

Amendment 55 (before edits): `scripts/validate-browser-cli.mjs` exercises both installed CLI
entry points against passing and behaviorally broken browser candidates in the prepared isolated
image. `scripts/validate-pr-cli.mjs` compares an actual resolved public PR snapshot with its exact
branch and patch forms, retaining the honest vacuous-oracle result rather than claiming that a
syntax check proves the PR objective. Packed negative controls also assert the rejection reason.

Amendment 56 (before edits): trusted harness artifact preparation recognizes an owned checkout
nested beneath the session directory. The checkout boundary still refuses escape, credential
paths and Git metadata; if evidence is inside a checkout it remains denied. Model/tool policy
is unchanged. A regression test uses the actual session-nested layout, and the browser CLI
fixture preserves the original refusal as its before-fix observation.

Amendment 57 (before edits): environment preflight passes cancellation back to the existing
worker stop path after recording the interrupted probe. It must not relabel cancellation as
a setup exception, which unnecessarily preserved an untouched worker checkout. The existing
real interrupted-parallel cleanup test failed both in full gates and a focused rerun before
this correction; ownership and changed-work preservation rules remain unchanged.

Amendment 58 (before edits): independent checkout restoration captures its failed controlled
Git observation for diagnosis instead of returning only an unexplained false result. The
browser preset fixture exposed a restoration failure after a successful base interaction;
that remains unjudged until the underlying lifecycle issue is fixed.

Amendment 59 (before edits): the captured browser restoration failure is Git's `app.js:
does not match index` after host snapshot restoration changed filesystem metadata. The owned
checkout refreshes its index stat data before reapplying the pinned patch; this checks existing
contents and does not stage changes. Both successful and failing browser preset controls must
then complete through the actual CLIs.

Amendment 60 (before edits): `src/cli-task-contract.ts` constructs validated normal-task
preset contracts and exposes requirement descriptions and exact dependency targets to the
worker without exposing withheld instruments. Upgrade uses file scope, fixing the incompatible
workspace-scope marker on its narrow path list. Recovery reuses the original recorded objective.
Adjacent tests enforce scope and target visibility; no manifest field exemption is broadened.

Amendment 61 (before edits): source package versions advance additively to root 14.2.0 and
standalone 0.2.0, with lock metadata and documented tarball names kept in agreement. This
is versioned source, not a registry publication or release tag. The existing Unreleased
changelog retains unrelated newer work and adds the implemented upgrade.

Amendment 62 (before edits): `scripts/validate-http-cli.mjs` runs real owned HTTP services
through both installed CLIs, with passing and wrong-response controls and post-run port checks.
The existing adapter tests retain redirect, timeout, cancellation and unavailable-server cases.

Amendment 63 (before edits): the language preamble describes pinned check commands instead
of forbidding every manifest edit, so it agrees with narrowly authorized dependency upgrades.
A real worker-loop upgrade test uses a deterministic provider only for edit selection; Git,
locked npm preparation, installed-version observation and acceptance execute as real processes.

Amendment 64 (before edits): the composite Action explicitly selects Node 24 using the
already pinned setup action before building its trusted verifier. Its consumer example pins
the completed Action commit and obtains candidate and acceptance material in separate paths.

Amendment 65 (before edits): `docs/examples/swarm-verification.yml` and `clamp-goal.json`
provide a SHA-pinned consumer workflow and the actual clamp acceptance instrument. The broad-use
guide adds complete contract assembly, HTTP/browser walkthroughs and the Action's trust boundary.

Amendment 66 (before edits): `scripts/fixtures/python.Dockerfile` and
`scripts/validate-python-container.mjs` exercise locked uv/pytest verification with both installed
CLIs in the measured network-disabled container backend. Dependencies are explicitly cached at
image build time, and candidate preparation uses that cache with the declared project interpreter.

Amendment 67 (before edits): `src/gates/change-source.ts` and its adjacent test preserve the
resolved PR target base when an explicit exact comparison base is supplied. Both immutable
identities must remain visible; the override must not relabel the PR target.

Amendment 68 (before edits): `src/evidence/ci-summary.ts` and its adjacent test explicitly
mark each clipped presentation field and link strict-contract obligation findings to the
captured assessment. Full assessment content remains identified by its digest.

Amendment 69 (before edits): `docs/evidence/2026-09-27/broad-use/execution.md` preserves
this working log and every declaration. `report.md` and `observations.json` in that directory
record bounded completion evidence, source identities, failed attempts and artifact digests.
This ledger becomes the concise requirement index; no previous campaign evidence is rewritten.
