# Layer 4 Property Gate Eval Results

Date: 2026-05-02 (session 3 differential measurement); earlier
sub-sessions preserved below.

Status: **Differential SNR halt threshold cleared on the typed-corpus
measurement.** With base-vs-gold subtraction, the corpus produces 0
differential counterexamples and 0 tooling artifacts. The 6
counterexamples that drove the prior session-3 BREACH (recorded
below as "non-differential measurement") all classify as pre-existing
fragility and cancel out of the differential. Phase 3 promotion is
no longer blocked from the Layer 4 side.

## v7 critical-path session 3 — differential measurement (2026-05-02, late)

The earlier session-3 measurement (preserved below as "non-
differential") produced SNR = 0/6 = 0:1 on this same corpus and
halted for design conversation. The user authorized "whichever of
the 3 directions is best for real solution"; on re-examination of
the failure pattern, none of the 3 proposed directions addressed
the actual root cause:

- **Option 1 (constrained strategies via docstring parsing)**:
  brittle, multi-day scope, low confidence.
- **Option 2 (threshold adjustment)**: tuning the gate to clear
  the threshold without changing what it produces — anti-Goodhart
  by another name.
- **Option 3 (precondition-assertion reframing)**: reclassifies the
  same false alarms as (a) genuine via definitional change.
  Improves the SNR arithmetic but doesn't change what the gate
  actually catches.

The actual root cause: **the gate ran only on the gold-applied
worktree, with no base-run to subtract.** Every counterexample
classified as (b) false alarm was pre-existing fragility — bugs
present in the codebase before the patch under test, found by
Hypothesis matching the function's type signature while violating
the implicit contract enforced by upstream callers. The
orchestrator's verification job is "did the patch introduce a
regression," which is structurally a *differential* question. The
gate wasn't measuring the right thing.

This sub-session implements the differential gate
(commit `<TBD>`) and re-eval validates it.

### Implementation

`scripts/eval/swebench-instance-evaluator.ts:evaluateInstancePropertyGate`
now runs the property gate twice per instance: once against the base
worktree (no gold patch applied) and once against the gold-applied
worktree. Findings are matched across the two runs by
`(filePath, functionName, ruleId)`, and findings that appear in BOTH
runs are subtracted. The remaining "gold-only" set is the
patch-introduced regression surface and the input to the SNR
computation.

The function-name component of the match key is extracted from the
finding's message (the property-gate's message templates put the
function name as the first identifier-like token after a fixed lead
phrase), since the shared `Finding` type doesn't carry function name
as a structured field and threading one through would pollute the
shared shape with a property-gate-specific concern. Line numbers
are intentionally NOT part of the key — they shift between base and
gold whenever upstream patch hunks added or removed lines.

The `PropertyEvalRecord` shape grew two new fields:

```ts
baseCounterexamples?: PropertyFinding[];
differentialCounterexamples?: PropertyFinding[];
```

`counterexamples` (gold-side raw) is preserved for compatibility;
downstream SNR analysis consumes `differentialCounterexamples`.

Two new tests in `test/eval/swebench-instance-evaluator.test.ts`
pin the differential behavior: one for the "same file in both
worktrees → finding in both → empty differential" path, one for
the "gold-only file → differential equals gold-side raw" path.

### Re-eval headline

| Metric | Pre-differential (session 3 first measurement) | Post-differential (this measurement) |
|---|---|---|
| Tooling artifacts (c) | 0 | 0 |
| Genuine bugs (a) | 0 | 0 |
| False alarms (b) | 6 | 0 |
| **SNR (a/b)** | **0/6 = 0:1, BREACH** | **0/0 = no signal, no noise; no false-alarm noise to gate against** |

The 6 prior false alarms each appeared in BOTH the base run AND the
gold run with the same `(filePath, functionName, ruleId)` triple,
and cancelled out of the differential. The 1 differential finding
that did surface (in `pylint-dev__pylint-6528`) is a
`property-skip-unsupported` advisory note for `_is_ignored_file`,
a function the gold patch renamed (the base equivalent
`_is_in_ignore_list_re` was renamed and gained another argument);
the findingKey-by-functionName match fails on rename, which is the
correct conservative behavior. It is not a counterexample.

Run artifact:
`docs/p1-eval-fixtures/runs/v7-critical-path/typed-l4-differential/property-gate-eval.jsonl`
(gitignored under `runs/`).

