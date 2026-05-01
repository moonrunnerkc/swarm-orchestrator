# Phase 2 — Layer 4 Property Gate Eval Results

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
