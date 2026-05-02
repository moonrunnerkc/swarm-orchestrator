# Phase 2 Layer 1 Harness Diagnostic

Date: 2026-05-01
Author: Claude (diagnostic-only, no code changes)
Source run: `docs/p1-eval-fixtures/runs/phase-2/synth-n10/` (started 16:22 UTC, finished 16:52 UTC)

This file is the halt-first diagnostic the user asked for. It is reference
material for the fix work that will follow once the user approves. No code
has been changed.

## TL;DR

- **Defect A (astropy editable install fails silently)**: Confirmed. The
  user's described root cause is correct. `prep_ok` is computed from
  `bool(venv_bin) and bool(gold_branch)`, with no check that the editable
  install succeeded. Direct re-run of the install reveals the real failure
  is two-stage and is **not fixable in `scripts/eval/` alone** (see
  *Cumulative harness fragility* below).
- **Defect B (Django venvs never created despite repo dirs existing)**:
  Confirmed but with a different root cause than the user proposed. Not a
  reuse-skip in `prep_instance()`. The bug is that `--workdir` accepts a
  relative path and never resolves it; the relative path then double-nests
  through `subprocess.run(cwd=relative_path, args=[..., relative_path])`,
  so the venv is created at `<repo>/<repo>/.venv` instead of `<repo>/.venv`.
  The driver's later `Path.exists()` check on the un-doubled path returns
  False and reports "venv python3 not found." Direct evidence: every
  Django workdir under `synth-n10` contains a stranded
  `<repo>/<repo>/.venv/{include,lib}` (no `bin/`, the symptom of a
  partially completed `python -m venv` in the wrong location).
- **Defect C (gold worktree at base_commit, not swarm-gold-eval)**: **Not
  a defect.** The persistent `repo_dir` is intentionally left detached at
  `base_commit` by `materialize_gold_branch` (line 260, `git checkout
  --detach $head`). The user's `git rev-parse --abbrev-ref HEAD` was being
  run against the persistent `repo_dir`, not the temporary gold worktree
  in `/tmp/swarm-eval-worktree-*`, which gets cleaned up after each test
  run. The `swarm-gold-eval` branch *itself* is correctly populated with a
  `[p1-eval] gold patch` commit (verified directly against
  `astropy__astropy-13579`, see Section 3 below). `goldPatchRef` IS being
  passed all the way through. `withWorktreeFn` IS being called.
  `goldPass=false` on every record because the synthesized test cannot
  import the package under test, identical to `basePass=false`. Defect C
  collapses entirely into Defects A and B.

## 1. Control flow in `scripts/eval/p1-run-evals.py`

### `prepare_instance()` (lines 264-286)

```python
def prepare_instance(task: dict[str, Any], workdir: Path) -> InstancePrepResult:
    instance_id = task["instance_id"]
    errors: list[str] = []
    repo_dir = clone_repo(task, workdir)
    venv_python, venv_errs = setup_venv(repo_dir, instance_id)
    errors.extend(venv_errs)
    venv_bin = str(venv_python.parent) if venv_python else None
    gold_branch = materialize_gold_branch(repo_dir, task.get("patch", ""))
    if not gold_branch:
        errors.append("gold patch did not apply; goldPass cannot be measured")

    prep_ok = bool(venv_bin) and bool(gold_branch)        # line 276
    return InstancePrepResult(...)
```

Three sequential phases: clone, venv, gold-branch. None is conditional
on the previous one's success. Notably, `prep_ok` only gates on the
existence of a `venv_bin` path and a `gold_branch` name — it does not
gate on the editable install having succeeded.

### `clone_repo()` (lines 133-157)

```python
repo_dir = workdir / task["instance_id"]
if repo_dir.exists():
    return repo_dir                                       # line 146
run(["git", "clone", "--filter=blob:none", repo_url, str(repo_dir)], ...)
run(["git", "checkout", "--detach", task["base_commit"]], cwd=repo_dir, ...)
```

If `repo_dir` exists (as in the synth-n10 reuse-of-property-n10 scenario),
clone and base-commit checkout are skipped. The function returns the
existing path. **`setup_venv()` is still called afterwards**, so the
user's hypothesis "early-return path that skips setup_venv() when
repo_dir already exists" is incorrect for this code path.

### `setup_venv()` (lines 160-226)

