# Layer 1 (Test Synthesizer) — Real-Data Findings

Date: 2026-04-30
Diagnostic source: `benchmarks/swe-bench/results/diagnostic-2026-04-30-results.json`
Workdir preserved: `/tmp/swebench-or774kh6/psf__requests-1766`
Instance: `psf__requests-1766` (SWE-bench Verified)

## Classification

**Reading B — environment bug.** The synthesizer reasons correctly about real
SWE-bench bugs and produces a mechanically discriminating regression test.
The harness then runs that test in a location where it cannot reach the
repo-local source under test, and the test falls through to a
system-installed package that already has the fix. Result: test passes
against the "buggy base" because it never exercises the bug.

Layer 1 stays a hard gate after the harness fix. The synthesizer's output
quality on this instance is exactly what the gate is supposed to demand.

## What was measured

After the synth model-ID fix landed (`fdbe243`), a one-instance smoke ran
`psf__requests-1766` end-to-end with `--keep-workdir`. The synthesizer:

- Took 5.16 minutes wall-clock across 3 attempts (vs 6-9s of fast-fail
  before the model-ID fix)
- Generated a 75-line pytest module targeting `HTTPDigestAuth.build_digest_header`
  (the exact code path the gold patch modifies)
- Produced two assertions:
  - `assertIn('qop="auth"', header)` — positive form, matches the fix's literal change
  - `assertIsNone(re.search(r'\bqop=(?!")', header))` — negative form, catches the unquoted bug

Final synth_eval status: `AMBIGUOUS_GOAL` ("test passed against base"). At
face value this looks like a synthesizer capability problem.

## Manual verification

Running the synth's generated test in a fresh `git worktree add` at the
base commit (`847735553aed`):

```
test_digest_qop_quoting.py::TestDigestQopQuoting::test_qop_bare_unquoted_form_absent FAILED
test_digest_qop_quoting.py::TestDigestQopQuoting::test_qop_value_is_double_quoted FAILED
============================== 2 failed in 0.17s ===============================
```

Header in failure message: `qop=auth, nc=00000001, ...` — confirms the test
correctly exercises the buggy code path and fires the assertion.

Running the same test against HEAD (orchestrator-applied fix matches gold
patch, `qop="auth"` at line 147 of `requests/auth.py`):

```
test_digest_qop_quoting.py::TestDigestQopQuoting::test_qop_bare_unquoted_form_absent PASSED
test_digest_qop_quoting.py::TestDigestQopQuoting::test_qop_value_is_double_quoted PASSED
============================== 2 passed in 0.14s ===============================
```

Test fails against base, passes against HEAD. Mechanically correct.

## Why the in-harness run reported the test passed against base

The synthesizer writes each candidate test to
`.swarm/synthesized-tests/attempt-N-<safeName>.py` via `safeOutputPath` in
`src/verification/test-synthesizer.ts`. The test's source then resolves
`__file__` to that subdirectory:

```python
_repo = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _repo)
```

`_repo` becomes `<workdir>/.swarm/synthesized-tests/`, not the repo root.
The hand-written `_stub_requests()` workaround tries to construct a fake
`requests` package whose `__path__` points at `<_repo>/requests/` — a
nonexistent directory.

The stub is also conditioned on `if 'requests' not in sys.modules:`. If a
plugin loader or pytest collector has imported `requests` first (the host
has `requests` 2.x installed at `/home/brad/.local/lib/python3.12/site-packages/requests/`),
the stub is skipped and `importlib.import_module('requests.auth')` returns
the system-installed module — which has `qop="auth"` already. The
generated assertions then pass, and the synthesizer interprets that as
"test doesn't expose the bug" and rejects the candidate, retrying.

Confirmed by `python3 -c "import requests; ..."` against the host
interpreter:

```
system requests path: /home/brad/.local/lib/python3.12/site-packages/requests/__init__.py
system has qop="auth": True
system has qop=auth: False
```

After 3 attempts all rejected for "test passed against base," final status
becomes `AMBIGUOUS_GOAL`. The synth's reasoning was right; the runtime
location was wrong.

## Why this matters for the GA scope conversation

The original framing — "Layer 1 fails its own eval at 100% FN, demote to
advisory" — was wrong. The eval was failing because the harness puts the
test in a directory it can't import the local source from. With that
fixed, Layer 1 actually does what the v7 plan claims: it gates on
synthesized regression tests that fail against base and pass against the
fix.

The fix has multiple plausible shapes:

1. **Run the candidate test from the repo root.** Either drop the
   `.swarm/synthesized-tests/` subdir entirely (write `attempt-N-name.py`
   at repo root, clean up after) or pass `--rootdir=<repo>` /
   `PYTHONPATH=<repo>` so the test's import logic resolves the local
   package first.
2. **Strip the system-installed `requests` (or analogous package) from
   `sys.path`** before running the candidate. Brittle on different hosts.
3. **Run the candidate inside the SWE-bench evaluation container** where
   the local source is the only available `requests`. Most defensible,
   slowest path.

Option 1 is the smallest change and would have caught this case. The
deeper fix (option 3) is closer to how SWE-bench's own FAIL_TO_PASS
evaluation works.

## Open question — does this generalize?

`psf__requests-1766` is one instance. The same structural failure mode
applies to any SWE-bench instance whose target package is also installed
on the host (django, scikit-learn, pytest, sphinx, sympy, matplotlib —
most of the 50-set has a host-installable counterpart). A second
diagnostic on a django instance, post-harness-fix, would tell whether the
synthesizer's quality holds on more intricate codebases or whether
something repo-specific surfaces.

This isn't blocking GA — the AMBIGUOUS_GOAL artifacts produced before the
harness fix were dead data. After the fix, the data starts mattering.

## Out of scope here

- The diff-bloat issue surfaced earlier (planner generating wrong-template
  plans on SWE-bench tasks) is a separate problem in
  `src/plan-generator.ts:detectGoalType`. It does not affect Layer 1's
  correctness.
- The cheat detector (Layer 3) and attestation (Layer 5) are exercised by
  the falsification-corpus harness, not the SWE-bench harness. Their per-
  layer FN rates from the 2026-04-29 corpus run are 0%.
