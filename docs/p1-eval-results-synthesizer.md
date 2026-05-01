# Layer 1 Synthesizer Eval Results

Date: 2026-05-02 (multi-repo amendment); 2026-05-01 (original Phase 2
write-up below).
Status: **FN halt threshold still breached on the multi-repo corpus
(40%, threshold 10%). Breach is now classified as synthesizer-side, not
harness-side.** FP halt threshold cleared at 0% (threshold 15%).

## v7 critical-path session 2 — multi-repo amendment (2026-05-02)

The Phase 2 write-up below records FN = 100% on a Django-only corpus,
attributed to round-5 harness defects (venv binaries deleted by
`materialize_gold_branch`'s `git add -A` flow). Two follow-up fixes
landed before this measurement:

- **Round-5 (commit `73e258a`, session 1):** replaced the `git apply` +
  `git add -A` shape in `materialize_gold_branch` with `git apply
  --index`. The patch is staged inline; untracked `.venv/` is no longer
  scanned, so it cannot be tracked into the gold branch and cannot be
  deleted by the post-commit `git checkout --detach`. Validated by the
  session-1 smoke (sympy + django, both `goldPass=true`).
- **Round-6 (commit `344fe22`, this session):** raised the
  synthesizer's default `timeoutMs` from 120 s to 600 s
  (`DEFAULT_TIMEOUT_MS`), aligning with `claude-code-adapter.ts`'s
  `STALL_TIMEOUT_MS`. The Phase 2 corpus's six `GENERATION_FAILED`
  records were `Process killed after 120s of no output (stall
  timeout)` — Claude Code spends several minutes on internal reasoning
  for hard prompts and was being killed before producing the candidate
  JSON. With the longer ceiling, all 10 multi-repo instances produced
  a candidate; aggregate FN dropped from 60% (first multi-repo run,
  pre-fix) to 40% (rerun, post-fix) on the same corpus.

### Multi-repo corpus

`benchmarks/swe-bench/instances-multi-repo-15.json` enumerates 15
candidate instances across 8 repos chosen for Python 3.12
compatibility. Five fail prep on the host's Python 3.12 toolchain
(both pytest editable installs, plus the Cython-removed-distutils
issue on requests / scikit-learn / matplotlib) and are recorded under
`summary.skipped_for_prep_failure`. The actually measured corpus is
**10 instances across 4 repos**:

| Repo | Instances |
|---|---|
| django | django__django-10914, django__django-11099, django__django-15022 |
| sympy | sympy__sympy-23950, sympy__sympy-24443, sympy__sympy-24661 |
| sphinx-doc | sphinx-doc__sphinx-9281, sphinx-doc__sphinx-10466, sphinx-doc__sphinx-10673 |
| pylint-dev | pylint-dev__pylint-6528 |

Run artifacts (gitignored under `runs/`):
`docs/p1-eval-fixtures/runs/v7-critical-path/multi-repo-l1/` (pre-
round-6) and `…/multi-repo-l1-rerun/` (post-round-6).

### Headline metrics — multi-repo, post-round-6

```
n = 10 (4 distinct repos)
status: GENERATED=10, GENERATION_FAILED=0, AMBIGUOUS_GOAL=0, ERROR=0
basePass=true: 0       (all candidates fail against base — good)
basePass=false: 10
goldPass=true: 6
goldPass=false: 4

FP = 0/10 = 0%         halt: > 15%   PASS
FN = 4/10 = 40%        halt: > 10%   BREACH
```

Per-repo:

| Repo | n | GENERATED | fp | fn |
|---|---:|---:|---:|---:|
| django | 3 | 3 | 0 | 2 |
| sympy | 3 | 3 | 0 | 0 |
| sphinx-doc | 3 | 3 | 0 | 1 |
| pylint-dev | 1 | 1 | 0 | 1 |

Sympy is clean (3/3 GENERATED, all goldPass=true). The breach is
concentrated in django (2/3) plus one each from sphinx-doc and
pylint-dev.

### Failure-mode classification of the 4 fn=true records

The round-4 instrumentation (`baseStdout`/`baseStderr`/`goldStdout`/
`goldStderr`/`attemptDetails`) plus the round-3 `goldHeadSha` was
sufficient to classify each fn=true record from JSONL alone, no
re-run needed.

**1. django__django-10914 (Django framework requirement)**

`testCommand: python tests/runtests.py file_storage.test_default_upload_permissions --verbosity=2`
Both base and gold stderr:
`ModuleNotFoundError: No module named 'file_storage.test_default_upload_permissions'`.

The synthesizer chose Django's own `tests/runtests.py` harness — the
canonical way to run a Django test — and named the test module by
dotted path. But Django's loader expects the file at
`tests/file_storage/test_default_upload_permissions.py`, while the
synthesizer placed it at the repo root as
`swarm-synth-attempt-1-test_default_upload_permissions.py`. The same
shape on both base and gold confirms it is not a gold-branch issue
but a synthesizer file-placement-vs-test-runner-convention mismatch.

**2. django__django-15022 (Django framework requirement)**

`testCommand: python tests/runtests.py admin_changelist.test_search_joins`
Identical mode: Django runtests.py needs the file at
`tests/admin_changelist/test_search_joins.py`, synthesizer placed it
at repo root.

**3. sphinx-doc__sphinx-9281 (synthesized test has a collection-time error)**

`testCommand: python -m pytest swarm-synth-attempt-1-test_regression_9281_enum_defaults.py -v`
baseStdout / goldStdout: `Interrupted: 1 error during collection`.
pytest aborts before any test executes; the candidate file has an
import-time or fixture-discovery error. The synthesizer's
`testSource` is structurally invalid for sphinx's test environment.

**4. pylint-dev__pylint-6528 (synthesizer hardcoded relative venv path)**

`testCommand: .venv/bin/python -m pytest swarm-synth-attempt-1-test_recursive_ignore.py -v`
baseStdout shows the test ran (and 2 of 4 sub-cases passed against
base — basePass=false because not all sub-cases passed). goldStderr:
`bash: line 1: .venv/bin/python: No such file or directory`. The gold
worktree lives in `/tmp/swarm-eval-worktree-*` (per
`defaultWithWorktree`); the persistent repo's `.venv/` is not copied
in. The synthesizer hardcoded a relative path that resolves only in
the persistent repo, not in the temporary gold worktree. PATH-wrapping
via `wrapCommandWithVenv` does not help because the literal
`.venv/bin/python` is interpreted as a path, not as a name to look up
on PATH.

### Verdict

All four fn=true records are synthesizer-side: 2 framework-convention
mismatches, 1 structural test-source error, 1 prompt bug (relative
venv path baked into testCommand). The harness is not the
bottleneck. The breach is real and the headline is honest.

Per the v7 critical-path directive ("If it's synthesizer-side,
document and halt — synthesizer redesign is its own session"), the
next-session work is a synthesizer-side change: prompt edits to (a)
match each repo's test-runner placement convention, (b) prevent
collection-time errors from landing as accepted candidates, (c)
forbid relative venv paths in `testCommand`. None of these is in
scope for this session.

### Adapter non-determinism observed in re-runs

Same instance, same prompt, same harness produced different
`testSource` and different `goldPass` between the pre-round-6 run
and the post-round-6 rerun on three instances:

| Instance | Pre-round-6 | Post-round-6 |
|---|---|---|
| django__django-10914 | GENERATED, goldPass=true | GENERATED, goldPass=false (Django framework) |
| django__django-11099 | GENERATED, goldPass=false | GENERATED, goldPass=true |
| sympy__sympy-23950 | GENERATED, goldPass=false | GENERATED, goldPass=true |

The aggregate FN moves only because adapter non-determinism flips
particular instances; the underlying class of synth-side weaknesses
is consistent across runs. The next-session synth-quality work
should not assume any single instance's outcome is reproducible
without explicit seed control on the adapter.

### Cost

| Run | Instances | Wall-clock | Token cost (est.) |
|---|---|---|---|
| multi-repo-l1 (pre-round-6) | 10 measured + 5 prep-skipped | ~47 min | ~$3.0 |
| multi-repo-l1-rerun (post-round-6) | 10 measured + 5 prep-skipped | ~26 min | ~$2.0 |

Cumulative across all sessions: ~$8 of $15 ceiling. The rerun came in
faster than the first run because all 10 instances completed in 1
attempt (no 3 × adapter-stall multiplier).

### Phase 2 → multi-repo, summary

The Phase 2 100% FN headline was harness-driven (round-5). Round-5 fix
exposed adapter-stall (round-6). Round-6 fix exposed synthesizer-side
quality issues. After two scope-bounded fixes, Layer 1's residual
breach (FN = 40%) is no longer attributable to harness defects and is
the legitimate measurement to act on going forward.

The Phase 2 corpus narrative below is preserved as historical record;
its harness-state attribution still holds, just with the round-5 fix
no longer pending.

---

# Phase 2 — Layer 1 Synthesizer Eval Results (historical, 2026-05-01)

Date: 2026-05-01.
Status: **HALT THRESHOLD BREACHED.** Layer 1 fails the v7 FN halt
threshold (10%) on the Django-only effective corpus (observed FN =
100%). Headline numbers are honest; failure-mode interpretation is
not, because of a round-5 harness defect surfaced by the round-4
instrumentation (see "What the captured stderr actually shows" below).

Eval driver: `scripts/eval/p1-run-evals.py`.
Run artifacts (gitignored under `runs/`):

- `docs/p1-eval-fixtures/runs/phase-2/synth-n10/` — the
  10-instance round-3 sweep (4 GENERATED + 6 GENERATION_FAILED, all
  fn=true).
- `docs/p1-eval-fixtures/runs/phase-2/django-diag/` — the 5-instance
  round-4-instrumented re-measurement (4 GENERATED + 1
  GENERATION_FAILED, all fn=true).

## Final corpus

The "10 instances of `instances-50.json[0:10]`" plan was filtered by
the round-3 import-verify gate down to **10 Django** for synth-n10
and **5 Django** for django-diag. The two astropy instances (positions
0 and 1 in the manifest) failed `verify_package_import` with
`error: subprocess-exited-with-error / × Preparing editable metadata
(pyproject.toml) did not run successfully` on Python 3.12, identical
across both runs, and were skipped by the `prep_failure_substitution`
loop. Resulting corpus (Python-3.12-prep-passing only):

| # | Instance ID | synth-n10 | django-diag |
|---|---|---|---|
| 1 | django__django-10914 | GENERATED, fn=true | GENERATED, fn=true |
| 2 | django__django-10999 | GENERATION_FAILED, fn=true | GENERATED, fn=true |
| 3 | django__django-11099 | GENERATED, fn=true | GENERATED, fn=true |
| 4 | django__django-11490 | GENERATED, fn=true | GENERATION_FAILED, fn=true |
| 5 | django__django-11951 | GENERATION_FAILED, fn=true | GENERATED, fn=true |
| 6 | django__django-11964 | GENERATION_FAILED, fn=true | not in run |
| 7 | django__django-12155 | GENERATION_FAILED, fn=true | not in run |
| 8 | django__django-12419 | GENERATED, fn=true | not in run |
| 9 | django__django-13028 | GENERATION_FAILED, fn=true | not in run |
| 10 | django__django-13033 | GENERATION_FAILED, fn=true | not in run |

The django-diag re-measurement covered the head of the synth-n10
corpus to maximize cross-run diagnostic comparability under the round-4
instrumentation. The status differences for instances 2, 4, and 5
between the two runs (e.g., 10999 went GENERATION_FAILED→GENERATED,
11490 went GENERATED→GENERATION_FAILED) reflect Claude Code adapter
non-determinism on stall-prone Django prompts; the underlying
fn-driving root cause is the same in both runs.

## Headline metrics — synth-n10 (the v7 number)

```
n = 10
status: GENERATED=4, GENERATION_FAILED=6, AMBIGUOUS_GOAL=0, ERROR=0
basePass=true: 0       (FP candidates)
basePass=false: 4
basePass=null: 6       (no test executed; status != GENERATED)
goldPass=true: 0       (passes against gold = correct test)
goldPass=false: 4
goldPass=null: 6

FP = 0/4 = 0%          halt: > 15%   PASS
FN = 10/10 = 100%      halt: > 10%   BREACH
```

The FP=0% number is structurally trivial here (every basePass is
`false` because the test didn't actually run; see below). The FN
breach is real with respect to the v7 gate, even though the failure
mechanism is not "the synthesizer produced a wrong test."

Halt-threshold status: **FN halt tripped on first measurement.**

## Per-record failure-mode breakdown — django-diag (round-4 instrumented)

The round-4 JSONL emit (commit `789bb24`) added `baseStdout`,
`baseStderr`, `goldStdout`, `goldStderr` (8 KiB truncated),
`synthReason`, and `attemptDetails[]` to every record. That is what
made the per-record mode classification possible; the synth-n10
JSONL had none of these fields and is uninspectable beyond the
status string.

| Instance | Status | basePass | goldPass | Captured stderr (both runs, last line) | Mode |
|---|---|---|---|---|---|
| django__django-10914 | GENERATED | false | false | `bash: line 1: python: command not found` | venv-broken |
| django__django-10999 | GENERATED | false | false | `bash: line 1: python: command not found` | venv-broken |
| django__django-11099 | GENERATED | false | false | `bash: line 1: python: command not found` | venv-broken |
| django__django-11490 | GENERATION_FAILED | n/a | n/a | n/a (no test ran); `attemptDetails[1..3].rejectionReason = "Process killed after 120s of no output (stall timeout)"` | adapter-stall |
| django__django-11951 | GENERATED | false | false | `bash: line 1: python: command not found` | venv-broken |

Two distinct modes. Neither is "the synthesizer produced a test that
fails against the gold patch."

### Mode 1: venv-broken (4/5 records)

The captured stderr is identical, character-for-character, in
`baseStderr` and `goldStderr` of every GENERATED record:

```
bash: line 1: python: command not found
```

The synthesizer's testCommand (e.g.
`python -m pytest swarm-synth-attempt-1-test_username_trailing_newline.py -v`,
`python tests/runtests.py file_storage.test_default_upload_permissions --verbosity=2`)
shells out via `bash -lc` with PATH wrapped to the per-instance
`.venv/bin`. That directory contains no `python`, no `python3`, no
`pip` — only an empty `__pycache__/`. The system PATH on this
host has no `/usr/bin/python` either (Ubuntu ships `python3` only).

Direct evidence:

```
$ ls docs/p1-eval-fixtures/runs/phase-2/django-diag/workspaces/django__django-10914/.venv/bin/
__pycache__
$ git -C docs/p1-eval-fixtures/runs/phase-2/django-diag/workspaces/django__django-10914 \
      ls-tree -r swarm-gold-eval -- .venv/bin/ | grep -E "python|pip"
100755 blob ...    .venv/bin/pip
100755 blob ...    .venv/bin/pip3
100755 blob ...    .venv/bin/pip3.12
120000 blob ...    .venv/bin/python
120000 blob ...    .venv/bin/python3
120000 blob ...    .venv/bin/python3.12
```

The python/pip symlinks exist *in the gold-branch commit's tree* but
not on the working tree, because `materialize_gold_branch`'s sequence
(`git add -A` -> commit -> `git checkout --detach $head`) tracks the
venv into the gold commit and then removes its files from the working
tree on the way back to base. This is round-5 of the harness fragility
documented in `docs/p1-eval-harness-diagnostic.md`. **The synthesizer's
testSource is irrelevant to this failure mode**; even a perfectly
written regression test would exit 127 because the interpreter is
gone.

The hypothesis from the prompt that motivated this session ("the test
would fail at import-time on `from django.core.files.base import
ContentFile` with `AppRegistryNotReady`") is **refuted**. The test
never gets to import-time; the shell can't find `python` to start it.

### Mode 2: adapter-stall (1/5 records)

`django__django-11490` got 3 attempts each terminated with:

```
attemptDetails[i].rejectionReason = "\nProcess killed after 120s of no output (stall timeout)"
```

This is the Claude Code adapter's stall timeout firing. Each attempt
had `adapterExitCode=1`, `validation='rejected'`, no candidate
(`testSourceTruncated` is unset). After 3 such attempts the
synthesizer returned `GENERATION_FAILED` per its logic in
`src/verification/test-synthesizer.ts:247`. Total wallClockMs =
360146 ms (3 × 120 s).

The synth-n10 run's 6 GENERATION_FAILED records show the same shape
in their `wallClockMs`: 360146, 360151, 360145, 360148, 360159,
360151 ms (3 × 120 s adapter-stall, plus a few ms of overhead). This
is consistent with the same adapter-stall mode applying to all of
them. (The synth-n10 records lack the `attemptDetails` field that
would confirm directly; round-4 instrumentation landed after that
run.)

The adapter-stall mode is independent of the venv-broken mode. It
fires before the eval ever shells out a test command.

## What the captured stderr actually shows

The instrumentation worked. Specifically:

1. The round-4 JSONL emit captured `bash: python: command not found`
   in `baseStderr` and `goldStderr` of every GENERATED record. That
   sentence was the first cross-cutting evidence in any of the four
   harness-repair rounds.
2. The hypothesis the prompt motivated (`AppRegistryNotReady` from
   `settings.configure(...)` bootstrap) was **refuted by the data**.
   That is the value of instrumentation that prior rounds did not
   have: a hypothesis can be eliminated rather than litigated.
3. The captured `goldHeadSha` (round-3 instrumentation) confirms in
   every record that the gold worktree was checked out at the
   correct ref. The gold-worktree-state question is now also
   refuted as a candidate root cause. The persistent repo's
   destruction of its own `.venv` is what propagates into the
   temporary gold worktree as well, because the venv path passed to
   `wrapCommandWithVenv` is the persistent `.venv/bin` (not the
   worktree's `.venv/bin`).

## Honest verdict

**Layer 1 fails the v7 FN halt threshold on the Django subset of
SWE-bench Verified.** Observed FN = 100%, halt threshold = 10%. This
is the headline number and the reason Phase 3 cannot begin from this
closeout.

**The mechanism behind the breach is not synthesizer quality; it is
harness round-5.** Every test invocation in the captured corpus
exited 127 because the per-instance `.venv` had its python/pip
binaries deleted by `materialize_gold_branch`'s `git add -A` /
`git checkout --detach $head` sequence. The synthesizer's reasoning,
prompt, and testSource on these records were never exercised against
a working interpreter.

**The single sympy smoke pass earlier in Phase 2** (documented in
`docs/p1-real-data-findings.md`) demonstrates the synthesizer can
produce a discriminating test on at least one repo. Whether the
Django failures are "synthesizer is Django-incompatible," "synthesizer
is generally weak on test-runner-bootstrapped repos," or "synthesizer
is fine and only the harness was broken" **cannot be answered from
this corpus** because the harness defect masked the synthesizer's
actual output.

What this session **does not** establish:
- That the synthesizer prompt needs Django-specific tuning. The
  testSource the synthesizer produced for `django__django-10914`
  (visible in the synth-n10 JSONL because basePass and goldPass are
  measured *after* the venv is broken; the test source is whatever
  the synthesizer emitted) bootstraps Django via
  `settings.configure(...)` — that pattern may or may not work in
  Django's actual test layout, but the captured evidence cannot
  distinguish "wrong bootstrap" from "right bootstrap, no
  interpreter to run it."
- That the synthesizer is broadly weak. The corpus was Django-only
  after Python-3.12 prep filtering; one repo is not a generalizable
  signal either way.

What this session **does** establish:
- The v7 FN halt threshold is breached on the Python-3.12-prep-passing
  subset of the first 10 SWE-bench Verified instances.
- The breach is observed under a harness with five distinct
  fragility rounds, four landed and one (round 5) documented but
  not fixed in scope.
- The instrumentation works: the captured `baseStderr`/`goldStderr`/
  `attemptDetails` was sufficient to refute one root-cause hypothesis
  and identify a different one in a single re-run, with no
  re-instrumentation needed.

## Cost

| Run | Instances | Wall-clock | Token cost |
|---|---|---|---|
| synth-n10 (round-3 instrumented) | 10 measured + 2 prep-skipped | ~30 min | ~$3 |
| django-diag (round-4 instrumented) | 5 measured + 2 prep-skipped (2 astropy skipped first, then 5 Django accepted in manifest order) | ~16 min | ~$1 |

Total cumulative: ~$4 of the $15 ceiling. The django-diag re-run came
in at the bottom of the $1.50-2 estimate because 4 of 5 GENERATED
records landed on the first attempt (synthesizer call cost is
per-attempt; single-attempt success is the cheapest path). The single
GENERATION_FAILED record at 3 × 120 s of adapter stall accounted for
~38% of the django-diag wall clock.

## Required before re-measurement

The harness must clear round-5 before any Layer 1 re-eval is
meaningful. Two scope-correct candidate fixes (not implemented in
this session):

1. **Stage explicitly** in `materialize_gold_branch`: replace
   `git add -A` with `git add` on the file paths the gold patch
   touched. The gold patch text already enumerates these in its
   diff hunks; parsing them is a small change.
2. **Exclude `.venv/`** via `.git/info/exclude` (per-repo, not
   committed) before `git add -A`. This is the smaller change and
   keeps the `-A` blast radius for genuinely untracked patch-added
   files. Risk: if a gold patch ever adds something under a
   directory the harness later writes to (e.g., a generated
   migration in `tests/`), exclude entries can shadow it.

After either fix, re-run on a multi-repo corpus (not Django-only) to
distinguish synthesizer-quality from Django-specificity. The current
django-diag corpus is too narrow to generalize from even after the
harness is repaired.

This is Phase-3-readiness work, not Phase-2 closeout work. See
`docs/phase-2-completion.md` for the broader Phase 3 readiness
verdict.
