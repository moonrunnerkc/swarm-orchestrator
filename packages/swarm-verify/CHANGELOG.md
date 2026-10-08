# Changelog: swarm-verify

The standalone verifier, published to npm as `swarm-verify` and distributed as the GitHub Action
`moonrunnerkc/swarm-verify`. Versions before 1.0.0 (0.2.0, released with Swarm Orchestrator
14.2.0 on 2026-09-27) carried no changelog of their own. The coding agent that shares this
verifier's implementation, `swarm-orchestrator`, keeps its own changelog at the repository root.

## 1.3.1 - 2026-10-08

Identity and packaging only; the verification engine is 1.3.0's and no verdict changes.

### Changed

- **Swarm Verify has its own product home**, [moonrunnerkc/swarm-verify](https://github.com/moonrunnerkc/swarm-verify):
  the GitHub Action, the Action reference, the example workflows, this changelog and the
  releases, every file generated from the source repository. The package's `homepage` points
  there; `repository` still names the source tree the package is built from, which its npm
  provenance requires.
- **The README describes the verifier on its own terms**: the problem it answers, the answers
  it keeps apart, the commands, the Action, the integrations, what it does not establish, and
  one section on where the source lives and how the coding agent built on it relates. It no
  longer describes that agent as an optional beta.
- **The Action is branded Swarm Verify** (`name`, `description`, `author`, `branding`), and
  its source manifest moved beside this package, to `packages/swarm-verify/action.yml`.
- This changelog ships in the package, split out of the source repository's changelog, which
  now holds the coding agent's releases only.

## 1.3.0 - 2026-09-29

Defects found by the sixteen-repository rollout of 1.2.0, each reproduced from a recorded run
and fixed at the root. The verdicts that change are named below. The minor version is for the
new attribution rule, `failure-identity-v3`, which new records carry; a record written under
`failure-identity-v2` or v1 re-derives under the rule that wrote it.

### Fixed

- **Build runs before every check that can read its output.** 1.2.0 moved the build ahead of
  tests only. A pnpm workspace whose per-package `tsc --noEmit` resolves its siblings through the
  `dist/index.d.ts` that `tsc --build` writes, as its own CI builds first, read a failed typecheck
  on a clean tree. The build now runs first, then typecheck, lint, format and tests. **Verdict
  change:** such a project reads its real typecheck and lint results instead of a failure caused
  by the order.
- **A failed check records what its runner printed.** Node checks ran as `npm run --silent`,
  and npm hands that log level to the script as `npm_config_loglevel=silent`. pnpm reads it, so a
  failed `pnpm -r run typecheck` recorded an exit code with empty output. Checks now run as
  `npm run --loglevel=error`, which keeps npm's notices out of the record and every tool's errors
  in it; `swarm init` writes the same form. No verdict changes: the failure is still a failure,
  now with its reason.
- **The base control sees nothing the patched tree's run produced.** The base was measured in
  the same checkout after a forced checkout and a clean that keeps ignored files, so the base's
  checks ran beside the patched tree's build output. depose's base typecheck passed on the `dist/`
  the patched build wrote, and a workflow-only patch read **Regression: fail**; a module only the
  patched build emitted stayed in `dist/` and failed the base's suite the same way, so a real
  regression read as inherited. The ignored tree is now recorded once dependencies are prepared,
  and every switch between the two sides removes what was added since; a prepared entry a run
  changed refuses the comparison. Where the patch changes a lockfile, nothing installed is shared:
  the base installs its own dependencies from its own lockfile. **Verdict changes:** such a
  workflow-only patch reads its real regression result, and a patch whose build output or
  dependency change broke the suite reads **Regression: fail** instead of an inherited failure.
- **A failure that differs only in a temporary directory's random name is inherited.** The base
  and the patch failed the same three tests, and two causes differed only in pre-commit's random
  repository directory (`...eponyx5xidu` against `...epoc90ac5y6`), so the failures could not be
  matched and the regression read unmeasured. Causes and outputs are now compared with generated
  names set aside: platform temporary roots, digit-bearing directory names under them, and a
  generated name's tail where a reporter elided the rest. A file's own name, a path outside a
  temporary root and every other word still count, so a changed message still reads as changed.
  New records carry `failure-identity-v3`; a record written under v2 re-derives under v2. The
  advice for an unmatched failure now says why it could not be matched, instead of saying the
  output names no tests when it names them. **Verdict change:** such inherited failures read
  inherited, so the regression dimension is measured instead of unmeasured.
- **A base control whose worker crashed on exit still shows a regression.** quantproof's base
  ran its whole suite, failed no test, and exited 1 when a Vitest worker aborted on exit (a
  better-sqlite3 assertion under Node 24), leaving one file's tests pending. Its report no longer
  reconciled, so the two tests the patch broke, which that report names as passing, read
  unmeasured. Where the base names no failure and was not killed by the harness, a test it names
  passing once and the patch fails is now newly failing. A test the base never finished, a killed
  or cut run, or a base that names a failure of its own stays unmeasured, and nothing is ever
  inherited this way. **Verdict change:** such a run reads **Regression: fail** instead of
  unmeasured.
- **The advice for a run that measured nothing says the right thing.** Where the install already
  ran (the Action's `install: true` is passed as `--install`), a runner still missing was followed
  by "pass --install"; it now says the environment does not carry that toolchain and names the
  image setting for each route. Where it did not run, it names both routes' setting. A run that
  planned no check printed "every check stood down ()"; it now says no check was planned and why,
  and no longer suggests a `--command` flag the verifier does not have. No verdict changes.

## 1.2.0 - 2026-09-29

Fixes found by running the published 1.1.0 where a stranger would: fresh virtual machines, the
real pre-commit framework, hooks installed through `npx`, and a sixteen-repository rollout.
The verdicts that change are named below. The minor version is for two additive outputs: an `excludedEnvironments` field in the
`check` JSON report and an `excluded-environments-v1` record; no existing record field, exit code
or rule name changes meaning.

### Fixed

- **Build runs before tests.** Checks ran a Node project's `test` script before its `build`
  script. A suite that reads build output (a Vite and Workers project whose test script reads the
  built asset directory, found in a fresh-VM onboarding run) failed on a clean tree, where its own
  CI, which builds first, passes. The build check now runs first. **Verdict change:** such a
  project reads its real test result instead of a failure caused by the order.
- **The pre-commit framework hook works.** The distribution declared a `node` language hook. The
  framework installs that from git, which npm 11 refuses (`EALLOWGIT`), blocking every commit,
  good or bad; under npm 10 the install linked no `swarm-verify` binary, so whichever binary was
  on `PATH` answered. The hook now runs `npx --yes swarm-verify@<version> pre-commit`. Exercised
  against the framework on npm 11.12.1 and 10.9.8: a bad staged change is refused and a good one
  committed. Use `rev: v1.2.0` or later.
- **Installed hooks survive npm clearing its npx cache.** Run as `npx swarm-verify hook install`
  or `npx swarm-verify pre-commit install`, the installers wrote an absolute path inside the npx
  cache. From there they now write the pinned `npx` invocation; a project or global install is
  still called directly.
- **The Claude Code hook routes a piped test command.** `npm test 2>&1 | tail -5` and the same
  through `head` or `grep` with plain arguments are routed through `check` with the filters kept;
  any other pipeline stage or shell syntax is still left alone.
- **A bundle whose required challenge refused verifies.** The bundle's own verifier failed the
  "independent goal bound" check of a `--challenges required` run that refused for
  `challenges-unmet`, although the refusal was correct.
- **A formatter check runs only where the project declares that formatter.** Any `[tool.ruff]`
  table used to add `ruff format --check .`, so projects that lint with ruff and format with black
  or not at all read `fail` on a clean checkout (four real repositories, 4 to 151 files each). The
  format check now runs `ruff format --check .` only for a `[tool.ruff.format]` table or a
  `ruff-format` pre-commit hook, and `black --check .` for a `[tool.black]` table or a `black`
  hook, unavailable with the tool named when the project's environment does not hold it. Verdict
  change: a project with ruff lint configuration and no declared formatter no longer fails `check`
  on formatting; its format check reads not run, with the reason.
- **mypy keeps the scope the project's mypy configuration names.** Only `pyproject.toml` and
  `setup.cfg` `files` were read, so a project scoping mypy in `mypy.ini` (`files = src`) was
  checked with `mypy .` and failed on 180 errors in tests it never type-checks. Targets are now
  read from `files`, `packages` or `modules` in the one file mypy itself reads, in its documented
  order (`mypy.ini`, `.mypy.ini`, `pyproject.toml` with `[tool.mypy]`, `setup.cfg` with
  `[mypy]`). Verdict change: such a project's typecheck runs plain `mypy` and can pass; a project
  whose `pyproject.toml` names targets while a `mypy.ini` without them takes precedence now runs
  `mypy .` instead of a bare `mypy` that exited asking for a target.
- **An untracked virtual environment is not the change `check` measures.** A `.venv` made by
  `python3 -m venv` before Python 3.13 carries no `.gitignore`, and in a project that does not
  ignore `.venv/` its every file counted as changed: a clean tavern checkout read 81 changed files
  and failed the placeholder, secret and diff-budget checks on the environment's own files. An
  untracked directory whose root holds a `pyvenv.cfg` with a `home` key is now left out of the
  change and named (`excluded` in the output, `excludedEnvironments` in the JSON report, an
  `excluded-environments-v1` record in the evidence). A tracked or staged `pyvenv.cfg`, a
  directory holding anything tracked, and every file a `ci` patch adds are still checked. Verdict
  change: such a tree no longer fails `check` on its environment's files.
- **A dependency whose install script builds its native binding is measurable under
  `--install`.** With scripts off, `better-sqlite3` never had its binding, so every test that
  opened a database failed at base and head alike and the verdict read incomplete. The install
  scripts `npm ci --ignore-scripts` skipped now run as a deferred phase with `npm rebuild`, where
  the checks run, only after a probe shows a check-time command cannot connect, and with
  node-gyp pointed at the running node's own headers so the build needs no download. Registry
  code still never runs with network access: on the host, or wherever the probe cannot show the
  network is off, the deferred scripts do not run and the install detail says why. A script
  that tries the network there is refused and its output is reported.
- **A uv project in src layout is installed before its tests run.** `uv sync
  --no-install-project` left the project itself out, so tests could not import the package or
  call its console scripts. The project is now installed editable in the deferred offline phase:
  the build backend's requirements are fetched as wheels without being run, the backend builds
  the editable wheel offline, and uv installs it offline.
- **A script that calls pnpm finds the pnpm that installed.** Where the image has no pnpm and
  the install fetched the declared version for its own command, a script such as
  `pnpm -r run typecheck` read `pnpm: not found` and the check was unmeasured. The same version
  is kept in the checkout's `node_modules` and put first on the checks' PATH through the built
  environment.
- **The uv install no longer builds anything while the registry is reachable.** `uv sync
  --no-install-project` still built every dependency that ships only a source archive (the
  real `docopt==0.6.2` is one) and every workspace member, which runs that package's setup.py
  or build backend with the network on: a fixture archive whose setup.py tries a connection got
  through and wrote into the checkout. The install now runs with `--no-build` and leaves those
  packages out by name; in the deferred offline phase a source archive's bytes are fetched and
  checked against the lockfile's sha256 (`stage: source-archive`, nothing executed), unpacked
  and built offline, and a workspace member or local directory is built offline from the
  checkout, each step recorded. A setup.py that tries the network there is refused and its
  output reported. A git source or an archive whose hash cannot be checked is left out of the
  install with its reason named, so a check that needs it reads what it is rather than a pass.

Each deferred step is its own intent and completion on the `dependency-install` record, naming
its stage and its network (`none` with the probe's result for offline work), so a reader sees
which scripts ran offline and which fetch reached the registry. A deferred step that fails is
reported and the checks still run; one that changes source files fails setup.

### Documentation

- Every documented Action workflow shows `install: true`, without which a repository with
  dependencies reads incomplete.

## 1.1.0 - 2026-09-29

Two false passes reported against the published 1.0.7, reproduced on it and fixed at the root,
and four more found while building real controls for every attack family. Some verdicts change
because of these repairs: each change is named below, a pass that was not shown now reads
incomplete or unmeasured rather than passed, and none of them turns an old refusal into a pass.
Additive record fields and one additive flag take the minor version; no field, exit code or rule
name changes meaning, and records written before a rule keep re-deriving under the rule that
wrote them.

### Fixed

- **A pass the candidate's own instrument reported is not a pass.** On 1.0.7 a
  `vitest.config.mjs` that wrote a passing report to Vitest's `--outputFile` and exited before
  any test ran read `result: pass` from `check`, and a `test` script replaced by an `echo` of a
  passing summary read as a pass from `check` and as a regression pass from `ci`. The 1.0.6 fix
  read a list of configuration file names; it could not see a configuration importing a changed
  helper, a setup file named another way, the package scripts npm reads from the working tree,
  or a runner substituted through the manifest, the lockfile or `node_modules/.bin`. Each
  command check now observes its instrument (`instrument-identity-v1`): the scripts its command
  reaches, each tool's configuration by the names the tool discovers, every file those import or
  name, where the tool's packages come from, and the runner as installed, compared with the
  reference commit before and after the run. A pass reported under an instrument the change
  altered is withheld: `check` reads incomplete (exit 4) naming the altered files, and `ci`
  reruns the check with the base's instrument restored, where only that reading can let the pass
  stand. The observation is on the `gate-run` record and the offline verifier applies the same
  rule. A registry release of a tool at another version is recorded and trusted; a tool from a
  path, URL, git source or another package's name is not.
- **Two failing tests with the same title are two failures.** On 1.0.7 two node tests both named
  `works`, the first already failing at the base, collapsed to one TAP identity, so a patch that
  broke the second read as the first's inherited failure: `inheritedFromBase: true`,
  `regression: pass`, and the Action's `regression-only`. Under `failure-identity-v2` a node
  failure is named by its TAP location, depth and title, a Vitest test by file and full name, a
  pytest test by node id; failures are counted, compared with their cause, and never inherited
  from a run that was cancelled, truncated, cut short of its plan, contradicts its own counters,
  or repeats an identity. Checks carry `attributionRule`; a record without it re-derives under
  the title-only rule that wrote it.
- **A patch cannot pass `ci` by editing the test that would catch it.** A patch that broke the
  code and marked the catching test `skip`, deleted its file or rewrote its assertion read as a
  regression pass. Where a patch changes or deletes test files, the checks run again with the
  base's versions of those files over the patch's source; a test the base passed that fails
  there is named (`weakenedTests`) and the pass is withheld. A correct change that edits, renames
  or adds tests still passes.
- **A node suite whose every test was skipped measured nothing.** It read as passed.
- **The pre-commit hook measured the staged commit against itself**, so the change read as empty
  and a staged configuration was its own reference. It is now measured against `HEAD`.
- **A workspace pattern from a checked repository's package.json is no longer compiled into a
  regular expression**; a crafted pattern made discovery take exponential time. Patterns keep
  `*` and `**`; any other shape is refused with the fix named.

### Added

- `verdict --head <sha>` refuses a verdict made for another head than the one being decided.
- Quoted and space-bearing Git patch paths (`my file.js`, `café "x".js`, renames and copies
  between them) are read instead of refused, with every unsafe path still refused after decoding.
- The ci report and the Markdown summary name the failing tests beside every attribution, so a
  failure excused as inherited stays in view.

### Changed

- The front door, package README and claims index say what the command runs and records and
  what it does not judge, and correct three statements: `check` briefly writes its own
  falsification-bond fixtures into the repository and removes them; `regression: pass` can include
  a proven inherited failure; locally commands run on the host under a built environment, and
  containers are the Action's default. The 1.0.0 release note's statement that the basic command
  runs in a container when one is available was wrong and is corrected on that release.

## 1.0.7 - 2026-09-28

### Fixed

- **An inherited failure in Vitest's text reporters can be proven.** A project whose test
  script adds flags the structured runner does not take (`vitest run --coverage
  --reporter=verbose`) prints a coverage table that differs between the base and the patch
  whenever the patch changes code, so 1.0.6 could never show its failures were inherited and left
  the dimension unmeasured: cronproof#2, which 1.0.4 and 1.0.5 passed on an unproven inheritance.
  Vitest names every failed test and every file that failed to load on a `FAIL` line beside its
  `Test Files` summary; those lines are now the failure identities, in the verifier and in the
  offline re-deriver alike. They name failures only, so they can prove an inheritance or a new
  failure and never a pass. cronproof#2 now reads a proven inheritance and a regression pass.

## 1.0.6 - 2026-09-28

Two false passes reported against 1.0.5 and reproduced on it, and a third defect found while
fixing them. Each is fixed at the root.

### Fixed

- **A patch cannot pass its own suite by changing the runner's configuration.** A patch that
  broke `sum.js` and added a `vitest.config.js` read the report path from `process.argv`, wrote a
  passing report there and exited before any test ran, and 1.0.5 read a regression pass. The
  commands already came from the base commit; the rest of the instrument now does too. Where a
  patch changes runner configuration (Vitest, Jest, Mocha, Babel, ESLint, Prettier, Biome,
  TypeScript, pytest and their setup files), every check runs a second time with the base's
  configuration restored. A check that passes only under the patch's configuration fails where
  the base's configuration fails a test the base itself passed, and measures nothing otherwise.
  Both readings are kept on the check (`configurationObservation`, `configurationStatus`,
  `configurationFiles`, `regressedUnderBaseConfiguration`). A configuration that imports a
  helper module the patch changed, or a setup file named outside the listed patterns, is not
  caught by this and is named as a residual.
- **A newly broken test behind an old failure is a regression.** A check that failed both with
  and without the patch was read as inherited whatever else failed inside it: a base with one
  failing test and a patch that broke a second read as a regression pass wherever another check
  passed. A failure is now inherited only where every test the patched run failed also failed at
  the base (read from a structured report or TAP), or where both runs printed the same output
  once times and durations are set aside. A patched run that fails a test the base did not is a
  regression, and the new failures are named (`newFailures`). A failure that can be shown neither
  way (`attribution: "unattributed"`) leaves the regression dimension unmeasured, never passed.
- **The offline verifier re-derives these rules with its own implementation.** Since 1.0.3 the
  live verdict read an inherited failure beside a passing check as a regression pass, while the
  offline re-deriver still read it as unmeasured, so every such bundle failed its own
  "independent regression re-derived" check. The re-deriver now recomputes each failed check's
  attribution and each base-configuration reading from the recorded observations, requires them
  to match, and applies the new rule to records that carry them. Records from 1.0.3 to 1.0.5 that
  read an unproven inheritance as a pass still do not re-derive; that pass was not shown.
- **Vitest test names are relative to the checkout**, so a test is named the same wherever the
  checkout sits and a verdict posted publicly does not carry the machine's session path.

## 1.0.5 - 2026-09-28

What Comparison B and the study's replay on 1.0.4 found, fixed at the root: an oracle that ran
outside the project environment and left no record of why it refused, a container removal
judged on one sample, and two test-check details that named nothing to fix.

### Changed

- **The oracle runs in the project environment the verifier prepared.** `.venv/bin` and
  `node_modules/.bin` come first on PATH for the oracle, as `uv run` and `npm exec` would. The
  repository's own checks already call those interpreters by path. An oracle written
  `python -m pytest ...` otherwise reached the container image's interpreter, which has none of
  the project's packages, and a patch read as rejected. A directory that does not exist changes
  nothing.
- **Every oracle run is kept in the verdict** (`oracleRuns`: the tree it ran on, the command,
  its exit code, duration and the last 4000 characters of its output). The task dimension was
  decided from runs whose output was not recorded anywhere.

### Fixed

- **A late container removal no longer refuses the run.** Removal is asked for and observed up
  to three times with a growing pause before cleanup is called unconfirmed. Under load the
  runtime finished removals after its 15-second client deadline, and a container gone moments
  later refused twelve study rows in a row. A container still present after the last round, or
  one whose creation was uncertain, still refuses.

- **A failed TAP run names the tests that failed**, up to five, quoted as the runner printed
  them, after the counts. "2 failed" alone named nothing a repair could act on: in Comparison B
  the model changed nothing in six invocations fed that line for three koa patches.
- **A failed test check says why when no counted test failed.** jest and vitest summaries count
  tests, so a file that fails to load or exits the process, or a command the test script runs
  after the runner, left a failed check reading "978 passed, 978 total". The detail now quotes
  the runner's test-file line and names the files it marked FAIL, or says the exit came from
  outside the counted tests. Found on commander.js#1671 in Comparison B.

## 1.0.4 - 2026-09-28

Two findings from the 1.0.3 rollout and the study's replay on 1.0.3, fixed at the root: an
Action headline that contradicted its own regression dimension, and one more install gap.

### Changed

- **The Action's result follows the regression dimension when every failed check is
  inherited.** Three of sixteen dogfood repositories read "Not verified" while their verdict
  said "Regression: pass": their only failures were ones the base commit already had. Such a
  run is now a regression-only pass with exit status 0; the reason line still says the failure
  is inherited. A failure the base did not have still refuses. The verdict document's format is
  unchanged.

### Fixed

- **A uv project's extras are installed too** by the authorized lockfile install
  (`uv sync --locked --all-groups --all-extras --no-install-project`). 1.0.3 left extras out on
  the reasoning that they are runtime features. The study's replay on 1.0.3 showed that reasoning
  wrong for the older layout that keeps pytest, ruff and mypy in a `dev` extra: every row from
  those projects read "no test ran", and the held-back check was reported as failing on heads
  where it passes once pytest is present. A lockfile declaring conflicting extras makes uv refuse,
  and that is reported as a failed install.

## 1.0.3 - 2026-09-28

What the AI-authored pull request study's first complete run through 1.0.2 established, fixed
at the root: one change of verdict semantics, named as such, and one install gap.

### Changed

- **A failure the base already had no longer leaves the regression dimension unmeasured.**
  The base control ran the same check at the base commit and found it failing there, which
  is a measurement about the base, not about the patch; with the patch's other checks
  passing, the regression dimension now passes and the inherited failure is named beside it.
  In the AI-authored pull request study, ten of twenty-two adjudicated-correct pull requests
  had read as refused for a lint or format failure their base carried. A failure the base did
  not have is still a regression, and a required check that measured nothing still leaves the
  dimension unmeasured.

### Fixed

- **A uv project's every dependency group is installed** by the authorized lockfile install
  (`uv sync --locked --all-groups --no-install-project`). Groups are development-only by
  definition, and a project that keeps pytest in a `test` group rather than `dev` had no
  runner after a default sync, so its suite read as not run. Extras stay uninstalled.

## 1.0.2 - 2026-09-28

Two more findings from the study's run through 1.0.1, fixed at the root.

### Fixed

- **The container's scratch space is a directory on the host, not a tmpfs.** A tmpfs is
  charged to the container's memory limit, so with the cap at 2 GB every large lockfile
  install was killed (exit 137) once its cache passed the cap; sizing the tmpfs in 1.0.1 could
  not help. Each run now mounts its own directory under the person's `~/.swarm/scratch` at
  `/tmp`, executable, removed when the run ends, and removed by runtime repair for a run that
  died between creating and removing it.
- **A base commit that exists but cannot be checked out is reported with git's own line.**
  Two paths differing only in case, on a case-insensitive filesystem, leave the fresh checkout
  dirty and git refuses to switch; the refusal read as "the base commit is not in the checkout",
  which was false. The last line git printed is now the reason.

## 1.0.1 - 2026-09-28

Four gaps the AI-authored pull request study exposed on its first run through the stable
release, each on real repositories, each fixed at the root.

### Fixed

- **The container's scratch space holds a real install.** HOME and TMPDIR inside the container
  are the `/tmp` tmpfs, so npm's and uv's caches live there, and its 256 MB left a lockfile
  with a native wheel or a large dependency tree failing with "no space left on device". It
  is now 4 GB, of which only what is written is used.
- **A pnpm lockfile with no `packageManager` pin installs.** The image carries no pnpm; the
  lockfile's own format now names the major that reads it (9.0: pnpm 10, 6.0: pnpm 8, 5.x:
  pnpm 7), that major's latest is fetched through npm for the install command, and the
  command records which.
- **A configured Python tool the environment does not hold reads as a check that measured
  nothing.** `ci` assembles its checks before the install, so the environment could not be
  read then; when the interpreter itself refuses to start a module, exits 1, and prints only
  its one-line "No module named", the gate is not applicable with the module named. A test's
  own output beside those words is a test's words, and the exit code decides as before.
- **pytest absent from the environment is said as such.** The runner script says so and exits
  127, and the reading is "measured nothing" with the reason, not "malformed runner output".

## 1.0.0 - 2026-09-28

The first stable release of `swarm-verify`. Everything below shipped through nine prerelease
candidates, each rolled out across sixteen owned repositories and three README-only onboarding
simulations, with every defect they found fixed at its root and named here.

### Added

- **`swarm-verify` with no subcommand is `check`**: discover the declared checks from the
  manifests, run them unattended (no terminal on stdin, `CI=true` in the child environment),
  and report five conclusions apart: whether the command ran, what the checks found, how
  commands were contained, whether any requirement was judged, whether any check was
  challenged. Exit codes: 0 regression-only pass, 1 a failed check, 2 an unreadable command
  line, 3 cancelled, 4 incomplete. `--explain` previews, `--json` emits `swarm.check.v1`.
- **Requirement-level challenges** for goal contracts: `ci --challenges off|report|required`
  runs a base control per requirement, mechanical mutations of the changed lines witnessed by
  the repository suite, sealed fixtures the contract declares, and names missing obligations.
  Records `challenge-plan-v1`, `challenge-run-v1` and `challenge-verdict-v1`; the bundle's own
  verifier re-derives every verdict independently. `required` refuses with `challenges-unmet`.
- **Python changes are challenged too**: the mutation set reads Python's statement forms
  (comparison inversion, condition negation, operand swap, `return None`, `= None`), masks
  literals and comments, sets test files aside, and every Python mutant is shown to parse with
  Python's own parser before it runs.
- **The GitHub Action as a client of the installed verifier**: `swarm-verify action
  verify|comment|retain`. The verdict document is signed as a GitHub artifact attestation, the
  pull request comment is one per PR, updated in place, bound to the head, escaped and
  mention-free, and a delayed run for an older head posts nothing.
- **Coverage on Node 22.8 and newer**: the coverage arm names process isolation in the spelling
  the running Node takes; the floor moves from 24 to 22.8.
- A verifier platform matrix workflow installs the packed package on Linux, macOS and Windows
  under Node 22.0.0, 22 and 24.
- **`swarm-verify verdict`** binds a signed verdict document to the report, summary and bundle
  beside it and hands the signer question to `gh attestation verify`.
- **Three integrations, each a client of the installed verifier**: a Claude Code hook that
  rewrites the agent's recognised test command to `swarm-verify check` (`hook install`,
  `uninstall`, `run`); a local MCP server over stdio with three bounded tools (`mcp`); and a
  pre-commit hook that verifies the staged tree in a detached worktree without touching the
  working tree (`pre-commit`, `pre-commit install`, `uninstall`). Documented in
  `docs/integrations.md`, each with real positive and negative runs in its tests.

- An authorized lockfile install inside a container reaches the registry for that one
  command, with lifecycle scripts off, recorded with `network: registry`; the checks that
  follow run with the network off. Where the image carries no pnpm and the manifest pins
  `packageManager: pnpm@X`, that exact pnpm is fetched through npm for the install command.
  The install record is written whether or not a goal contract was supplied.
- The twelve attack families of the verifier-first assignment are bound to executed controls
  in `docs/verifier-first/attack-controls.md`, with four new ones: an outside-package change
  refused by name, a mismatched goal tree refused before any record, an unfinished challenge
  intent refusing the next challenge, and a revised contract deriving a fresh verdict.
- The stable 1.x contract is written down in `docs/verifier-first/contract.md`.

### Fixed

- **A container image that is not on the machine is pulled once, before the first container.**
  `docker create` against an absent image pulled it inside the command's own deadline, and a
  probe's deadline is seconds, so on a fresh machine (a GitHub runner with the Action) every
  container timed out while the image downloaded and the run stopped as "cleanup could not be
  confirmed" without saying why. The backend now inspects the image and pulls it with its own
  ten-minute allowance before the command's deadline starts (a pull inside the deadline left a
  containment probe no time at all and the run refused as "isolation unknown"), names a pull
  that fails, and a creation that timed out or did not start is named in the cleanup message
  with the runtime's last line. A probe that timed out is named as such rather than as one
  that "could not start (null)".
