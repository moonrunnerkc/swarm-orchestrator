# Phase 2 — P1 Eval Readiness Survey

Diagnostic-first artifact for Phase 2 step 1. Surveys what already exists
for the three evals (Layer 1 synthesizer, Layer 3 cheat detector, Layer 4
property gate) and what is needed to run them at the spec sample sizes.

No evals have been run as part of Phase 2 yet. Halt point at the end of
this document; user confirmation required on data sourcing and cost
before any eval executes.

## TL;DR

| Eval | Harness | Corpus | Cost | Status |
|---|---|---|---|---|
| Layer 1 synthesizer | Exists, wired into SWE-bench harness | SWE-bench Verified, 10-20 instances from `instances-50.json` | ~$3 to $10, ~30-60 min wall-clock | Confounder flagged below; needs decision |
| Layer 3 cheat detector | Exists, eval input + post-fix output already committed | Reuse `docs/p1-eval-fixtures/eval-output/cheat-detector-input.json` (20 clean + 5 synthetic cheat) | ~$0, seconds | Ready to re-run |
| Layer 4 property gate | Exists, wired into SWE-bench harness | Same 10-20 SWE-bench Verified instances (gold patches) | ~$0 (local), seconds-per-instance plus the env-setup cost rolled into Layer 1 | Ready, but classification of counterexamples is manual review |

The Layer 1 result is gated on a confounder that needs to be resolved or
acknowledged before the eval is interpretable; see "Layer 1 confounder"
below. Layers 3 and 4 are ready to run.

## 1. Eval harness scripts

All three evals already have full harnesses. No new harness work is
required for Phase 2 step 2.

| Eval | Standalone CLI | Per-instance hook | Notes |
|---|---|---|---|
| Synthesizer (B.1) | `scripts/eval/synthesizer-eval.ts` | `evaluateInstanceSynthesizer` in `scripts/eval/swebench-instance-evaluator.ts`, dispatched by `scripts/eval/swebench-eval-cli.ts --mode synth` | Two paths: standalone takes an `issues.json` array; the per-instance hook is called by the SWE-bench Python harness for every instance |
| Cheat detector (B.2) | `scripts/eval/cheat-detector-eval.ts` | (no per-instance hook — runs against a pre-built input JSON) | Takes `--patches patches.json`, runs `runCheatDetector` per case, computes FP rate (clean cases) and known-cheat miss rate (cheat cases) |
| Property gate (B.3) | `scripts/eval/property-gate-eval.ts` | `evaluateInstancePropertyGate` in `scripts/eval/swebench-instance-evaluator.ts`, dispatched by `scripts/eval/swebench-eval-cli.ts --mode property` | Standalone takes `--patches patches.json` with optional `expectedRealBug`; per-instance hook runs the gate on gold-applied state in a fresh worktree |

Inputs and outputs:

- Synthesizer: input = `{instanceId, problemStatement, repoPath, goldPatchRef?}` JSON; output = one JSONL record `{instanceId, status, attempts, basePass, goldPass, fp, fn, wallClockMs, testFilePath?, testCommand?, testSource?, error?}` per instance, written to `benchmarks/swe-bench/results/synthesizer-eval-<run-id>.jsonl`.
- Cheat detector: input = `[{id, repoPath, goalText, diffText, expectedCheat, allowedTestFiles?}, ...]`; output = aggregate report JSON with per-case `flagged/falsePositive/missedKnownCheat/score/findings` plus rolled-up `falsePositiveRate` and `knownCheatMissRate`.
- Property gate: input = `[{id, repoPath, changedFiles, patchFile?, baseRef?, expectedRealBug?}, ...]`; output = report JSON with per-case `findings/targets/status/score` plus `signalToNoise.{genuineBugs, falseAlarms, ratio, label}`.

Only required new work: pick an N, write the `issues.json`/`patches.json`
input, invoke the existing scripts.

## 2. SWE-bench infrastructure

Substantial infrastructure already exists.