```python
errors: list[str] = []
venv_dir = repo_dir / ".venv"
if venv_dir.exists():
    venv_python = venv_dir / "bin" / "python3"
    if venv_python.exists():
        return venv_python, errors                        # line 174
# Fall through: try to create.
venv_create = run(["python3", "-m", "venv", str(venv_dir)],
                  cwd=repo_dir, timeout=120)              # line 176
if venv_create.returncode != 0:
    errors.append(...); return None, errors

venv_python = venv_dir / "bin" / "python3"
if not venv_python.exists():
    errors.append(f"venv python3 not found at {venv_python}")  # line 183
    return None, errors

# ...editable install attempts (lines 198-207)
for extras in EXTRAS_ATTEMPTS:
    cmd = f'{venv_python} -m pip install -e {extras} --quiet --no-build-isolation'
    result = run(cmd, cwd=repo_dir, env=pip_env, timeout=DEFAULT_TIMEOUT_S, shell=True)
    if result.returncode == 0:
        installed = True
        break
    errors.append(f"editable install with {extras} failed: ...")
if not installed:
    errors.append("editable install with all extras patterns failed; package may not import")
```

Two things to note for the diagnostic:
1. The early-return at line 174 short-circuits *both* the venv recreate
   and the editable-install loop. If the venv directory exists with a
   `bin/python3` but the package was never editable-installed, that
   stale state is reused and no install is attempted on this run.
2. After the install loop fails on every extras pattern, only a generic
   warning is appended (`"editable install with all extras patterns
   failed; package may not import"`). There is no import verification
   afterward, no failure of `prep_ok`, and the per-instance summary still
   reports `prep_ok: true` so long as `.venv/bin/python3` exists.

### Driver `--workdir` resolution (lines 427-430)

```python
out_dir = Path(args.out_dir).resolve()                   # absolute
out_dir.mkdir(parents=True, exist_ok=True)
workdir = Path(args.workdir) if args.workdir else out_dir / "workspaces"
workdir.mkdir(parents=True, exist_ok=True)
```

`out_dir` is resolved to absolute on line 427. `workdir` is **not**
resolved when supplied via `--workdir`. The default-branch `out_dir /
"workspaces"` inherits `out_dir`'s absolute form, which is why the
property-n10 run (which used the default workdir) shows absolute paths
in its prep records and worked correctly.

The synth-n10 run was invoked with a relative `--workdir
docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces` (so it could
re-use the property-n10 clones), and the relative path stayed relative
all the way through. This is what triggers the double-nest described in
section 2 below.

## 2. Defect B — actual root cause: relative `--workdir` plus subprocess `cwd`

### Direct evidence

```bash
$ find docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/django__django-* \
       -name pyvenv.cfg | head -2
docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/django__django-10914/.venv/pyvenv.cfg
docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/django__django-10914/docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/django__django-10914/.venv  # NESTED
```

Every one of the eight Django workdirs has a doubly-nested
`<repo>/<repo>/.venv` directory containing only `include/` and `lib/`,
no `bin/`. The mtimes (May 1, 10:27-10:28 local) match the synth-n10
window (started 10:22 local, finished 10:52 local). The outer
`<repo>/.venv` you see now (mtime 11:07 local) was created *after* the
run, manually by the user when reproducing Defect B.

Note that the nested `.venv` lives inside Django's own `docs/` tree
(Django's documentation source happens to share the leading path
component `docs/` with the fixture path), which is why the structure
isn't more obviously visible.

### Why the nesting happens

When the driver is invoked with `--workdir docs/.../property-n10/workspaces`
(relative to the user's CWD, which is `REPO_ROOT`):

1. `workdir = Path(args.workdir)` is the relative `docs/.../workspaces`.
2. `repo_dir = workdir / instance_id` → relative `docs/.../django__django-10914`.
3. `venv_dir = repo_dir / ".venv"` → relative `docs/.../django__django-10914/.venv`.
4. `subprocess.run(["python3", "-m", "venv", str(venv_dir)], cwd=repo_dir, ...)`
   sets the subprocess `cwd` to the relative `docs/.../django__django-10914`,
   which the OS resolves against the parent's CWD (`REPO_ROOT`), giving a
   subprocess CWD of `REPO_ROOT/docs/.../django__django-10914`.
5. **But the `argv[2]` is also relative** — the same `docs/.../django__django-10914/.venv`
   string. The subprocess interprets it relative to *its own* CWD, so
   `python -m venv` writes to:
   `REPO_ROOT/docs/.../django__django-10914/docs/.../django__django-10914/.venv`.
6. `python -m venv` partially populates the new directory (creates
   `include/` and `lib/`), but the bin-symlink phase fails or is aborted
   for reasons I did not investigate beyond confirming `bin/` is absent.
7. The driver then does `if not (repo_dir / ".venv" / "bin" / "python3").exists()`
   on the *un-nested* relative path, which the parent process resolves
   against `REPO_ROOT`. That path contains nothing (the venv was written
   to the nested location). The driver appends "venv python3 not found"
   and returns `None`.

This explains every observation in the prep records:
- `venv_bin: null` — `setup_venv` returned `None`.
- `prep_errors: ["venv python3 not found at .../.venv/bin/python3"]` — line 183.
- `prep_ok: false` — line 276 with `venv_bin=None`.

The user's diagnosis ("early-return path that skips `setup_venv()` when
`repo_dir` already exists") is wrong; `setup_venv()` *did* run, the
relative-path subprocess interaction broke it.

### Why astropy was unaffected

The astropy venvs already existed from an earlier run (`property-smoke-n2`
at 07:41 local, then `property-n10` at 07:42 local, both with absolute
paths because those runs did not pass `--workdir`). When synth-n10 ran
with the relative `--workdir`, the early-return at line 174 fired:

- `venv_dir.exists()` → True (the absolute path resolves to the same
  filesystem location regardless of how the relative form is interpreted).
- `venv_python.exists()` → True for the same reason.
- Returns immediately, no `python -m venv` invocation, no double-nest.

That's why the astropy synth records show `prep_errors: []` (an empty
list, despite an extras-install failure that the property-n10 run had
already recorded but synth-n10 skipped re-discovering).