- **The vitest runner reports to a file and prints only that file.** Four of sixteen rollout
  repositories had their whole suite read as "malformed runner output" because their tests
  logged, or their test script printed its own verdicts, into the stdout the JSON reporter
  used. Stdout is muted while the suite runs; the report's bytes are all that is printed,
  whole: the first cut of this wrote at exit and lost everything past the pipe's 64 KiB
  buffer, so every large suite read as malformed instead.
- **Manifest scripts run through npm whichever manager installed the lockfile.** pnpm is
  fetched for the install command alone and is not in a trusted image, so every pnpm
  project's typecheck, lint and build read "the command is not installed" in a container. A
  script that itself calls pnpm still needs pnpm and says so. Both the `check` plan and the
  `ci` gate set compose the scripts this way.
- **When every check stood down, the advice lists why each did**, and distinguishes a runner
  that is not installed (install the dependencies) from a toolchain the verifier does not
  drive (unmeasured, not a pass) and from a manifest that declares no check.
- **Containment probes are shell scripts.** An image built for a Python project carries no
  node, so every probe "could not start" and the run refused with isolation unknown. The read
  and write probes use `cat` and `printf`; the network probe attempts the connection with node,
  else python3, else bash's `/dev/tcp`, and an image with none of them is recorded as
  unmeasured, never as contained.