- **Manifest:** `benchmarks/swe-bench/instances-50.json` selects 50 SWE-bench Verified instances stratified by repo, seed=42. The 5-instance smoke slice is at `benchmarks/swe-bench/instances-smoke-5.json`.
- **Repo coverage in the 50-set:** django (23), sympy (8), sphinx (5), matplotlib (3), scikit-learn (3), astropy (2), xarray (2), pytest (2), pylint (1), requests (1). Entirely Python.
- **Sweep runner:** `benchmarks/swe-bench/evaluation-scripts/run_swebench.py` calls the per-instance synth and property hooks every time it runs. The per-instance hook for synth fires after checkout but before the agent runs; the per-instance hook for property runs after gold tests.
- **Already-run eval output:**
  - `benchmarks/swe-bench/results/synthesizer-eval-smoke-2026-04-30-claude-code.jsonl` — 4 instances, post-validator-removal smoke, 3/4 GENERATED + 1/4 GENERATION_FAILED.
  - `benchmarks/swe-bench/results/property-gate-eval-smoke-2026-04-30-claude-code.jsonl` — 4 instances, all ADVISORY/SKIP.
  - `benchmarks/swe-bench/results/synthesizer-eval-rerun-2026-04-30-2instance.jsonl` — 2-instance follow-up.
  - `benchmarks/swe-bench/results/diagnostic-2026-04-30-r3-results.json` — 1 instance (`psf__requests-1766`) used for the Layer 1 capability/environment diagnosis in `docs/p1-real-data-findings.md`.
  - 2026-04-28 codex/copilot smokes are pre-fix; their JSONL records reflect the validator bug, not Layer 1 capability.

**Has SWE-bench been swept end-to-end?** No full 50-instance sweep with the post-fix synthesizer is committed. The smoke slices and 2-instance rerun are the most current data.

**Are agent patches captured?** No. `capture_agent_diff` builds the patch in memory and ships it into the eval container; nothing persists to the result JSON. This affects the Layer 3 corpus options (see §4).

## 3. SWE-bench Verified instance shape

Confirmed by direct inspection of the cached dataset:

```
keys: ['repo', 'instance_id', 'base_commit', 'patch', 'test_patch',
       'problem_statement', 'hints_text', 'created_at', 'version',
       'FAIL_TO_PASS', 'PASS_TO_PASS', 'environment_setup_commit',
       'difficulty']
total: 500 instances
```

`FAIL_TO_PASS` and `PASS_TO_PASS` are JSON-encoded string lists.
`problem_statement` is the raw issue text. `patch` is the unified-diff
gold fix. `base_commit` is the commit to check out before the fix.

This is sufficient input for the synthesizer eval: `goalText` <-
`problem_statement`, `repoPath` <- repo at `base_commit`, `bugExists`
<- `true` (every instance has a known fix; none are "no bug" cases),
`knownFixRef` <- the gold-applied side branch (`materialize_gold_branch`
already produces this).

## 4. Patch corpus for the cheat-detector eval

A 25-case input already exists at
`docs/p1-eval-fixtures/eval-output/cheat-detector-input.json`:

- 20 clean cases — SWE-bench Verified gold patches, one per instance from `instances-50.json`. Goal text = problem_statement, diffText = gold patch.
- 5 synthetic cheats — hand-constructed minimal diffs in `docs/p1-eval-fixtures/cheat-detector/`, one per cheat-detector rule.

A post-fix run is committed at
`docs/p1-eval-fixtures/eval-output/cheat-detector-results-post-fix.json`:
FP = 0/20 (0%), known-cheat miss = 1/5 (20%, the
return-fallback exception-swallowing shape).

**Phase 2 spec asks for 20 patches, mix of known-clean and known-cheat.**
The existing 25-case input matches that spec well (20 clean + 5 cheat).

### Recommendation: option (b), reuse the existing 25-case input

Reasoning:

- It is exactly what the spec asks for (mix of clean and cheat).
- Clean labels are accurate: SWE-bench Verified gold is, by construction, a correct minimal fix. Treating those as "clean" is well-founded (no cheat patterns expected in the dataset's curated patches).
- Cheat labels are accurate: each synthetic was hand-built to trigger one specific rule.
- The eval has been run and the post-fix result is committed, so we have a baseline; running again on the same input verifies no regression.
- Option (a) — using the orchestrator's own SWE-bench attempts — is appealing for realism but blocked: agent patches aren't persisted in `swebench-results-*.json`, and re-running 20+ orchestrator sweeps to capture them costs an order of magnitude more than the synthesizer eval. The orchestrator-vs-cheat reading is also confounded by agent quality (`copilot` resolved 4/5, `codex` resolved 0/5 in the same smoke), so "small unresolved diff" doesn't cleanly map to "cheat."
- Option (c) — open-source agent patches reverted as incorrect — has highest realism but requires sourcing infrastructure that doesn't exist in this repo. Not in Phase 2 scope.

If the 0% FP / 20% miss numbers are still the right answer, Phase 2 step 2 for Layer 3 simply re-runs and confirms. If we want a stronger eval, the right follow-up is to add a *sixth* synthetic case for the
return-fallback shape (`catch (e) { return {}; }`) so the known
exception-swallowing coverage gap shows up on the result line as a
flagged miss; that work is a clean extension, not corpus replacement.

**Open question for the user:** is the existing 25-case set acceptable
as the formal Phase 2 corpus, or do you want a fresh 20-patch sample?
Default is reuse.

## 5. Function corpus for the property-gate eval

The property gate runs against modified functions from a gold-applied
worktree. The existing per-instance hook (`evaluateInstancePropertyGate`)
extracts `changedFiles` from the gold diff via `parseUnifiedDiff` and
fuzzes each function it discovers.

The 5-instance smoke (`property-gate-eval-smoke-2026-04-30-claude-code.jsonl`)
shows every Python case as `ADVISORY` (untyped Python is
`advisoryOnly: true` per `discoverInSource` at
`src/verification/property-gate.ts:69`), with counterexample
`explanation: "generic advisory fuzzing found a failure or the property
tool could not run"` — diagnostic-grade only, not actionable.

### Recommendation: 10 SWE-bench instances, gold-applied, with a typed sample

For a SNR measurement to mean anything, at least some targets need to
be `typed: true`. With the 50-set being all Python and untyped, every
finding will be advisory and the SNR ratio degenerates: the gate
basically reports "fuzzing found something" on every modified function.
Two options:

(i) **Run the property gate on the same 10 SWE-bench instances as the
synthesizer eval (Python, advisory).** Then classify each
counterexample manually. Cheap; tests the gate's *real* behaviour on
the 50-set; confirms or refutes that advisory output is signal.

(ii) **Add a typed TypeScript sample** (10 patches against this repo
or another typed codebase). Higher signal but new corpus to source.

The v7 plan halt threshold is "ratio < 2:1." Reaching that threshold
with all-advisory Python is hard because every finding is low-confidence
by design. The honest reading is that Phase 2 measures (i), reports the
SNR with the all-advisory caveat written into the result, and tracks
the typed-sample eval as a separate follow-up. The 50-set Python-only
caveat is already documented in `docs/p1-eval-results.md:168`.

**Default recommendation:** option (i), 10 SWE-bench Verified instances,
classification done manually after the JSONL is captured. Reuse the
first 10 IDs from `instances-smoke-5.json` extended to 10. Surface the
typed-sample gap as an open follow-up.

## 6. Cost and wall-clock estimates

### Layer 1 synthesizer

Per-instance cost depends on attempts (max 3, configured in
`src/verification/test-synthesizer.ts:168`). Each attempt is one
Claude Sonnet 4.6 call via `ClaudeCodeAdapter` plus a local pytest run.

Token estimate per attempt: ~10K input tokens (issue text, up to 8
relevant files trimmed to 4KB each), ~2K output tokens (test JSON).

Pricing (Sonnet 4.6, current Anthropic): $3 / MTok input, $15 / MTok
output. So per attempt: 10K * $3/1M + 2K * $15/1M ≈ $0.06.
Per instance with up to 3 attempts: ≈ $0.18.

Wall-clock from prior smoke runs:

| Run | n | Mean ms | Min ms | Max ms |
|---|---|---|---|---|
| `synthesizer-eval-smoke-2026-04-30-claude-code` | 4 | 138,868 | 60,375 | 360,164 |
| `synthesizer-eval-rerun-2026-04-30-2instance` | 2 | 283,459 | 278,531 | 288,388 |

The rerun's higher mean is because both instances exhausted all 3
attempts (status `AMBIGUOUS_GOAL`). Realistic per-instance budget:
60s (one-shot success) to 300s (three-attempt failure), median ~140s.

For N = 20 instances, serial:

- Wall-clock: 20 * 140s ≈ 47 min, with high-side ~100 min if many take 3 attempts.
- LLM cost: 20 * $0.18 = ~$3.60. Cap at $10 to allow for prompt-length variance and any retry that exceeds the 3-attempt model.

For N = 10: half of the above. ~25 min, ~$2.

### Layer 3 cheat detector

No LLM calls. `runCheatDetector` is local diff parsing plus an optional
Semgrep run; Semgrep config is at `config/semgrep-rules/` (need to
verify it exists at run-time; if absent, the eval marks `semgrepStatus`
as `unavailable` and proceeds).

Wall-clock from the post-fix run on 25 cases: total seconds, not
minutes.

Cost: $0 LLM. Local CPU, negligible.

### Layer 4 property gate

No LLM calls. The gate writes a fast-check / Hypothesis harness, runs
it, and parses output.

Wall-clock from prior smoke runs:

| Run | n | Mean ms | Max ms |
|---|---|---|---|
| `property-gate-eval-smoke-2026-04-30-claude-code` | 4 | 492 | 564 |
| `property-gate-eval-smoke-2026-04-28-codex` | 5 | 461 | 585 |

Sub-second per instance, dominated by harness write + interpreter
startup. For 10 instances, total wall-clock is seconds.

The Layer 4 wall-clock above does not include the per-instance
checkout + dep-install cost. When the property eval runs in-line with
the SWE-bench harness, that cost is amortized into Layer 1's wall-clock
(the same checkout serves both). When run standalone, plan ~2-5 min
per instance for clone + venv install for the larger Python repos
(django, sympy).

Cost: $0 LLM. Local CPU + git clone bandwidth.

### Combined budget

Running all three evals on N = 10 instances (Layer 1 synthesizer +
Layer 4 property gate via the SWE-bench harness, plus Layer 3 reusing
the existing 25-case input):

- Wall-clock: ~25-50 min depending on how many synth instances burn 3 attempts.
- LLM cost: ~$2-4, capped at $10 for safety.

Scaling Layer 1 to N = 20:

- Wall-clock: ~50-100 min.
- LLM cost: ~$4-8, capped at $15.

## Layer 1 confounder (must resolve before interpreting results)

The 5-instance smoke from 2026-04-30 produced status `GENERATED` in 3/4
cases, with `basePass=false` (test correctly failed against base), but
also `goldPass=false` in every case. That makes `fn=true` for every
instance, mechanically giving Layer 1 a 100% FN rate.

`fn=true` means "synthesis status != GENERATED OR goldPass==false."
With base failing and gold also failing, the test is rejecting both
states — most likely because the gold-applied side branch
(`materialize_gold_branch` in `run_swebench.py:1205`) is a fresh git
commit on top of base but does not include the per-instance dependency
install that the host venv has. The synthesized test imports the
target module; if the gold worktree's `python` resolves a different
package than the harness's main worktree, the test fails on import or
on attribute lookup, not on the assertion the synthesizer wrote.

This is the same class of failure mode as the original
`psf__requests-1766` import-resolution bug documented in
`docs/p1-real-data-findings.md`, just on the gold side instead of the
base side. The doc's option (3) ("run the candidate inside the
SWE-bench evaluation container") is the structural fix.

**Consequences for Phase 2:**

- Running Layer 1 against the current harness will likely yield FN ≈ 100% on real data, far above the 10% halt threshold.
- That number does not measure synthesizer capability. It measures gold-worktree environment correctness.
- Reporting it as a Layer 1 halt would be Goodhart at the data level: the eval would be telling us the harness has a known environment bug, not that the synthesizer is broken.

**Two options for the user:**

1. **Accept the confounder, run the eval anyway, and report the halt with the environment caveat in the result document.** Honest but expensive ($4-8) for a number that won't change Phase 3 scoping.
2. **Halt Phase 2 step 2 on Layer 1 until the gold-worktree env issue is fixed.** Either by running `pip install -e .` on the gold worktree before the candidate runs, or by routing the candidate through the per-instance Docker container the harness uses for gold tests. Then re-attempt the eval.

**Default recommendation:** option 2. The $4-8 isn't the issue; the
non-actionable result is. The structural fix is one of:

- Add a venv-install step to the synth-eval gold-worktree path in `evaluateInstanceSynthesizer` (mirror what the harness does for `run_gold_tests` already).
- Run the synth eval inside the same per-instance Docker image the harness already pulls for gold tests (`ghcr.io/epoch-research/swe-bench.eval.x86_64.<id>`).

Either is well-scoped and matches the discipline noted in the
v7-plan ("don't engineer the layer past the threshold; fix the data
quality issue, then re-measure").

Phase 2 step 2 can run Layer 3 and Layer 4 immediately. Layer 1
should wait on the env fix.

## Halt point

User confirmation required before any eval runs:

1. **Layer 1 plan:** option 1 (run despite the goldPass confounder) or option 2 (fix the gold-worktree env first)? Default recommended: option 2.
2. **Layer 1 sample size:** N = 10 or N = 20? Default recommended: N = 10 first; expand to 20 only if results are clear.
3. **Layer 3 corpus:** reuse the existing 25-case input, or build a fresh 20-patch sample? Default recommended: reuse.
4. **Layer 4 corpus:** option (i) 10 SWE-bench Verified Python instances (all advisory, manual classification), or option (ii) build a typed-TS sample? Default recommended: option (i), with the typed-sample gap tracked as a follow-up.
5. **Cost approval:** ~$2-8 for Layer 1, $0 for Layer 3 and Layer 4. Cap at $15 to absorb retries.

Halt until the user confirms or revises these. No eval will run before
that confirmation.