### Why this also drags in Defect A

Once the early-return at line 174 fires, **the editable-install loop
(lines 198-207) never runs**. So:
- If the venv was previously set up successfully, the package is
  importable on this run too.
- If the venv was previously set up but the editable install failed
  (the property-n10 case for astropy: see `prep_errors` array on those
  records), the failure history is silently dropped in this run's
  records, even though the venv is still broken.

This makes prep records non-idempotent: a re-run can produce
`prep_errors: []` even when the underlying state is unchanged from a
prior failing run.

## 3. Defect C — gold-worktree investigation

### `swebench-eval-cli.ts` payload forwarding (lines 73-83)

```ts
if (mode === 'synth') {
  const record = await evaluateInstanceSynthesizer({
    instanceId: asString(task.instanceId, 'instanceId'),
    problemStatement: asString(task.problemStatement, 'problemStatement'),
    repoPath: asString(task.repoPath, 'repoPath'),
    ...(typeof task.goldPatchRef === 'string' && task.goldPatchRef.trim() !== ''
      ? { goldPatchRef: task.goldPatchRef }
      : {}),
    ...(venvBin ? { venvBin } : {}),
  });
  ...
}
```

`goldPatchRef` is forwarded verbatim if and only if the task JSON
contains a non-empty string. The Python driver (line 317-318) sets
`payload["goldPatchRef"] = prep.gold_branch` whenever
`prep.gold_branch` is set, and `prep.gold_branch` is the literal
constant `"swarm-gold-eval"` returned by `materialize_gold_branch()`
on success. All ten synth-n10 records have `gold_branch: "swarm-gold-eval"`,
so `goldPatchRef` was set in every payload.

### `evaluateInstanceSynthesizer()` (lines 138-168)

```ts
if (
  synthesis.status === 'GENERATED' &&
  synthesis.testFilePath &&
  synthesis.testCommand
) {
  const baseCommand = wrapCommandWithVenv(synthesis.testCommand, input.venvBin);
  const baseResult = await runCommand(baseCommand, input.repoPath, DEFAULT_TEST_TIMEOUT_MS);
  basePass = baseResult.exitCode === 0;

  if (input.goldPatchRef) {                              // line 147
    ...
    goldPass = await withWorktreeFn(repoPath, input.goldPatchRef, async (worktreePath) => {
      ...
    });
  }
}
```

The gold path is gated on three things in order: `synthesis.status ===
'GENERATED'`, the test file existing, and `input.goldPatchRef` being
truthy. All ten synth-n10 records have `status: "GENERATED"` and the
test file paths populated, so the gate at line 147 was the only thing
left. It evaluated `truthy("swarm-gold-eval") === true` and the
`withWorktreeFn` block executed.

### `defaultWithWorktree()` (`swebench-eval-helpers.ts` lines 46-70)

```ts
execFileSync('git', ['worktree', 'add', '--detach', worktreePath, ref], {
  cwd: repoPath,
  ...
});
```

`git worktree add --detach <path> swarm-gold-eval` resolves
`swarm-gold-eval` as a local branch reference and creates a worktree at
`<path>` with `HEAD` detached at the branch tip commit. This is the
correct shape for the eval — the test must run against the gold-fix
state of the working tree, not the gold branch label.

### Direct verification on `astropy__astropy-13579`

```bash
$ git -C docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces/astropy__astropy-13579 \
      branch -v
* (HEAD detached at 0df94ff70) 0df94ff70 Merge pull request #13574 from pllim/rm-corpus-404
  main                          9876d7164 Merge pull request #19618 from neutrinoceros/...
  swarm-gold-eval               48a1f59fc [p1-eval] gold patch

$ git -C ... rev-parse HEAD
0df94ff7097961e92fd7812036a24b145bc13ca8                # base_commit, detached HEAD

$ git -C ... rev-parse swarm-gold-eval
48a1f59fcbdf00cbdc31993ea86fe3595b151a45                # gold patch commit, child of base
```

