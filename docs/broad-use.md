# Broad-use source upgrade

These interfaces are part of the source upgrade. Registry publication is separate. Build and
install the source tarballs using [the verify-only guide](verify-only.md); consult the
[completion ledger](upgrade-completion.md) for exact tested source and delivery status.

## Verify a change from any author

The full and standalone binaries call the same engine. No model or provider key is needed.
Choose exactly one source input:

```sh
swarm-verify ci --workspace ./project --patch ./candidate.patch --base main --json
swarm-verify ci --workspace ./project --branch feature --json --summary review.md
swarm-verify ci --workspace ./project --pr moonrunnerkc/swarm-orchestrator#73 --json
```

Branch mode normally compares the selected head to its merge base with `HEAD`. An explicitly
supplied `--base` selects an exact comparison instead. PR mode resolves the target base and head
once and fetches those immutable objects; a later PR update does not change that run. Reports
retain target base, actual comparison base, head, repository, PR number and complete patch digest.
A dirty index, untracked files and the user's branch stay in place; verification uses an owned
clean checkout. Binary patches, deletions and rename content are included. Symlink/submodule
changes and quoted or whitespace-bearing patch paths are refused by name.

GitHub metadata retrieval uses authenticated `gh`. Object retrieval currently uses credential-free
HTTPS; inaccessible private objects are refused. Retrieval credentials never enter candidate
commands. For private repositories, retrieve the immutable objects separately into an authorized
checkout and use branch mode.

Regression and task acceptance are separate. Add `--goal-contract /trusted/goal.json` for explicit
requirements, or retain the existing strict `--acceptance-contract` and oracle paths. With no task
criteria, passing regression leaves completion unmeasured. `--require-isolation --isolation docker`
refuses a backend that cannot demonstrate its requested boundary. Host execution is restricted,
not a filesystem sandbox. Node 22 retains its named unmeasured coverage outcome.

## Initialize an existing repository

```sh
swarm init --workspace ./project
swarm init --workspace ./monorepo --list-packages
swarm init --workspace ./monorepo --package packages/web --package services/api
swarm-verify ci --workspace ./monorepo --branch feature \
  --package packages/web --package services/api --goal-contract /trusted/goal.json
```

Initialization reads manifests, configured scripts, lockfiles and environment declarations. It
preserves an existing `swarm.toml` and explains that it is unchanged. It does not install
packages, rewrite scripts or download browsers. Conflicting manager declarations need an explicit
project choice. `--workspace` always names the repository; repeated `--package` values name
repository-relative Node or Python units. Go and Rust retain repository-wide behavior.

Node uses declared npm or pnpm. Python uses `uv.lock` with its project interpreter, or an existing
`.venv/bin/python`. Only configured pytest, Ruff and mypy checks are selected. An absent optional
tool is different from a required command that cannot start. An existing Python environment is
copied into the owned checkout, with bounded inventory verification; editable or executable path
injection is refused. Nothing writes back to the user's environment.

Dependency preparation is separate and requires `--install`. npm uses `ci --ignore-scripts`,
pnpm uses `install --frozen-lockfile --ignore-scripts`, and uv uses `sync --locked
--no-install-project`. Network restrictions still apply. A network-disabled container needs a
suitable prepared runtime; installation authorization does not silently loosen its boundary.
Before model spending, the worker prints the planned checks and measures installed manager,
interpreter and configured runner versions. A declared manager-version mismatch stops with a
setup remedy. Implicit Corepack and Python downloads are disabled.
Shared root or out-of-selection changes make the whole change unverified. A passing package
subset never certifies an omitted lockfile or root build change.

## Acceptance instruments

All adapters extend the existing version-1 goal contract. Each check names its requirement,
author (`user` or `model`), exposure, working directory, argv, toolchain, finite limits and
assertions. Generated instruments are labeled `model`; they are not independent ground truth.
Contract files and pinned artifacts belong outside solver write access. Browser acceptance files
require the container backend's read-only mounts. Final checks run on the exact candidate tree.

The CLI instrument in the real clamp fixture is:

```json
{
  "kind": "cli", "cwd": ".", "toolchain": "Node 24", "network": "inherit",
  "timeoutMs": 3000, "maxOutputBytes": 4000,
  "argv": ["node", "--input-type=module", "-e", "import {clamp} from './clamp.mjs';console.log(clamp(-1))"],
  "stdin": "", "exitCode": 0,
  "stdout": [{"kind": "equals", "value": "0\n"}], "stderr": []
}
```

CLI assertions compare captured exit status and bounded streams. Printed claims never override
those comparisons. Missing executables, output truncation, timeout and cancellation retain their
observed outcomes. The process-group runner cleans up owned descendants; host process groups do
not contain arbitrary detached daemons.