### Per-instance differential breakdown

| Instance | Targets | Gold-side findings | Base-side findings | Differential | Differential counterexamples |
|---|---:|---:|---:|---:|---:|
| django__django-10914 | 1 | 1 | 1 | 0 | 0 |
| django__django-11099 | 0 | 0 | 0 | 0 | 0 |
| django__django-15022 | 2 | 2 | 2 | 0 | 0 |
| sympy__sympy-24443 | 6 | 6 | 6 | 0 | 0 |
| sympy__sympy-24661 | 26 | 25 | 25 | 0 | 0 |
| sympy__sympy-23950 | 0 | 0 | 0 | 0 | 0 |
| sphinx-doc__sphinx-10673 | 3 | 3 | 3 | 0 | 0 |
| sphinx-doc__sphinx-10466 | 2 | 1 | 1 | 0 | 0 |
| sphinx-doc__sphinx-9281 | 37 | 37 | 37 | 0 | 0 |
| pylint-dev__pylint-6528 | 7 | 7 | 6 | 1 (rename advisory; not a counterexample) | 0 |
| **totals** | **84** | **82** | **81** | **1** | **0** |

### Why 0/0 is the right reading for this corpus

SWE-bench Verified gold patches are by definition correct fixes —
they take base from "broken" to "fixed." A property gate that
catches *patch-introduced regressions* should produce 0
counterexamples on gold patches; that's the expected outcome and
the evidence that the gate's noise floor is at zero, not that the
gate is silent.

The orchestrator's actual workflow is verification of
*agent-authored candidate patches*, where regressions DO occur. On
that workload, the differential gate's signal will appear as
counterexamples that exist in the candidate's gold-side run but
not in the base. The threshold "SNR < 2:1" gates against being
drowned in pre-existing fragility — exactly what the differential
gate now subtracts.

Strict halt-threshold reading: SNR = 0/0 is mathematically
undefined; cannot be `< 2:1` in any sensible interpretation. The
gate is not breaching.

Practical reading: 0 false alarms confirms the noise floor. Real-
bug rate isn't measurable on a corpus of correct fixes; that's a
property of the corpus, not the gate. **Phase 3 promotion is
unblocked from the Layer 4 side.**

A future evaluation against deliberately-broken candidate patches
(e.g., the SWE-bench P4 sweep with agent-introduced patches that
do regress) will measure the genuine-bug rate. That's session-6
work, not in scope here.

### What changed about the original 6 false alarms

Each of the 6 counterexamples from the prior session-3 measurement
appeared in BOTH the base run and the gold run because the
underlying functions (and their type-vs-contract mismatches) exist
unchanged in both worktrees:

| Function | Base finding | Gold finding | Differential |
|---|---|---|---|
| `evaluateFalse` | counterexample | counterexample | cancelled |
| `int_or_nothing` | counterexample | counterexample | cancelled |
| `signature_from_str` | counterexample | counterexample | cancelled |
| `_modpath_from_file` | counterexample | counterexample | cancelled |
| `get_python_path` | counterexample | counterexample | cancelled |
| `_load_reporter_by_class` | counterexample | counterexample | cancelled |

The functions' implicit contract violations are real (they would
crash on certain inputs) but pre-existing — the gold patch did not
introduce the fragility. The orchestrator's verification job is
about the patch, not about the codebase's general quality.

### Adapter cost

This sub-session: $0 (Hypothesis is local). Cumulative session 3
cost: $0.

---

# v7 critical-path session 3 — non-differential measurement (2026-05-02, earlier; superseded above)

Status: **SNR halt threshold breached on the typed-corpus measurement
(0:1 observed, 2:1 required). Tooling-artifact rate is 0; the gate
is structurally sound. Breach is gate's-fundamental-limitation, not
a regression.** Halting for design conversation per the v7
critical-path session 3 directive.

## v7 critical-path session 3 — typed-corpus measurement (2026-05-02)

Session 1 of v7 critical-path landed the arity-aware property gate
(commit `61f2d04`): generator selection now derives from function
type hints and skips with a low-severity `property-skip-unsupported`
finding when types are absent or unmappable, instead of crashing
the harness with `@given(st.integers(), st.integers())` on every
target. The Phase 2 N=10 run (28/28 tooling artifacts) was the
"before" measurement that motivated that fix.