The branch is correctly populated. The persistent `repo_dir` is
intentionally left detached at `base_commit` (line 260: `git checkout
--detach $head`). The user's evidence
> All 10 worktrees report:
>   $ git rev-parse --abbrev-ref HEAD
>   HEAD
>   $ git log --oneline -1
>   <base_commit hash> ...

is consistent with running those commands inside the persistent
`repo_dir`, not inside the temporary `git worktree add --detach`
worktree (which `defaultWithWorktree` creates under
`/tmp/swarm-eval-worktree-*` and tears down before returning, so it is
not observable post-hoc).

### Why every record shows `goldPass=false`

Both `basePass` and `goldPass` are `false` on all ten records. This is
a direct consequence of Defects A and B, not of any worktree-checkout
issue:
- **Astropy (2/10)**: editable install of `astropy` failed (Defect A),
  so the venv has no `astropy` package. `python -m pytest swarm-synth-...`
  imports `astropy.wcs.wcsapi.wrappers.sliced_wcs` (or similar) and
  fails immediately. Same failure mode in base and gold worktree
  because the venv is the same in both cases.
- **Django (8/10)**: the venv was never created (Defect B), so
  `python -m pytest` resolves to the system Python which has no
  Django installed (and on Python 3.12, `import django` fails on
  `from distutils.version import LooseVersion`). Same failure in
  both base and gold runs.

In other words, the synthesizer is being measured through a fully
broken environment. The `fp=false, fn=true` outcome on every instance
is harness noise, not a real synthesizer signal.

## 4. Defect A — actual install failure mode

The user asked for the literal stdout/stderr from a manual rerun of the
editable install. Captured below for `astropy__astropy-13579`.

### Stage 1: as-is

```
$ ./.venv/bin/pip install -e . --no-build-isolation
...
  ModuleNotFoundError: No module named 'extension_helpers'
  [end of output]
error: metadata-generation-failed
```

`astropy/pyproject.toml` declares its build-system requires:
```toml
[build-system]
requires = ["setuptools",
            "setuptools_scm>=6.2",
            "wheel",
            "cython==0.29.30",
            "oldest-supported-numpy",
            "extension-helpers"]
```

Because `--no-build-isolation` is on, pip uses whatever the venv
already has. The driver's pre-install upgrade step (line 189-193) only
adds `pip setuptools wheel cython`, missing `extension-helpers`,
`oldest-supported-numpy`, and `setuptools_scm`. So pip fails before it
even starts building.

### Stage 2: install build-system requires explicitly

```
$ ./.venv/bin/pip install extension-helpers oldest-supported-numpy "cython==0.29.30" "setuptools_scm>=6.2"
$ ./.venv/bin/pip install -e . --no-build-isolation
...
  File "astropy/wcs/setup_package.py", line 12, in <module>
    from setuptools.dep_util import newer_group
  ModuleNotFoundError: No module named 'setuptools.dep_util'
```

`setuptools.dep_util` was removed in setuptools 71. The venv has
setuptools 73.

### Stage 3: pin setuptools < 70

```
$ ./.venv/bin/pip install "setuptools<70"
$ ./.venv/bin/pip install -e . --no-build-isolation
...
  astropy/table/_np_utils.c:6170:34: error:
    'PyThreadState' {aka 'struct _ts'} has no member named 'curexc_traceback'
  ...
  error: command '/usr/bin/x86_64-linux-gnu-gcc' failed with exit code 1
  ERROR: Failed building editable for astropy
```

The .c file generated by Cython 0.29.30 references
`tstate->curexc_traceback`, which was removed in **CPython 3.12**. The
SWE-bench Verified astropy slice predates Python 3.12 support and
ships pre-generated .c files that no longer compile.

### Same problem in Django land

```
$ DJ=.../django__django-10914
$ python3.12 -m venv "$DJ/.venv" && cd "$DJ" && ./.venv/bin/pip install -e .
...
  File ".../setup.py", line 3, in <module>
    from distutils.sysconfig import get_python_lib
  ModuleNotFoundError: No module named 'distutils'
```

`distutils` was removed in Python 3.12. Django 2.2's setup.py imports
it directly. The system has Python 3.11.15 installed, but
`python3.11-venv` is not installed (`python3.11 -m venv` fails with
`ensurepip` non-zero).

### What this means for Defect A's fix scope

The user's Defect A directive said:

> Fix: prep_ok must verify the editable install actually produced an
> importable package.

That fix is small and self-contained, and I will implement it once the
user approves: derive a package name from the repo (e.g., `astropy/astropy
→ astropy`, `django/django → django`), run `<venv_python> -c "import
<name>"` after the install loop, append a `prep_errors` entry on
failure, and gate `prep_ok` on its success.

