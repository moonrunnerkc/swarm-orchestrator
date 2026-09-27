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
--no-install-project`. Inside a container, that one authorized command runs with registry
access, with lifecycle scripts off, and is recorded with `network: registry` on its
`dependency-install` record; every check that follows runs with the network off, and the
containment self-test still measures `isolated`. Without `--install` a network-disabled
container needs a prepared runtime, and nothing loosens its boundary.
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

Browser `argv` checks execute the project runner as before, but their output is explicitly
runner-reported and task acceptance is **unjudged**. Candidate configuration, reporters and
Node dependencies can print fabricated success. A real Playwright executable alone does not
make those results independent.

For acceptance, use `instrument: { source, titles }` instead of `argv`. `source` contains the
sealed ESM Playwright test and `titles` names every expected test. The harness generates the
configuration and copies this instrument outside the candidate checkout in a fresh container.
It resolves Playwright from `/opt/swarm-browser/node_modules`, supplied by the immutable image,
and never discovers candidate configuration, tests or dependencies. Browser binaries must also
come from the immutable image: `/ms-playwright` by default, or an explicitly selected
`/opt/swarm-browser/browsers`. Candidate browser paths and redirected browser directories are refused. The test runs as
`instrument.spec.mjs` in the `chromium` project, with one worker, no retries and no focused tests.
Titles must be unique and match the captured results. The recorded execution boundary and
complete check digest are required by both runtime and offline readers. Host execution cannot
provide this boundary and reports unavailable with a setup remedy.

The instrument is trusted acceptance code whose author and exposure remain recorded. It must
exercise candidate behavior through the browser, not evaluate candidate code in its Node
assertion process. A preloaded module boundary rejects imports outside the sealed instrument
and immutable dependency tree, including imports from candidate files. `SWARM_SUBJECT_DIRECTORY` names the candidate directory for reading
application data, as the fixture reads JavaScript bytes into a browser page. This does not
establish the sufficiency of the authored tests or the integrity of the execution machine.
This mode supports client-side subjects and trusted static-fixture setup. Starting candidate
executables inside the assertion container is unsupported because they would share its process
boundary. Use project-runner mode with an unjudged outcome when this boundary is unavailable.
Zero, skipped, flaky, duplicate, malformed or truncated reports cannot pass. Screenshots and
traces are bounded diagnostics, never correctness verdicts. The isolated
[browser fixture](../scripts/validate-browser-container.mjs) executes the same sealed click
assertion on correct and broken application code.

Unavailable package checks retain their package-qualified identities in seals, JSON and Markdown.
Absent optional static tools remain named unmeasured observations; they are not passing checks.
A configured tool that cannot run, a setup failure or missing tests in a selected package leaves
regression unmeasured even when another package passes.

## Challenging the checks

A contract's checks are evidence about the requirement only if they can tell the work from
wrong work. `--challenges` asks that question of every requirement and records the answer
beside the ordinary acceptance. Four families, each answered from an execution:

1. **Original defect.** The checks run on the base tree as well as the candidate. A requirement
   whose checks reject the base and accept the candidate `discriminates`; one whose checks
   accept both is `vacuous`, a gap, because they would have accepted a patch that does nothing.
   Under a refactor preset the base is expected to pass and reads `preserved`. Bugfix and
   refactor presets already record this base control; a contract without a preset gets one.
2. **Incorrect alternative.** Mechanical mutations of the lines the patch added (the same eight
   operators the oracle bond uses, in their declared order, at most six) are written into the
   checkout one at a time and every check is run over the mutated tree. A rejected mutation is
   `caught`. One every requirement accepts is a demonstrated `gap` only with a witness that it
   changed the program: the repository's own suite refusing it, spent at most twice per
   verification. A survivor with no witness is `unwitnessed`, which is uncertainty and never a
   defect. A contract may also seal **fixtures**: patches the author declares to violate one
   named requirement, which that requirement's checks must reject. A fixture that fails to
   apply is invalid evidence, not a caught alternative.
3. **Evidence and instrument.** Each challenge runs under the sealed contract over a tree whose
   identity is recorded in the run record, with artifacts written immutable and the tree held
   unchanged during the check, as the goal verifier does.
4. **Missing obligation.** A requirement with no check is a `gap` with a remedy; one whose check
   could not execute is `invalid-evidence`.

Per requirement the reading is `detected`, `gap`, `invalid-evidence`, `unjudged` or
`inapplicable`. The verification's JSON carries the whole report under `challenges`, the text
output one line per requirement, and the bundle three record rules: `challenge-plan-v1`,
written before anything runs with the selection and its seed, `challenge-run-v1` intent and
completed pairs per alternative, and `challenge-verdict-v1`. The bundle's own verifier
re-derives every verdict from those records with an implementation of its own
(`src/evidence/verifier/challenges.mjs`), held to the producer's by a parity test.

Three policies, all explicit:

```sh
swarm-verify ci --workspace ./project --branch feature --goal-contract /trusted/goal.json
swarm-verify ci ... --goal-contract /trusted/goal.json --challenges report
swarm-verify ci ... --goal-contract /trusted/goal.json --challenges required
```

`off` (the default for `ci`) runs no challenge and changes nothing about existing behaviour.
`report` runs them and records the findings; a gap does not refuse. `required` refuses unless
every requirement reads `detected`, with the reason `challenges-unmet` named in the
certification: a contract with no executable challenge does not pass required mode vacuously.
The Action's `challenges` input defaults to `report`. Nothing here calls a model; the
challenges are mechanical, and a fixture is authored.

To seal a fixture, add to the contract:

```json
"challenges": {
  "version": 1,
  "mutations": "auto",
  "fixtures": [
    { "id": "returns-input", "requirement": "negative-input",
      "description": "returns the input unchanged", "patch": "diff --git a/clamp.mjs ..." }
  ]
}
```

Python projects have no automatic mutation today; a Python contract is challenged through its
sealed fixtures and its base control, and that limitation is what an `unjudged` requirement
with no alternatives says.

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
| Node native, recognized command, Node 22.8 or newer | Harness-selected structured reporting | Strict complete external LCOV arm when available | Existing controlled per-file path | Existing ratchet rules and bonds |
| Node native, Node 22.0 to 22.7 | Existing outcomes | Unmeasured: process isolation cannot be named on the command line | Capability dependent | Never promote unavailable measurements |
| Vitest 4.1.11 | Validated JSON individual outcomes and totals | Unmeasured | Unmeasured | Runner-reported outcomes, no numeric ratchet authority |
| pytest 9.0.2 | Bounded JUnit-derived individual outcomes | Unmeasured | Unmeasured | Runner-reported outcomes, no assertion/deletion exemption |
| Playwright 1.63.0, sealed instrument | Named executed tests and agreeing totals in immutable image | Unmeasured | Pinned behavior controls only | Authored instrument and runtime trust required; artifacts diagnostic |
| Playwright project argv | Runner-reported only | Unmeasured | Unmeasured | Task acceptance unjudged, including apparently passing JSON |
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
prepared image supplies the pinned runner under `/opt/swarm-browser`; an explicitly prepared
project image must provide that same immutable runner location. No runner is installed during verification. The [browser contract and test](../scripts/validate-browser-cli.mjs)
click a real button and assert one increment, then reject a button that increments twice.
Failure PNGs and traces remain diagnostic artifacts in the bounded bundle. Candidate configuration
and candidate-installed runner files are ignored by the sealed instrument.

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

The Action is a thin client of the installed verifier: three steps of the same binary,
`swarm-verify action verify`, `comment` and `retain`, with GitHub's own attestation action
between them. The complete minimal workflow for a new user is
[examples/swarm-verification.yml](examples/swarm-verification.yml): one job, one `uses`, and
the permissions a signed comment needs. The consumer's own checkout is not used; the Action
fetches the pull request's head and base by commit id into a checkout it owns.

```yaml
      - uses: moonrunnerkc/swarm-verify@v1