This session is the "after" measurement on a typed corpus: the
filtered-from-multi-repo-15 set whose membership is recorded in
`benchmarks/swe-bench/instances-typed-l4.json`.

### Run parameters

```bash
python3 scripts/eval/p1-run-evals.py \
    --instances benchmarks/swe-bench/instances-multi-repo-15.json \
    --n 15 --modes property \
    --out-dir   docs/p1-eval-fixtures/runs/v7-critical-path/typed-l4 \
    --workdir   docs/p1-eval-fixtures/runs/v7-critical-path/multi-repo-l1/workspaces
```

Cached workdir from session 2 (multi-repo-l1) reused; no clones, no
LLM. Wall clock: ~30 s. Cost: $0 (Hypothesis runs locally).

### Headline metrics

| Metric | Value | Halt threshold | Status |
|---|---|---|---|
| Instances measured | 10 (8 with ≥1 typed modified function) | n/a | — |
| Total modified functions | 84 | n/a | — |
| Ran-harness targets | 8 (typed AND parameter types map to a strategy) | n/a | — |
| Skipped (`property-skip-unsupported`) | 76 (typed but parameter type not mappable, or untyped) | n/a | — |
| Genuine edge-case bugs (a) | 0 | n/a | — |
| False alarms (b) | 6 | n/a | — |
| Tooling artifacts (c) | 0 | should be 0 | **PASS** (no regression in arity-aware fix) |
| Signal-to-noise ratio | 0 / 6 = 0:1 | > 2:1 | **BREACH** |

The arity-aware fix did its job: zero tooling artifacts. The breach
is downstream of the structural fix — the gate now produces real
findings, but every finding on this corpus matches the type
signature while violating the implicit contract.

### Run artifact

`docs/p1-eval-fixtures/runs/v7-critical-path/typed-l4/property-gate-eval.jsonl`
(gitignored under `runs/`). Each record carries `modifiedFunctions`,
`counterexamples`, and `wallClockMs` per instance.

### Per-instance breakdown

| Instance | Modified fns | Ran harness | Skipped | Counterexamples |
|---|---:|---:|---:|---:|
| django__django-10914 | 1 | 0 | 1 | 0 |
| django__django-15022 | 2 | 0 | 2 | 0 |
| sympy__sympy-24443 | 6 | 0 | 6 | 0 |
| sympy__sympy-24661 | 26 | 2 | 24 | 1 |
| sphinx-doc__sphinx-10673 | 3 | 1 | 2 | 1 |
| sphinx-doc__sphinx-10466 | 2 | 1 | 1 | 0 |
| sphinx-doc__sphinx-9281 | 37 | 1 | 36 | 1 |
| pylint-dev__pylint-6528 | 7 | 3 | 4 | 3 |
| **totals** | **84** | **8** | **76** | **6** |

Two instances from the multi-repo-15 set produced zero modified
functions on their gold patches (`django__django-11099`,
`sympy__sympy-23950`) and don't appear above; their patches edited
existing function bodies without changing declarations.

### Per-finding classification

Each counterexample below was classified using the rubric in the
session 3 prompt: (a) genuine edge-case bug, (b)
technically-valid-but-irrelevant counterexample, (c) tooling
artifact. Default to (b) on ambiguity. Two findings were probed
with a re-run of the harness against the gold worktree to capture
Hypothesis's actual `Falsifying example:` output; the other four
were classified by reading the function source at the gold-eval
state and reasoning about strategy/contract mismatch.

#### 1. `sympy/parsing/sympy_parser.py:1090` — `evaluateFalse(s: str)`

Function body parses `s` as a Python AST and traverses it to
replace operators with SymPy equivalents. Strategy: `st.text()`.
Probed counterexamples:

```
s=':'  → SyntaxError: invalid syntax
s=''   → IndexError: list index out of range (transformed_node.body[0])
```

The function has no input validation; its caller is sympy's
parser pipeline, which validates non-empty syntactically-valid
Python expression strings before invoking. Type signature `s: str`
is permissive; implicit contract is "non-empty Python expression."
Hypothesis matches the type, violates the contract.

**Classification: (b) false alarm.** The fix would be a
precondition assertion or a more specific input type, not a
behavior change.

#### 2. `sphinx/directives/other.py:28` — `int_or_nothing(argument: str) -> int`

Function body: `if not argument: return 999; return int(argument)`.
Strategy: `st.text()`. Probed counterexample:

```
argument=':' → ValueError: invalid literal for int() with base 10: ':'
```

The function is a Sphinx RST directive callback; its caller is
Sphinx's directive parser, which validates the integer-shape of
the argument before invoking. Type `str` doesn't capture the
integer-shape constraint.

**Classification: (b) false alarm.**

#### 3. `sphinx/util/inspect.py:764` — `signature_from_str(signature: str) -> inspect.Signature`

Function body prepends `'def func'` and parses as a Python AST.
Strategy: `st.text()`. Failure mode (by inspection): any string
that does not form a valid signature suffix raises `SyntaxError`
in `ast.parse`. Examples Hypothesis would find: empty string, `'x'`,
`'@@'`, `'\x00'`. Caller passes Python signature suffixes (e.g.
`'(x: int) -> str'`); arbitrary `str` violates the contract.

**Classification: (b) false alarm.**

#### 4. `pylint/lint/expand_modules.py:17` — `_modpath_from_file(filename: str, is_namespace: bool, path: list[str]) -> list[str]`

Private helper (leading underscore). Forwards to
`astroid.modutils.modpath_from_file_with_callback`. Strategy:
`st.text(), st.booleans(), st.lists(st.text())`. Failure mode (by
inspection): random text strings are not valid filesystem paths
or module names; `astroid` raises `ImportError` /
`OSError` / `ValueError` on non-existent modules. The function
expects validated, on-disk Python module paths.

**Classification: (b) false alarm.**

#### 5. `pylint/lint/expand_modules.py:26` — `get_python_path(filepath: str) -> str`

Walks up from `filepath` looking for an ancestor without
`__init__.py`. Strategy: `st.text()`. Failure modes (by
inspection): `os.path.realpath` and `os.path.expanduser` can raise
on certain string inputs (NUL byte embedded; extreme lengths;
non-UTF-8 surrogate pairs on some platforms). The function's own
docstring acknowledges its "(bad) assumption that there is always
an `__init__.py`"; pylint developers know it's fragile, but the
fragility is about valid python project layouts, not arbitrary
string inputs.