What that fix **does not do** is make the install actually succeed.
Both classes of failure documented above are Python 3.12 incompatibilities
that no amount of pyproject.toml parsing or build-isolation toggling
can resolve from inside `scripts/eval/`. The harness either needs:
- a Python 3.11 interpreter with the venv module available (`apt
  install python3.11-venv`), and `setup_venv()` updated to prefer it
  for SWE-bench instances; or
- a `uv` / `pyenv`-managed Python toolchain at the repo level; or
- the eval scope narrowed to instances whose source still builds on
  Python 3.12 (none of the ten in the current `instances-50.json` head
  do).

The post-install verification will correctly fail every instance under
the current toolchain, which is the truthful signal. **Reaching the
"both prep_ok=true" smoke criterion is not possible without a
Python-version intervention outside `scripts/eval/`.** Surface this to
the user before attempting to run the smoke.

## 5. Cumulative harness fragility

The Layer 1 eval harness has now had to be repaired four distinct
times to produce a single clean number. Each round cleared the
previous-round symptom and exposed a new upstream symptom one layer
closer to the synthesizer itself. The pattern is signal about Phase 3
readiness, not about synthesizer quality.

1. **Round 1 — validator-removed (pre-Phase 2).** Initial Phase-1
   sweep reported 100% pass because the synth-eval verification step
   had been removed from the property hook. Documented in
   `docs/p1-eval-readiness.md` and
   `docs/p1-eval-results-synthesizer.md`.

2. **Round 2 — `cd`-rewrite and missing venv (Phase 2 step 2).** Synth
   tests in the gold worktree silently `cd`'d back to the base path;
   the base path also had no per-instance venv so `import astropy`
   never succeeded. Fixed by adding `rewriteCommandForWorktree()` and
   the `venvBin` plumbing in `scripts/eval/eval-utils.ts` and
   `swebench-instance-evaluator.ts`.

3. **Round 3 — editable install silent failure + Django workdir path
   bug + gold worktree observability (this session, 2026-05-01).**
   `prep_ok` reported True even when the editable install crashed,
   so downstream eval consumed an environment that could not import
   the package under test. A relative `--workdir` argument never got
   `.resolve()`'d, and the resulting subprocess `cwd` plus relative
   path interaction produced doubly-nested `<repo>/<repo>/.venv` trees
   for every Django instance. The "gold worktree at base_commit"
   complaint turned out to be a misread of the persistent `repo_dir`
   (which is intentionally detached at base_commit by
   `materialize_gold_branch`); no real disconnect existed, but the
   absence of a per-record gold SHA made the assertion non-falsifiable
   from the JSONL alone. Fixed by `Path(args.workdir).resolve()`,
   post-install `python -c "import <pkg>"` verification gating
   `prep_ok`, prep-failure substitution that walks `instances-50.json`
   in order until N pass, and a `goldHeadSha` field on every synth
   record so future audits can verify gold-worktree state directly.

4. **Round 4 — JSONL emit drops captured stdout/stderr and per-attempt
   detail (this session, 2026-05-01).** The round-3 fixes shipped a
   honest harness, and the synth-n10 run produced 4 GENERATED records
   (all `goldPass=false`) and 6 GENERATION_FAILED records. For both
   shapes, the JSONL was undiagnosable: `evaluateInstanceSynthesizer`
   captured the test runs' `stdout`/`stderr` (helpers' `CommandResult`
   already returns them) but the emit shape dropped them on the floor.
   GENERATION_FAILED records carried only `attempts: <int>`, no
   per-attempt validation reason, no per-attempt `testSource`. So
   "synthesizer hit a 3-attempt timeout" was indistinguishable from
   "synthesizer produced wrong tests that failed validation," and a
   `goldPass=false` record was indistinguishable from a test that
   crashed at import-time. Re-running individual instances after the
   fact was no longer possible because the persistent `repo_dir`
   survives but the synthesizer's per-attempt test files at the
   worktree root get unlinked in `evaluateInstanceSynthesizer`'s
   `finally` block (the cleanup that prevents `capture_agent_diff`
   from attributing them to the agent). Fixed in commit `789bb24` by
   extending `SynthEvalRecord` with `baseStdout`/`baseStderr`/
   `goldStdout`/`goldStderr` (8 KiB truncated), `synthReason` (the
   synthesizer's terminal `reason`), and `attemptDetails[]` (per-
   attempt `validation` + `rejectionReason` + `testSourceTruncated`
   to 4 KiB) so each record is self-contained for failure-mode
   classification.