HTTP instruments start an explicitly named disposable local service. They declare its argv,
local port, readiness path/deadline and request deadline. Requests support an allowlisted method,
path, bounded body and `accept`/`content-type` headers. Assertions cover status, selected response
headers, text equality/containment and scalar JSON paths. Readiness is separate from acceptance.
Redirects are refused, the runner never discovers production endpoints, and occupied ports refuse
startup. See the actual server fixtures in [behavior-check tests](../src/gates/behavior-check.test.ts).

Browser instruments run the project's pinned `node_modules/@playwright/test/cli.js test
--reporter=json` command, with an expected nonzero test count. Install Playwright and its browsers
explicitly. Individual results and aggregate totals must agree; zero, skipped, flaky, duplicate,
malformed or truncated reports cannot pass. PNG screenshots and ZIP traces are bounded diagnostic
artifacts, never correctness verdicts. The isolated [browser fixture](../scripts/validate-browser-container.mjs)
executes the same sealed click assertion on correct and broken application code.

## Presets on the ordinary worker path

```sh
swarm 'Clamp negative inputs' --workspace ./project --preset bugfix \
  --goal-contract /trusted/bugfix.json --model local:gemma4:e2b-it-q8_0
swarm 'Refactor the parser' --workspace ./project --preset refactor \
  --goal-contract /trusted/refactor.json --model local:gemma4:e2b-it-q8_0
swarm 'Upgrade the named dependency' --workspace ./project --preset upgrade \
  --goal-contract /trusted/upgrade.json --install --model local:gemma4:e2b-it-q8_0
```

Model names are explicit examples from the observed local environment, not recommendations.
Use your configured model. These flags select policies in the existing worker engine.

A bugfix contract includes `"preset":{"kind":"bugfix","reproducer":"negative"}`. Its named
CLI reproducer must finish on base with the expected process exit but wrong asserted output,
then pass on the candidate. Missing tools and compilation failures cannot reproduce the bug.
A refactor contract includes `"preset":{"kind":"refactor"}` and explicit behavior/interface
checks that pass on base and candidate. Unknown behavior remains unknown; ratchets still apply.

An upgrade contract names `kind: upgrade`, manager, matching manifest/lockfile, dependency names,
sections and exact versions, and explicit migration source paths. Only those dependency fields
may change. Test scripts, gate settings and unrelated metadata remain sealed. Locked preparation,
observed installed versions, regression and affected behavior must all succeed. npm, pnpm and uv
have real positive and tampering controls in [the preset fixture](../scripts/validate-presets.mjs).
uv authorization changes only one unique quoted dependency literal per named dependency;
unrelated formatting and metadata edits are refused. Targets are exact versions, not a guess
at latest. Pip-only environments can verify existing behavior but cannot claim a reproducible upgrade.
No preset publishes, deploys or runs production migrations.

## One explicit escalation

Add `--escalate-model MODEL` to authorize one alternate target for repeated observed implementation
failure. The original model pin stays binding without that option. A cloud key alone is not
permission to leave a local workload. Setup, unavailable infrastructure and permission failures
stop with remedies; changing only a patch hash is not progress. The controller reserves token
and time allowances for final checks and records requested/effective model and unknown usage.
Unsupported effort controls are refused. Interrupted effects require reconciliation; continuation
retains the original contract, escalation count, remaining budget and deadline.

## Measurement authority

| Runner | Outcomes and collected count | Changed-line coverage | Base-control attribution | Evidence authority |
| --- | --- | --- | --- | --- |
| Node native, recognized command, Node 24 | Harness-selected structured reporting | Strict complete external LCOV arm when available | Existing controlled per-file path | Existing ratchet rules and bonds |
| Node native, Node 22 | Existing outcomes | Unmeasured: process-isolated coverage arm unsupported | Capability dependent | Never promote unavailable measurements |
| Vitest 4.1.11 | Validated JSON individual outcomes and totals | Unmeasured | Unmeasured | Runner-reported outcomes, no numeric ratchet authority |
| pytest 9.0.2 | Bounded JUnit-derived individual outcomes | Unmeasured | Unmeasured | Runner-reported outcomes, no assertion/deletion exemption |
| Playwright 1.63.0 | Individual expected tests and agreeing totals | Unmeasured | Pinned behavior controls only | Test outcomes; artifacts are diagnostic |
| Selected packages | Package-qualified checks | Unmeasured | Unmeasured | Selected scope only |

Observed development environment: Node 24.15.0, npm 11.12.1, pnpm 9.15.0, uv 0.11.13,
Python 3.14.7 on the host and 3.11.2 in the isolated uv fixture, Playwright 1.63.0 and Docker 29.5.2. Fixtures establish their named scenarios,
not population-level false-green rates, a new-user study, or commercial-model superiority.

Official command and workflow references: [uv locking/syncing](https://docs.astral.sh/uv/concepts/projects/sync/),
[pytest reports](https://docs.pytest.org/en/stable/how-to/output.html),
[Playwright reporters](https://playwright.dev/docs/test-reporters), and
[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## Run the examples

The complete [clamp contract](examples/clamp-goal.json) comes from the installed-package fixture.
Keep it outside the candidate checkout, then verify a clamp branch with:

```sh
swarm-verify ci --workspace ./project --branch feature --base main \
  --goal-contract /trusted/clamp-goal.json --summary review.md --json
