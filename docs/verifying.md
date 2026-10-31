# Verifying a change

`swarm verify` (or `swarm-verify verify`) judges one change against one base commit and signs
what it found. This page says what each part of the verdict means and where it stops.

## What runs, in order

1. The base commit is cloned into a temporary directory that shares the repository's objects.
2. The checks, the protected-path allowance and the setup command are read from the base's
   `swarm.toml`, or the checks from the base's manifests. Nothing in the change can rewrite them.
3. Dependencies are prepared: the `[verify] setup` command runs, or the workspace's
   `node_modules` and `.venv` are linked into the checkout.
4. Every declared check and every sealed held-out check runs at the base commit, before the
   change applies, with each test runner's report written (see below) and the judge loaded
   into declared test checks. Tracked files and the held-out overlay are put back afterwards.
   The results and reports are kept under `$SWARM_HOME/baselines/` (default `~/.swarm`), keyed
   by the base commit, the environment digest (which holds the check commands), the sealed set
   and the judge's code, so a second verification of the same base reuses them.
5. The change is applied with `git apply --index`. When it touches a lockfile or a manifest, the
   setup command runs again.
6. The declared checks run on the changed tree the same way, with V8 or coverage.py measuring
   the changed lines, then one mutant of a changed line.
7. Protected paths the change touched are restored to the base, the sealed files are copied in,
   and the held-out checks run with the judge loaded.

## Reading a check test by test

The verifier recognizes five test runners in a declared command, or in the one `package.json`
script that an `npm`, `pnpm`, `yarn` or `bun run` command names, and appends the runner's
machine-readable report:

| Runner | Appended |
| --- | --- |
| pytest | `--continue-on-collection-errors --junitxml=<file>` |
| jest | `--json --outputFile=<file>` |
| vitest | `--reporter=default --reporter=json --outputFile.json=<file>` |
| mocha | `--reporter json --reporter-option output=<file>` |
| go test | `-json` after `go test`, standard output to the file |

A command that chains, pipes or redirects, or names more than one runner, is not recognized.
Each test in the base report is read against the same test in the report with the change:

| At base | With the change | Read as |
| --- | --- | --- |
| pass | pass | passing |
| fail or skipped | pass | fixed |
| pass | fail or skipped | regressed: the check fails |
| fail | fail or skipped | pre-existing: reported, does not block |
| present | missing | deleted: the check fails, unless the test lived in a file the change edited and `[protect] allow` includes `tests` |
| missing or skipped | fail | newly failing: the check fails |

A check also fails when its command exits nonzero with the change and zero at base though no
test in its report fails, and when the judge finds the change patched assertions the base run
did not. The check's result carries the counts and up to 100 ids of each kind. It is measured
whenever both reports parse, whatever the command's exit code at either commit.

A recognized check is `unmeasured` only when its command could not run (it timed out, was
cancelled or never started) or its report could not be parsed, at base or with the change, or
when nothing blocks and no test in its report passes with the change: a run that collected no
test, or one in which every test failed at both commits, cannot tell the change from no change.
The reason names which. pytest keeps collecting past a module that fails to import, which then
counts as one failing entry, so one broken module leaves the rest of the suite measured. Any unmeasured check makes the verdict `unmeasured` (exit 4).

A check whose command names no recognized runner is judged by its exit code, and the verdict's
reasons say so:

| At base | With the change | Result |
| --- | --- | --- |
| pass | pass | `pass` |
| pass | fail | `fail`: a regression, and the verdict fails |
| fail | pass | `pass`: the change fixed it |
| fail | fail | `pre-existing-failure`: excluded from the pass rate, listed under unmeasured with the base output digest |

A pre-existing failure leaves the verdict `unmeasured` when nothing else failed: an exit code
cannot tell an inherited failure from a fix that did not work, and unmeasured never counts as a
pass. `swarm run` hands such a verdict back to the model with the check's output, the way it
hands back a refusal.

Held-out checks are recorded at base too, but they are sealed to fail until the change is right,
so one that fails with the change fails the verdict whatever it did at base. One that passes at
base is listed under unmeasured: it does not tell this change apart.

## The judge

Tests run in the same process as the code they judge, so a change could patch the assertions
at import time. Every Node and Python process of a declared test check (at base and with the
change) and of a held-out check therefore loads a judge before any project module: `NODE_OPTIONS=--import` for Node and a `sitecustomize.py` on
`PYTHONPATH` for Python, both written outside the checkout.

- Node: the functions of `node:assert` and `node:assert/strict` become counting accessors that
  record any assignment; `node:test`'s exports, `Object.is`, `Array.prototype.includes` and the
  other builtins listed in `src/verify/judge.ts` are recorded as they were; and every ES module
  under a test directory of the checkout has its exported functions and prototype methods
  recorded once it evaluates.
- Python: `unittest.TestCase`'s assert, fail and run methods, the builtins tests compare with,
  and pytest's runtest, call and assertion-rewrite hooks. The interpreter's own sitecustomize
  still runs first.

At exit each process reports `ok` or what changed. A held-out check fails when any process
reports a change, or when a process that loaded the judge never reports (it was killed, or its
exit hooks were removed). A declared test check fails on a finding its base run did not show,
so a suite whose workers are killed at exit is not refused for that at both commits. The
predicate records how many processes of the held-out checks loaded the judge and how many calls
went through `node:assert`. Files that change what loads before the judge (`.npmrc`,
`.yarnrc`, `sitecustomize.py`, `usercustomize.py`, `*.pth`) are protected as config.

## Exit codes

`0` pass, `1` fail (including a protected-path violation and a change that does not apply),
`2` a command line it cannot read, `4` unmeasured (no checks declared, a command that could not
run, a runner report that could not be parsed, or a check without a recognized runner that
fails at base and still fails).

## Limitations

- The judge is a tripwire, not a sandbox. Checks run on the host as the invoking user, so code
  under test that sets out to defeat the verifier itself (rewriting the judge's report, the
  base-run cache, a runner's report, the sealed store or the installed package) is out of its
  reach. Test helpers
  loaded with `require` are not watched, and a test runner that is neither Node nor Python runs
  its held-out checks unjudged.
- Linked dependencies resolve through the workspace. A monorepo whose `node_modules` symlinks
  its own workspace packages resolves those packages to the workspace's source, not the clean
  checkout's, so a change to such a package is tested against the workspace copy. Declare a
  `[verify] setup` command that installs into the checkout for such a repository.
- Submodules are left out of the tree digest and are not checked out in the clean clone:
  `verify.mjs` recomputes the digest from a plain export of the tree and cannot recompute a
  gitlink, and a change inside a submodule is not judged.
- A check whose runner is not one of the five (`node --test`, Django's `runtests.py`, a Makefile
  target) is judged per command. If it runs the whole suite it fails at base when any test in
  it does, so splitting such a suite into several declared checks keeps an unrelated red test
  from leaving every change unmeasured.
- Held-out checks are still judged per command.