5. **Round 5 — `materialize_gold_branch` destroys the venv it depends on
   (this session, 2026-05-01, surfaced *by* the round-4 instrumentation).**
   The N=5 django-diag re-measurement under round-4 instrumentation
   captured `bash: line 1: python: command not found` in
   `baseStderr` AND `goldStderr` of every GENERATED record, refuting
   the prior `AppRegistryNotReady` hypothesis that motivated this
   session. Root cause is in
   `scripts/eval/p1-run-evals.py::materialize_gold_branch`:

   ```python
   run(["git", "checkout", "-B", GOLD_BRANCH], cwd=repo_dir, check=True)
   subprocess.run(["git", "apply", ...], input=gold_patch, ...)
   run(["git", "add", "-A"], cwd=repo_dir, check=True)        # ← stages .venv/
   run(["git", "...", "commit", ...], cwd=repo_dir, check=True)
   run(["git", "checkout", "--detach", head], cwd=repo_dir, check=True)
   ```

   `setup_venv` runs *before* `materialize_gold_branch` and creates
   `.venv/` with python/pip symlinks under the persistent `repo_dir`.
   The subsequent `git add -A` stages that entire `.venv/` tree (2549
   files in `django__django-10914`'s case) into the gold-branch commit.
   `git checkout --detach $head` then restores the working tree to
   `base_commit` and **deletes** every file that was tracked in
   GOLD_BRANCH but not in base — including `.venv/bin/python`,
   `.venv/bin/python3`, `.venv/bin/pip`, all of them. The persistent
   `.venv/lib/python3.12/site-packages/` keeps its contents (because
   site-packages was populated *before* the checkout), but the bin/
   directory is left holding only `__pycache__/` from when
   `verify_package_import` had run python earlier.

   Mechanical effect: every base- and gold-run shell-out resolves
   `python` against the venv's PATH, finds nothing, exits 127 with
   `python: command not found`. The synthesizer's pre-check (in
   `src/verification/test-synthesizer.ts`) treats any non-zero
   exit as "test fails against base" and accepts the candidate, so
   the JSONL records report `basePass=false` and `goldPass=false`
   on every GENERATED instance — but neither boolean reflects
   anything about the candidate test's logic; both reflect a missing
   interpreter.

   This is why `goldHeadSha` lined up with the gold ref in every
   record (the worktree was correctly checked out at gold) and the
   captured stderr was identical between base and gold runs (same
   missing-python failure either side). The round-4 instrumentation
   is what made this diagnosable from the JSONL alone; without it,
   round 5 would have been another re-run.

   **Not fixed in this session, by design.** The fix is small (use
   `git add` with explicit paths from the gold patch, or stash
   `.venv/` before commit, or add a `.git/info/exclude` entry for
   `.venv/` inside the per-instance repo before staging) but it is
   downstream of the Phase 2 closeout and would constitute "engineer
   the harness past the halt threshold" if applied without a
   subsequent honest-verdict re-eval. It is documented here as a
   precondition for any Phase 3 Layer 1 re-measurement.

The harness has now had five rounds of repairs (four landed, one
documented) to produce diagnosable output. Each round was scoped to
a distinct failure mode in the harness itself, none in the
synthesizer's logic. The pattern is explicit Phase 3 signal: a
"primary verifier" depends on observability infrastructure that the
eval harness has been ad-hoc-ing into existence one round at a time,
and production wiring needs that infrastructure designed up-front
rather than discovered through breakage.

### Why this is a Phase 3 signal, not a synthesizer signal

The synthesizer has not been measured cleanly yet, but the four
rounds above have all been about the harness — the test-execution
shell, the workdir path arithmetic, the venv lifecycle, the prep
truthfulness, the observability of intermediate state. None has been
about the synthesizer's reasoning or test quality. That is the
signal: the production-deployment story for the synthesizer needs a
different infrastructure than the eval harness has been ad-hoc'd into.

What the harness assumes (and what production cannot):
- A long-lived per-instance `repo_dir` reused across runs. In
  production, each user task runs in a fresh worktree with fresh
  state; nothing carries over.
- A pre-installed `.venv` per instance. In production, the user
  brings their own environment; the synthesizer must not depend on
  the harness's dependency-installation step.
- A `goldPatchRef` branch in the same repo as the candidate test. In
  production there is no gold patch; the synthesizer's success
  criterion is "the candidate test catches the bug in the agent's
  patch" not "passes against a known-good fix."

What production needs that the harness does not exercise:
- The synthesizer running against an arbitrary user repo with no
  pre-prepped venv, no gold ref, no instance-id metadata.
- The candidate test's failure mode being interpreted by downstream
  layers (property gate, cheat detector) without a trusted "gold
  passes here" anchor.
- Test isolation when the candidate test is dropped into a real,
  potentially dirty working tree the user is also editing.

### Design invariants the next round should establish

Before any further Layer 1 sweep, the harness needs three
non-negotiable invariants. The current code violates each:

1. **Workdir paths are always absolute.** No `Path(arg)` without a
   `.resolve()`. Subprocess `cwd` plus path-argument interactions
   must be tested with at least one case where the parent CWD differs
   from the workdir.