- **The verdict's advice names what happened.** A failed or unmeasured required check was
  advised as "the repository's own suite passed"; it now names the check that failed on the
  patch and passed at the base, or the required check that measured nothing.
- **A configured Python tool the environment does not hold is an unavailable check, not a
  failed one.** tavern configures mypy, its synced environment holds none, and `python -m
  mypy` exited 1 with "No module named mypy", read as the typecheck failing on a clean
  checkout. Presence is read from `.venv`'s site-packages without running anything; the
  check then says which tool to add and sync. Without a `.venv` nothing is claimed.
- **A failed check shows the last lines the command printed**, in `check`'s report and its
  JSON (`output`), so "the command exited 1" comes with what a terminal would have shown.
- **Two messages a stranger met on a first run say what they mean.** The file-set check in a
  run with no declared file set no longer speaks of "no planner" and "no agent"; it says no
  file set was declared and what changed. The per-run signing key notice says what a per-run
  key means and that it is ordinary on a headless machine.
- **A vitest file that repeats a test title no longer makes the whole suite unmeasured.**
  The second occurrence is named by its position; the runner accepted the title and so does
  the reading. Found on depose, where one repeated `it` hid 383 tests.
- **The tests reading says what its counts are and are not** in words a first-time reader
  can follow, instead of "ratchet counts" and "base-control attribution".
- **An image pull is attempted three times** before the run stops, since a hosted runner saw
  Docker Hub reset the connection once; the last failure's own line is what the error names.
- **A Python checkout whose ignored caches exist no longer fails to stage.** The scratch
  index named `__pycache__`, `.pytest_cache`, `.mypy_cache` and `.ruff_cache` as exclude
  pathspecs on `git add -A`, which git refuses with "paths are ignored" (exit 1) as soon as one
  of them exists and is gitignored, the ordinary state after one test run; the verifier then
  told the reader the repository "is not a git working tree". Everything is staged and the
  caches are removed from the index afterwards. Found by the README-only python simulation.
- **A git failure inside a repository quotes git's own last line** rather than the command
  line, and no longer sends the reader to `git init` unless git said the directory is not a
  repository.
- **A uv project without a synced environment is a missing prerequisite, not four failed
  checks.** `uv run --no-sync` exits at once without a `.venv`; `check` now names
  `uv sync --locked` as the remedy and exits 4, as it does for a missing `node_modules`.

### Changed

- Both binaries exit 2 for a command line they cannot read, as the exit code taxonomy said.
- The container's scratch mount is executable, so a fetched package manager can run from it.
- The README leads with the verifier; the coding agent's page is `docs/agent.md`.