```

What one run does, in order:

1. `verify` reads the event, fetches the exact head and base (or GitHub's test merge, under
   `target: merge`) from the event repository, runs `swarm-verify ci --branch <head> --base
   <base>` with candidate commands behind `--isolation docker:<image> --require-isolation`,
   and writes `report.json` (`swarm.ci.v1`), `summary.md`, the evidence bundle with its own
   verifier, and `verdict.json`: the canonical `swarm-verify.verdict.v1` document binding
   repository, pull request, head, base, tree, patch digest, verifier version, policy, run
   identity, the digests of the report and the bundle's chain head, and the decision.
2. `actions/attest` signs the verdict document as a GitHub artifact attestation with predicate
   type `https://github.com/moonrunnerkc/swarm-verify/verdict/v1`. That uses Sigstore through
   the workflow's OIDC identity; no key is managed anywhere. It needs `id-token: write`,
   `attestations: write` and `artifact-metadata: write`.
3. `comment` posts one comment on the pull request and updates it in place on reruns. The
   comment carries a marker bound to the pull request and the head it describes, and before
   writing it reads the pull request's current head: a run for an older head finds a newer
   one and posts nothing, reporting `stale-head`. Candidate-shaped text is escaped and mentions
   are defused; the body is bounded below GitHub's limit. Needs `pull-requests: write`.
