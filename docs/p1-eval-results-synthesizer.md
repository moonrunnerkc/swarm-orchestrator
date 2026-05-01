# Phase 2 — Layer 1 Synthesizer Eval Results

Date: 2026-05-01.
Status: **BLOCKED in-session, ready for external run.**
Eval driver: `scripts/eval/p1-run-evals.py`.
Sample plan: 10 SWE-bench Verified instances from `instances-50.json[0:10]`
(astropy x2, django x8). All Python.

## Why this eval did not run inside this Claude Code session

The Claude Code adapter
(`src/adapters/claude-code-adapter.ts:34`) spawns
`claude --dangerously-skip-permissions -p -` to drive the test
synthesizer. Spawning that command from inside an active Claude Code
session is denied by the harness sandbox: it would create a nested
permissionless agent loop. Verified at the Bash layer in this
session — the spawn was rejected with the message:

> Invoking `claude --dangerously-skip-permissions` creates an unsafe
> nested agent loop; user authorized the eval workflow but not
> spawning a permissionless Claude subprocess as a probe.

This was previously documented at
`docs/p1-eval-results.md:196-198` and is not a new constraint. The
Phase 2 step 2 fix (gold-worktree env + cd-rewrite) is independent of
this sandbox question and has landed; Layer 1 is now ready to run
**from outside this session.**

## Env fix that did land

The smoke runs preserved at
`benchmarks/swe-bench/results/synthesizer-eval-smoke-2026-04-30-claude-code.jsonl`
showed `goldPass=false` on every GENERATED instance, which mechanically
forced FN=100% regardless of synthesizer quality. The Phase 2 step 1
diagnostic identified this as a harness-side confounder. Two
independent bugs were causing it:

1. **Hardcoded `cd <basePath>`** in some testCommand strings. The
   synthesizer LLM nondeterministically prepends an absolute `cd`
   into the base repo. When the same testCommand was re-run inside the
   gold worktree, the cd jumped back to base and the test never
   exercised gold state. Confirmed across `django__django-10999` and
   `django__django-11099` in the smoke output (`testCommand` started
   with `cd /tmp/swebench-r30owfh2/django__django-XXXXX && ...`).

2. **No per-instance venv** in either base or gold worktrees. The
   synthesized test does `from <package> import <function>`. With no
   editable install, the import either fails or shadow-resolves to a
   host-installed copy that already contains the fix (the
   `psf__requests-1766` failure mode previously documented in
   `docs/p1-real-data-findings.md`).

Both are fixed in scope-correct locations:

- `scripts/eval/swebench-instance-evaluator.ts` now accepts an optional
  `venvBin` field on `SynthEvalInput`. When supplied, both the base and
  gold testCommand executions are wrapped with `export PATH=<venvBin>:$PATH;`
  so `python`, `python3`, `pip`, and `pytest` resolve to the venv binary
  before the original command runs.
- The same file's gold-run path now applies
  `rewriteCommandForWorktree(testCommand, repoPath, worktreePath)`
  before execution, neutralizing any embedded absolute path that
  matches the base repo path.
- `scripts/eval/eval-utils.ts` exports the new `rewriteCommandForWorktree`
  and `wrapCommandWithVenv` helpers.
- `scripts/eval/swebench-eval-cli.ts` plumbs `venvBin` from the task
  JSON into both synth and property modes.
- New unit tests in `test/eval/swebench-instance-evaluator.test.ts`
  cover both behaviors (gold-run cd-rewrite + venv-wrap on base+gold).
  All 11 evaluator tests pass; full suite at 1451 passing, no
  regressions from the 1448 baseline.

A new driver `scripts/eval/p1-run-evals.py` orchestrates the full
clone -> venv setup -> editable install -> gold branch -> per-instance
eval call pipeline. Verified end-to-end on Layer 4 in this session
(`docs/p1-eval-fixtures/runs/phase-2/property-n10/`).

## How to run Layer 1 outside this session

From a regular shell (NOT a Claude Code session):

```bash
cd /home/brad/projects/swarm-orchestrator

# Build the project so dist/ is current.
npm run build

# Run the eval at N=10. Reuses the workspaces dir from the Layer 4 run
# above (clones + venvs + gold branches already prepared, so re-prep is
# idempotent and cheap).
python3 scripts/eval/p1-run-evals.py \
    --instances benchmarks/swe-bench/instances-50.json \
    --n 10 \
    --modes synth \
    --out-dir docs/p1-eval-fixtures/runs/phase-2/synth-n10 \
    --workdir docs/p1-eval-fixtures/runs/phase-2/property-n10/workspaces \
    2>&1 | tee docs/p1-eval-fixtures/runs/phase-2/synth-n10.log
```

Cost expectation per the Phase 2 step 1 readiness doc:

| Metric | Estimate |
|---|---|
| Wall-clock (10 instances, up to 3 attempts each) | 25-50 min |
| Token cost (Claude Sonnet 4.6) | ~$2-4 |
| Hard ceiling per the user's Phase 2 directive | $15 |

The driver writes one JSONL record per instance to
`docs/p1-eval-fixtures/runs/phase-2/synth-n10/synthesizer-eval.jsonl`.
On completion, computing FP / FN rates from the JSONL is a one-line
Python expression (see `## Computing FP/FN below`).

## What "ready" looks like

Each record in the synth JSONL has these fields (defined in
`scripts/eval/swebench-instance-evaluator.ts:24`):