2. **`prep_ok ⇔ "candidate environment is usable for the eval."**
   Currently fixed by gating on `import <pkg>` from outside the repo;
   the rule is the package must be importable in the same venv the
   eval will use. No more reporting `prep_ok=true` for venvs that
   cannot run the synthesized test.
3. **A clear Python-version contract.** SWE-bench Verified instances
   were collected against pre-Python-3.12 toolchains; the host
   default Python 3.12 is not a usable target for any of them. The
   harness either (a) requires a Python 3.11 venv module on the host
   and uses it, (b) ships a `uv`/`pyenv`-managed toolchain at the
   repo level, or (c) declares the Python-version mismatch up front
   and the eval results doc filters its corpus accordingly. The
   round-3 fix takes path (c): the substitution logic skips
   instances that fail import verification, and the run summary
   records every skip.

### What "smoke can pass" requires the user to decide

The round-3 fixes make the harness honest about its limitations but
do not, on their own, produce a clean Layer 1 number on this host.
SWE-bench Verified's ten-instance head is entirely Python 3.11-or-
older code, and Python 3.11's `venv` module is not installed on the
machine (`apt install python3.11-venv` is required and was out of
scope this session). Until either Python 3.11 is wired into
`setup_venv()` or the smoke is repointed at instances whose source
still builds on 3.12, the smoke will accept zero instances and the
synth JSONL will be empty.

This is the Phase 3 conversation: pick a Python toolchain story, then
re-run. The harness changes from this round are pre-conditions for
that conversation, not solutions to it.

## 6. Proposed fixes (for review, not for implementation in this session)

### Defect A
1. After the editable-install loop, derive the import name from
   `task["repo"]` (split on `/`, take the second segment, lowercase).
2. Run `subprocess.run([str(venv_python), "-c", f"import {name}"], ...)`.
3. On non-zero exit, append a structured `prep_errors` entry that
   includes the captured stderr, and set `prep_ok=false`.
4. Optionally: parse `pyproject.toml`'s `[build-system].requires` and
   pip-install those before the editable-install loop. This will help
   pure-Python packages but not Cython-generated C that hits Python
   3.12 ABI removals — flag the limitation in a comment.

### Defect B
1. Resolve `args.workdir` to an absolute path immediately on parse:
   `workdir = (Path(args.workdir).resolve() if args.workdir else out_dir / "workspaces")`.
   This is the minimal, root-cause fix.
2. Independently, audit `setup_venv` for the early-return-on-existing-broken-venv
   case: if `.venv/bin/python3` exists but the package is not
   importable, the loop should re-attempt the install, not skip it.
   This is what makes prep records idempotent.
3. Optionally: change `clone_repo`'s reuse path to also call
   `git checkout --detach <base_commit>` defensively, so a workdir
   that was left in a different state by a partial run gets reset.

### Defect C
No fix needed. Update the user prompt / runbook to document that the
gold worktree is temporary, lives under `/tmp/swarm-eval-worktree-*`,
and that the persistent `repo_dir` is correctly left detached at
`base_commit` after `materialize_gold_branch()`. If post-mortem
debugging of the gold-path test execution is desired, add a
`--keep-worktrees` flag to `defaultWithWorktree` that suppresses the
finally-block cleanup. This is a debug-only feature, not a fix.

## 7. Smoke-pass feasibility

Per the prompt: smoke needs both instances `prep_ok=true`, both
`goldPass` non-null, and at least one `fp=false ∧ fn=false`. With the
fixes above applied, the picture on the current host is:

- Defect B fix → relative-workdir bug gone, Django venvs created
  correctly. But the editable install still fails because Django 2.2's
  `setup.py` imports `distutils`.
- Defect A fix → import verification correctly fails Django on Python
  3.12, so `prep_ok=false` and the instance reports the truthful
  "package not importable" failure. **`prep_ok=true` not achievable**
  for django__django-10914 on Python 3.12.
- Astropy `astropy__astropy-13579` fails for an analogous Python 3.12
  C-API reason. `prep_ok=true` not achievable.

The smoke as defined cannot pass on the current toolchain regardless
of the fixes. Recommended path: halt before running the smoke, ask
the user whether to (a) install `python3.11-venv` and re-target the
driver to use Python 3.11 explicitly, or (b) substitute different
SWE-bench instances whose source still builds on Python 3.12, or (c)
treat the smoke as a "known-fail with truthful prep_errors" sanity
check rather than a pass/fail gate.

## 8. Resolution

All harness rounds documented in this diagnostic and discovered
since are now fixed. Recorded here as the canonical resolution log
so future eval failures can quickly distinguish "we already saw this
shape" from "this is a new round."

| Round | Symptom | Root cause | Fix commit |
|---|---|---|---|
| 1 | 100% pass on Phase 1 sweep | Validator step removed from property hook | (pre-Phase-2) |
| 2 | `goldPass=false` on every GENERATED instance; tests imported the wrong package | Synthesizer `cd <basePath>` rewrote gold worktree's cwd; no per-instance venv plumbed through | (Phase 2 step 2) `rewriteCommandForWorktree` and `wrapCommandWithVenv` plus `venvBin` plumbing in `swebench-instance-evaluator.ts` |
| 3 | Editable-install failures silently passed `prep_ok`; relative `--workdir` produced doubly-nested `<repo>/<repo>/.venv` trees on Django; gold-worktree state non-falsifiable from JSONL | (a) `prep_ok` only checked `bool(venv_bin) and bool(gold_branch)`; (b) `args.workdir` not resolved; (c) gold worktree HEAD not captured | `093a84c` (Defects A + B), `ff6aca4` (gold HEAD instrumentation) |
| 4 | Per-record failure-mode classification was impossible | JSONL only carried status; no captured stderr | (Phase 2 instrumentation, commit `789bb24`) `baseStdout`/`baseStderr`/`goldStdout`/`goldStderr` (8 KiB truncated), `synthReason`, `attemptDetails[]` |
| 5 | `goldPass=false` on every Django GENERATED record; `bash: line 1: python: command not found` in `baseStderr` AND `goldStderr` | `materialize_gold_branch`'s `git add -A` after `setup_venv` staged untracked `.venv/` into the gold-branch commit; final `git checkout --detach <head>` deleted the venv from the working tree | `73e258a` (`git apply --index` replaces the `git apply` + `git add -A` shape) |
| 6 | 4/10 GENERATION_FAILED on multi-repo eval, all with `wallClockMs=360s` (3 × 120 s adapter-stall × 3 attempts) | Synthesizer's default `timeoutMs=120_000` overrode the Claude Code adapter's own `STALL_TIMEOUT_MS=600_000` budget; hard SWE-bench prompts produce no stdout for 2-5 minutes during reasoning and got SIGKILLed before emitting the candidate JSON | `344fe22` (`DEFAULT_TIMEOUT_MS=600_000` exported alongside `synthesizeRegressionTest`; default raised to match the adapter's expectation) |
| 7 | After framework-aware placement made Django runtests actually find tests, all 3 Django records had `basePass=false ∧ goldPass=false` with character-for-character identical `baseStderr` and `goldStderr` — gold reading base-state imports despite the worktree-add | `python tests/runtests.py` puts the script's directory (`tests/`) on `sys.path[0]`, NOT cwd. `import django` fell through to site-packages where the persistent venv's editable-install `.pth` pinned the resolution to the persistent base repo's `django/`. The gold worktree's gold-patched `django/` was never on sys.path | `8c97955` (`wrapCommandWithVenv` extended to prepend `export PYTHONPATH=<cwd>:$PYTHONPATH` so the cwd — gold worktree on gold runs, persistent repo on base runs — wins over the `.pth`) |

Validation that the rounds are closed:

- Round 7 verified by the multi-repo Layer 1 round-7 re-eval
  (`docs/p1-eval-fixtures/runs/v7-critical-path/multi-repo-l1-rerun-2.5-round7/`).
  All 10 instances `basePass=false ∧ goldPass=true ∧ fp=false ∧
  fn=false`. FP=0% PASS, FN=0% PASS — the first run that clears
  both v7 halt thresholds across a multi-repo corpus.
- Rounds 5 + 6 jointly verified earlier by the multi-repo Layer 1
  sweep (`.../multi-repo-l1-rerun/`): 10/10 GENERATED, no
  `python: command not found`, no `Process killed after 120s`. The
  residual 4/10 fn=true records there were the synthesizer-side
  modes that session 2.5's `4667187` redesign and round-7's
  `8c97955` wrap eliminated.
- Rounds 1-4 verified before the round-5 fix landed; the closure is
  recorded in `docs/p1-eval-results-synthesizer.md`'s historical
  Phase 2 section.

### Phase 3 readiness: harness is no longer the blocker

Phase 2's "harness is fragile in unanticipated ways" caveat applied
through round 5. The session 2.5 multi-repo re-eval chain surfaced
two more rounds (6, 7) that weren't visible until the prior round's
fix unblocked the next failure mode. After all seven rounds landed,
the harness produced a clean run with FP=0% and FN=0% across 4
distinct repos. The remaining Layer 1 work is upstream of the
harness (synthesizer prompts, framework profiles, acceptance
criteria — all addressed in `4667187`); future Layer 1 sweeps
should expect a stable harness baseline. The "harness is fragile in
ways the v7 plan did not anticipate" caveat is closed; the harness
has reached the "boring infrastructure" phase the plan assumed.