```

The object shown in the CLI section belongs in `checks[].behavior`; each requirement lists its
check IDs. HTTP and browser checks use that same contract, authorship and evidence model. Run
these checked-in demonstrations after building both binaries:

```sh
node scripts/validate-http-cli.mjs
node scripts/validate-selected.mjs
node scripts/validate-presets.mjs
```

The HTTP example starts an owned Node service, probes `/ready`, posts `{}` to `/value`, and
asserts status 200, JSON content type and `value: 1`. It accepts the unchanged behavior and
rejects a service returning `value: 2`; it confirms the port is free after each run. The
[full fixture](../scripts/validate-http-cli.mjs) contains its executable contract and service.

For browser checks, explicitly prepare the tested development image and execute the fixture:

```sh
docker build -t swarm-upgrade-browser:20260927 -f scripts/fixtures/browser.Dockerfile .
node scripts/validate-browser-cli.mjs
```

That build installs Playwright and Chromium with network access because the operator requested
it. Candidate verification runs with network disabled and read-only acceptance mounts. The
prepared image supplies the pinned runner under `/opt/swarm-browser`; a project image can
instead provide its matching installed runner. The [browser contract and test](../scripts/validate-browser-cli.mjs)
click a real button and assert one increment, then reject a button that increments twice.
Failure PNGs and traces remain diagnostic artifacts in the bounded bundle.

The isolated Python fixture uses an explicitly prepared hash-verified dependency cache:

```sh
docker build -t swarm-upgrade-python:20260927 -f scripts/fixtures/python.Dockerfile .
node scripts/validate-python-container.mjs
```

It runs locked uv preparation, real pytest collection and a pinned Python CLI obligation in
network-disabled containers through both binaries. An incomplete offline cache is a setup
failure, never permission to enable candidate network access.

For a bugfix, the clamp example establishes its failing base before implementation. For a
refactor, use `preset: {"kind":"refactor"}` with the same checks on base and candidate, as in
the HTTP example. For an upgrade, copy the explicit manager/dependency/manifest/lock/source
scope from [the upgrade fixture](../scripts/validate-presets.mjs), choose your exact target,
and pass `--install`. The ordinary task command accepts each preset as shown above, feeds
observed acceptance failures into the existing bounded repair loop, and independently checks
the final tree. Generated checks never replace failed pinned criteria.

## GitHub Action

Copy [the consumer workflow](examples/swarm-verification.yml) and the clamp contract into the
fixture repository's base branch before proposing its clamp fix. For another project, author
and review its own acceptance contract on the trusted base first. The example pins the Action:

```yaml
uses: moonrunnerkc/swarm-orchestrator@6162b7f3c694bf08c84a86a7e8f80c0183cf16ae
```

The Action downloads that implementation separately from candidate code, selects Node 24,
builds its standalone verifier, and checks immutable head/base IDs in disposable containers on
a GitHub-hosted runner. It refuses `pull_request_target` and self-hosted mode. Its permissions
are read-only; neither checkout persists credentials. Candidate commands receive no retrieval
credentials, release credentials, signing secret or Docker socket. Use a prepared trusted image
for dependencies that the network-disabled candidate needs; the Action does not install them.

The job summary names regression, individual requirements, unmeasured checks, execution limits
and evidence digests. Outputs are `status`, `report`, `summary`, `evidence`, `artifact` and
`retention`. Evidence is uploaded on rejection as well as success, retained seven days, and
bounded to 32 MB total, 8 MB per file and 4096 files. Incomplete retention fails the Action while
preserving the original verifier status. An ephemeral signature does not establish signer trust.
The repository's [control workflow](../.github/workflows/action-controls.yml) asserts both the
passing and the genuinely rejected candidate; a negative run cannot pass just by hiding errors.