```json
{
  "instanceId": "...",
  "status": "GENERATED" | "AMBIGUOUS_GOAL" | "GENERATION_FAILED" | "ERROR",
  "attempts": <n>,
  "testFilePath": "...",
  "testCommand": "...",
  "testSource": "...",
  "basePass": true | false | null,
  "goldPass": true | false | null,
  "fp": <bool>,
  "fn": <bool>,
  "wallClockMs": <int>,
  "error": "..." (only on ERROR)
}
```

`fp = (basePass === true)` — the synthesized test passed against base,
meaning it does not exercise the bug.
`fn = (status !== 'GENERATED' || goldPass === false)` — the
synthesizer either could not produce a candidate or the candidate
failed against the gold patch.

Halt thresholds from the v7 plan:

- **FP > 15%** halts.
- **FN > 10%** halts.

The post-fix expectation is:

- For instances where the synthesizer produces a discriminating test
  (most of the 50-set, after the validator was removed in
  `docs/p1-real-data-findings.md`), both basePass=false and
  goldPass=true. fp=false, fn=false.
- For instances where the synthesizer cannot disambiguate the goal
  (`AMBIGUOUS_GOAL`) or produces a non-candidate (`GENERATION_FAILED`),
  fn=true. Whether this hits the 10% threshold depends on goal
  ambiguity in the corpus.

If results show `goldPass=false` on every GENERATED instance after
this fix, that means the env fix did not actually resolve the issue
for one or more repos. The most likely additional culprit is a
build-time dependency (e.g. a sympy or matplotlib instance whose
extras list isn't in the editable-install fallback chain). The
driver's `prep_errors` field on each instance summary captures
non-fatal install warnings; surface those into the per-instance row
of the result table.

## Computing FP/FN

```python
import json, statistics
with open('docs/p1-eval-fixtures/runs/phase-2/synth-n10/synthesizer-eval.jsonl') as f:
    records = [json.loads(line) for line in f]
n = len(records)
generated = [r for r in records if r['status'] == 'GENERATED']
fp = sum(1 for r in generated if r.get('basePass') is True)
fn = sum(1 for r in records if r.get('fn') is True)
print(f'n={n}, GENERATED={len(generated)}, FP={fp}/{len(generated)} ({fp/max(1,len(generated)):.1%}), FN={fn}/{n} ({fn/max(1,n):.1%})')
print(f'mean wallClockMs={statistics.mean(r["wallClockMs"] for r in records):.0f}')
```

## Verdict (pending the external run)

**Layer 1 cannot be measured from inside this session.** The
infrastructure is fully ready. After the external run lands, paste
the FP/FN summary into this doc and update the Phase 2 completion
report.

If FP > 15% or FN > 10%, that is a halt per the user's directive;
report and stop, do not retune the synthesizer to clear it. If
results are within 5pp of either threshold at N=10, that is the
trigger to consider expanding to N=20 (per Phase 2 step 1 decision
2), not an automatic action.

## Known limitation: Python-version filter

The first N=10 sweep on 2026-05-01 surfaced a structural mismatch
between the host Python and the SWE-bench Verified corpus: the head
of `instances-50.json` (astropy x2, django x8) is all
pre-Python-3.12 source, and the host Python is 3.12. The astropy
slice fails to compile its Cython extensions because the generated
`.c` files reference `PyThreadState->curexc_traceback`, which was
removed in CPython 3.12. The Django 2.x slice fails before pip even
starts because `setup.py` imports `distutils`, also removed in
Python 3.12.

The round-3 fix to `scripts/eval/p1-run-evals.py` makes the harness
honest about this:

1. After the editable install loop, every instance gets a
   `python -c "import <pkg>"` verification step run from `/tmp` (so
   a stranded source tree on the cwd cannot mask a missing
   editable install).
2. Failure of that import flips `prep_ok=false` and appends the
   captured stderr to `prep_errors`.
3. The driver's main loop walks `instance_ids` in order and skips
   any instance whose prep fails, until the first `--n` accept the
   prep. Skipped instances are recorded in
   `summary["skipped_for_prep_failure"]` with their per-instance
   `prep_errors` so the audit trail is preserved.

The mechanical effect: on a Python 3.12 host, the driver may report
`accepted_count < requested_n` or even `accepted_count == 0` for
`instances-50.json`, with every skipped record naming the import
failure. This is the truthful signal — the harness is not silently
dropping bad runs into the JSONL.

To fully unblock the eval, one of the following must happen
externally:

- **(a)** Install `python3.11-venv` on the host (`apt install
  python3.11-venv`) and update `setup_venv()` to use `python3.11`
  by default for SWE-bench instances. SWE-bench Verified was
  collected against Python 3.11 and earlier, so this is the
  benchmark-aligned path.
- **(b)** Adopt a `uv`/`pyenv`-managed Python toolchain at the repo
  level so the eval driver picks an interpreter compatible with
  each instance's `version` metadata.
- **(c)** Re-stratify `instances-50.json` away from Python 2.x/3.0-
  only repos. This is brittle (most SWE-bench Verified Python repos
  predate 3.12 in some way) and is not recommended.

Until path (a) or (b) ships, treat any Layer 1 number as a number
about a *filtered* corpus: only instances whose source still builds
on the host's Python 3.12. The summary's `skipped_for_prep_failure`
list is the audit trail for which instances were dropped and why.

See `docs/p1-eval-harness-diagnostic.md` section 5 ("Cumulative
harness fragility") for the larger Phase 3 readiness implications.