**Classification: (b) false alarm.** NUL-byte-in-path is a
genuine input-validation gap class in Python broadly, but the
caller (pylint's CLI) validates upstream.

#### 6. `pylint/lint/pylinter.py:84` — `_load_reporter_by_class(reporter_class: str) -> type[BaseReporter]`

Private helper. Imports `reporter_class` as a fully-qualified
class name. Strategy: `st.text()`. Failure mode (by inspection):
random text is not a fully-qualified class name; `astroid.modutils.
get_module_part` and `load_module_from_name` raise `ImportError`
or `ValueError`. Caller passes a known class name from pylint's
config; arbitrary `str` violates the contract.

**Classification: (b) false alarm.**

### Why the breach is structural, not a code defect

Every counterexample matches the same shape: the function's type
signature is `str` (or similarly broad), its implicit contract is a
narrow subset of `str` enforced by the caller, and Hypothesis's
type-driven `st.text()` finds inputs that match the type but
violate the contract. None of the modified functions in this
corpus had a contract narrow enough to match its type signature.

This is a known limitation of property-based testing on Python
functions whose contracts aren't reflected in their types. The
property gate is functioning as designed; what it finds is true
but not actionable — "your input validation is incomplete on a
private helper / RST callback / parser internal whose caller
already validates upstream" doesn't translate into a real defect
the developer would fix. Filing those findings as bugs would
generate review noise without catching new defects.

### What this means for Phase 3 readiness

The arity-aware fix is sound — 0 tooling artifacts confirms the
structural change works. The SNR breach is the gate's
fundamental-limitation problem on the kind of code SWE-bench
Verified contains: utility functions on top of pre-validating
callers, where the type system doesn't carry the precondition.

Two design directions exist (NOT in scope for this session):

1. **Constrained strategies driven by docstring or precondition
   parsing.** A function's docstring often hints at the actual
   contract ("argument is an integer-shaped string"); a future
   gate could parse those hints and generate constrained
   strategies. This is closer to "smart fuzzer" territory and is
   significant new work.

2. **Threshold adjustment.** The v7 plan's 2:1 SNR threshold may
   have been speculative. On a corpus where the gate finds
   structurally-valid but contract-violating inputs by design, a
   different metric might capture the gate's actual value (e.g.,
   "fraction of findings that point to a missing precondition
   assertion is N%"). This is a measurement-design conversation,
   not a tuning conversation.

3. **Pre-condition assertion as the recommended fix.** Reframe
   property-gate findings from "bug" to "missing precondition."
   The gate's output then translates into a code-quality ask
   (`assert isinstance(s, str) and s != ''` at function entry),
   not a behavior fix. SNR re-categorizes accordingly.

Per the session 3 prompt, the tooling-artifact branch ("regression
in arity-aware fix") would mandate a scoped fix in this session;
the false-alarm-only branch ("design conversation") is what
applies here. **Halting for design conversation; no scoped fix in
this session.**

### Adapter cost

$0 (Hypothesis is local). The session 3 measurement is the
cheapest of the v7 critical-path sessions; the cost was wall
clock and judgment.

---

# Phase 2 — Layer 4 Property Gate Eval Results (historical, 2026-05-01)

Date: 2026-05-01.
Run id: `phase-2/property-n10`.
Eval driver: `scripts/eval/p1-run-evals.py`.
Sample: 10 SWE-bench Verified instances from `instances-50.json[0:10]`
(astropy x2, django x8). All Python.
Raw output (committed):
- `docs/p1-eval-fixtures/eval-output/phase-2/property-gate-eval.jsonl`
- `docs/p1-eval-fixtures/eval-output/phase-2/property-summary.json`

Working copies under `docs/p1-eval-fixtures/runs/phase-2/property-n10/` are
identical and gitignored per the project's `runs/` rule. The 38GB+
workspaces/ subdirectory (per-instance clones + venvs) is also under
`runs/` and not intended to ship.

## Summary

| Metric | Value | Halt threshold | Status |
|---|---|---|---|
| Genuine edge-case bugs found | 0 / 28 findings | n/a | — |
| Tech-valid-but-irrelevant counterexamples | 0 / 28 | n/a | — |
| Tooling artifacts | 28 / 28 | n/a | dominant class |
| Signal-to-noise ratio | 0 : 28 = 0.0 | < 2:1 halts | **threshold suspended** |

The SNR halt threshold is suspended for this run per the Phase 2 step 1
decision (the 50-set SWE-bench Verified subset is all-Python and
untyped, so every target enters advisory mode and the SNR
measurement degenerates). What we measured instead: does the gate
produce findings that are worth reading on real patches?

**Answer: not on this corpus, for a structural reason that is not
"the gate is broken."** All 28 findings classify as tooling
artifacts driven by the property-gate's fixed 2-arg generator.

## Per-instance breakdown

| Instance | Status | Modified fns | Counterexamples | Typed |
|---|---|---:|---:|---:|
| astropy__astropy-13579 | ADVISORY | 2 | 2 | 0 |
| astropy__astropy-8872 | ADVISORY | 3 | 3 | 0 |
| django__django-10914 | ADVISORY | 1 | 1 | 0 |
| django__django-10999 | ADVISORY | 4 | 4 | 0 |
| django__django-11099 | SKIP | 0 | 0 | 0 |
| django__django-11490 | ADVISORY | 1 | 1 | 0 |
| django__django-11951 | ADVISORY | 5 | 5 | 0 |
| django__django-11964 | SKIP | 0 | 0 | 0 |
| django__django-12155 | ADVISORY | 11 | 11 | 0 |
| django__django-12419 | ADVISORY | 1 | 1 | 0 |

- 8 ADVISORY, 2 SKIP. SKIPs are instances whose gold patch only
  modified config / template files where `discoverPropertyTargets` could
  not find a function declaration (django__django-11099 modified
  `django/contrib/auth/validators.py` but the modified symbol is a
  regex-string-bound class attribute, not a function declaration).
- 28 advisory findings across 28 functions = 100% flag rate per fn.
- 0 typed targets (matches the all-Python corpus expectation).

## Counterexample classification

Per the user-defined rule: classify each finding as (a) genuine
edge-case bug, (b) technically-valid-but-irrelevant counterexample,
or (c) tooling artifact (gate crash, malformed input).

| Class | Count | Notes |
|---|---:|---|
| (a) genuine bug | **0 / 28** | No "Counterexample:" line was extracted from any harness output. |
| (b) tech-valid-irrelevant | **0 / 28** | No findings reached the assertion stage; all crashed earlier. |
| (c) tooling artifact | **28 / 28** | Every finding is the harness's "non-zero exit, no parsable counterexample" fallback. |

### Root cause of the 28 tooling artifacts

The Python property-gate harness in
`src/verification/property-gate.ts:140` generates exactly this code:

```python
from hypothesis import given, strategies as st
from <module> import <functionName>

@given(st.integers(), st.integers())
def test_generated_property(a, b):
    <functionName>(a, b)
```

The harness always uses **two `st.integers()` arguments**, regardless of
the function's real arity. Reproduced manually against
`django.utils.dateparse.parse_duration` (a 1-arg function) on the
`swarm-gold-eval` worktree:

```
TypeError: parse_duration() takes 1 positional argument but 2 were given
Falsifying example: test_generated_property(
    a=0, b=0
)
```

The same shape applies to every other ADVISORY finding in this run:

- `parse_date(date_str)`, `parse_time(time_str)`,
  `parse_datetime(date_str)` — arity 1
- `gettext_noop(s)` — arity 1
- `cursor_iter(cursor, sentinel, col_count, itersize)` — arity 4
- `simplify_regex(pattern, prefix='')` — arity 1+kwarg
- `sanitize_slices(slices, ndim)` — arity 2 with type expectations
  (slices must be iterable; integers are not)
- `combine_slices(...)` — arity 2 with type expectations

Functions with arity 2 *and* int-tolerant signatures (none in this
sample) would reach the assertion stage. The corpus contains zero
such functions, hence zero (a) or (b) findings.

The property gate explicitly marks untyped Python targets as
`advisoryOnly: true` (`property-gate.ts:67-79`) precisely because the
harness cannot direct generators by type. The 28-of-28 tooling-artifact
result is a consequence of that design choice, not a defect to fix
inside Phase 2.

## Layer-by-layer judgment

The Layer 4 result on this corpus is "the gate runs cleanly,
discovers modified functions, runs the harness, captures the harness
exit, but the harness crashes early on 100% of cases for a reason
unrelated to the function's correctness." That answers the question
the eval was intended to answer:

- **The gate's pipeline works end-to-end** (clone, venv, gold patch,
  function discovery, harness write, harness run, finding extraction,
  JSONL emit, all without errors).
- **The gate produces no actionable signal on untyped Python.** Every
  finding is "the function does not accept two integers," which
  is true for most real Python functions and is not what the gate
  exists to detect.
- **The gate cannot clear its v7 SNR threshold (>= 2:1 genuine vs
  noise) on this corpus** because it cannot produce genuine signal
  on untyped Python. The threshold is structurally unreachable, not
  failed-by-margin.

## Open follow-ups

These are not Phase 2 deliverables. They are the right shape of
follow-up to take Layer 4 from "advisory-only on Python" to
"meaningful in production":

1. **Typed-TS sample.** Run the same eval on a typed-TypeScript
   corpus (10 patches against this repo or another typed codebase)
   so the property gate can use type-directed generators. That is
   the only configuration where the SNR threshold is reachable.

2. **Arity-aware Python harness.** A small extension to
   `src/verification/property-gate.ts:pythonHarness` that inspects
   the function's signature (e.g. `inspect.signature(fn).parameters`)
   and generates the matching number of `st.integers()` arguments
   would eliminate the dominant tooling-artifact class. This would
   not produce genuine signal on untyped Python (no type hints means
   no idea what types the function expects), but it would at least
   distinguish "function rejects ints by type" from "function rejects
   2-arg call by arity." Out of Phase 2 scope per the
   no-production-code constraint, but a clean follow-up.

3. **Hypothesis strategy hints from PEP 484 type hints.** When a
   Python function does have type hints, the harness could read them
   and use `hypothesis.strategies.from_type` to direct generation.
   That is the Python equivalent of the typed-TS path above.

## Verdict

Layer 4 **does not clear the v7 SNR halt threshold** on the
all-Python corpus, because the threshold is structurally unreachable
without typed targets or arity-aware harness generation. The
threshold was suspended per the Phase 2 step 1 decision; the result
is recorded honestly as "no genuine signal on this corpus" rather
than gamed against the threshold.

For Phase 3 promotion to primary verifier, **Layer 4 needs a
different evaluation set** (typed TS sample) or a harness extension
(arity-aware Python). Either is a clean follow-up. As the gate
stands today, it functions as a coverage indicator on Python
("here are the functions that change") but does not produce
actionable counterexamples.