4. `retain` copies the report, summary, verdict, attestation bundle and evidence bundle within
   bounds (32 MB, 8 MB per file, 4096 files) and the whole is uploaded as one artifact.
5. The final step returns the verification status: 0 for verified or a regression-only pass,
   1 for not verified (or for a regression-only pass under `require-task: true`), 4 for an
   incomplete, refused or head-changed run. Attestation and comment status are separate
   outputs; a failed signature or publication is never reported as a delivered signed comment.

Verify a signed verdict from outside the run. `swarm-verify verdict` binds the document to the
report, summary and bundle beside it by digest, then hands the signer question to GitHub's own
attestation verifier against Sigstore's public trust root; it never reimplements that check,
and without `gh` it prints the exact command and leaves the signer unverified:

```sh
swarm-verify verdict retained/verdict.json --repo OWNER/REPO \
  --signer-workflow OWNER/REPO/.github/workflows/swarm-verify.yml
```

which runs, and reports the result of:

```sh
gh attestation verify verdict.json --repo OWNER/REPO \
  --predicate-type https://github.com/moonrunnerkc/swarm-verify/verdict/v1 \
  --signer-workflow OWNER/REPO/.github/workflows/swarm-verify.yml
```

Exit 0 needs both: evidence bound and signer trusted. The trust root is Sigstore's, fetched by
`gh`, never a key the run supplied; the identity checked is the workflow file in the repository
you name, which rotates with nothing to manage. A verdict signed by a workflow at another path
or in another repository is refused by identity, whatever its contents say.

Fork and Dependabot pull requests run under a read-only token with no OIDC identity, so on a
plain `pull_request` run their comment and signature report `unavailable` while the
verification and the artifact still happen. The supported route for them is
[examples/swarm-verification-forks.yml](examples/swarm-verification-forks.yml): a
`pull_request_target` workflow whose definition comes from the base branch, under which the
Action refuses to run candidate code anywhere but inside docker isolation. Candidate code
never sees the job's token, the runner's socket or the evidence directory; it sees a
network-disabled container with the owned checkout mounted. With `install: true` the lockfile
install runs first inside the container with registry access and lifecycle scripts off, and
is recorded as such; the checks then run with the network off.

Inputs beyond the defaults: `target` (`head` or `merge`), `image`, `isolation` (`host` is
explicit and recorded), `goal-contract`, `oracle`, `packages`, `install`, `require-task`,
`comment`, `attest`, and for events without a pull request `head`, `base`, `workspace` and
`source-url`. Self-hosted runners are refused unless `allow-self-hosted` says otherwise
knowingly. The repository's [control workflow](../.github/workflows/action-controls.yml) runs
the source-built Action over a good and a genuinely rejected candidate on every push, and
asserts the verdict document, its signature and the absence of a comment on a push event.

Pin the Action by full commit SHA where immutability matters:
`uses: moonrunnerkc/swarm-verify@<sha> # v1.x.y`. The canonical implementation lives in this
repository under `src/action/`; the distribution repository holds only the Action manifest and
a lockfile naming the exact published `swarm-verify` version it installs.
