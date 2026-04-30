# Known gaps as of v7.0.0

Limitations the v7.0.0 release ships with. Each entry names the symptom,
the structural cause, and what the v7.1 fix would look like.

## detectGoalType keyword classifier misroutes bug-fix prose

**Symptom.** `swarm run --goal "fix the bug where the server returns 500
on POST /api/users with empty body"` produces a five-step greenfield API
template instead of a bug-fix plan. The agent then writes Dockerfiles,
.env templates, middleware skeletons, and an API test suite — none of
which the bug fix needs. On targets that trigger the JS quality gate
(repos with HTML/JS test fixtures), this also drives an `npm install` of
puppeteer + grunt + qunit + biome at the repo root, producing a
multi-megabyte `package-lock.json` that contaminates downstream diff
capture.

**Cause.** `src/plan-generator.ts:detectGoalType` keyword-matches on prose
word boundaries. `\b(rest|api|endpoint|graphql|microservice|backend|server|middleware)\b`
fires on phrases like `"server-side"` (hyphen counts as a word boundary),
even when the surrounding text is clearly a bug report. The structural
discriminator `hasBugReportShape` is too narrow to catch real-world bug
prose — it requires ≥2 single-backtick-wrapped references plus a
present-tense failure verb, which excludes most issue text that uses
triple-backtick code fences instead of inline backticks.

**Workaround in v7.0.0.** The SWE-bench harness invokes
`swarm run --task-type swebench`, which bypasses `detectGoalType`
entirely and emits a fixed worker/reviewer pair. SWE-bench instances are
fully-specified bug-fix tasks (issue text + base commit + a
FAIL_TO_PASS test that gates resolution); there is nothing the heuristic
classifier can usefully add.

**Affected paths in v7.0.0.** The general-purpose `swarm run --goal`
entry point. Real users invoking the orchestrator on bug reports are
getting wrong-shaped plans today. The agent's reading comprehension on
the goal text in step 1's prompt usually recovers the actual fix anyway
(observed in `psf__requests-1766` diagnostic), but steps 2–5 then add
unrelated scaffolding that bloats the diff.

**Planned fix.** Replace the keyword classifier with explicit task-type
signaling at the CLI surface (`--task-type bug-fix | greenfield-api |
contract-change | …`) and remove the prose-keyword path. The keyword
classifier was designed for `swarm run --goal "build me a REST API"`,
not for "fix the bug where ...". The two shapes need different surfaces,
not a single shared heuristic.

## Synthesizer JSONL filename suffix is per-agent but the synthesizer is not

**Symptom.** Files like
`benchmarks/swe-bench/results/synthesizer-eval-smoke-2026-04-28-codex.jsonl`
imply the synthesizer ran with the `codex` adapter on those instances.
It did not. The naming is the orchestrator-level agent that the broader
sweep was driving, not the synthesizer's own adapter.

**Cause.** `src/verification/test-synthesizer.ts:synthesizeRegressionTest`
hardcodes `new ClaudeCodeAdapter()` as the default when no adapter is
passed in. The SWE-bench eval CLI does not thread the per-sweep tool
through to the synthesizer, so every per-agent JSONL is in fact
Claude-Code-driven synthesis. The 5/5 GENERATION_FAILED uniformity
across copilot, codex, and claude smokes from 2026-04-28 was one bug
(period-form model ID, fixed in fdbe243) counted three times.

**Workaround in v7.0.0.** None. The data the JSONLs contain is honest as
"synthesizer output for the issue text from instance X"; what's
misleading is the per-agent suffix.

**Planned fix.** Either rename the artifacts to drop the per-agent
suffix (the synthesizer is one consumer; per-agent comparison was never
the point), or actually wire the adapter selection through the eval
CLI. Until then, release notes must not claim per-agent synthesizer
comparison.

## Synth eval's basePass / goldPass signal is host-Python-sensitive

**Symptom.** On SWE-bench instances whose dependency chain doesn't
import cleanly in modern Python (e.g. `psf__requests-1766` at base
commit `847735553aed`, where `requests/packages/urllib3/packages/ssl_match_hostname/__init__.py`
uses a Python-2-style implicit relative import that fails in Python 3),
the synth eval's `basePass` and `goldPass` fields report exit-code
status from pytest collection errors, not from the synthesizer's
actual assertions. A test that's mechanically correct (asserts the
right thing about the right code path) returns `basePass: false` and
`goldPass: false` because pytest never gets past the import chain
on either side. The synth concludes `fp: false, fn: true` even though
the test the synthesizer produced is sound.

**Cause.** The synth eval runs `python -m pytest <candidate>` in a
subprocess against the orchestrator host's Python interpreter. The
`runCommand` in `scripts/eval/swebench-instance-evaluator.ts` does not
pin a Python version or set up the testbed's environment — it inherits
`process.env`. When the host is Python 3.12 and the SWE-bench instance
ships a 2014-era codebase that depends on Python-2 import syntax in a
transitive package, the import chain breaks before the test's
assertions run. Pytest exits 2 (collection error) on both base and
gold worktrees regardless of patch state.

**Important narrowing.** This is a *signal-validity* limitation, not a
*synthesizer-quality* one. The 2026-04-30 diagnostic on
`psf__requests-1766` confirmed the synthesizer produces a discriminating
test for the qop-quoting bug — manually running the same testSource
against a fresh worktree at base shows the test fail on the
`assert 'qop="auth"' in header` line (correct) and pass against the
gold patch (correct). The "synth produces wrong tests" reading is
wrong; the synth's *self-attestation* about whether its own test
passed/failed is unreliable on this class of codebase.

**Resolution gate is unaffected.** Layer 2 (FAIL_TO_PASS in the
per-instance container) runs in the SWE-bench evaluation Docker image
where the testbed has the correct Python version and the local source
imports cleanly. That's the gate that decides "resolved" or "failed"
on the headline number. The synth's basePass/goldPass is supplemental
observation, not the resolution gate.

**Planned fix.** Run the synth eval inside the per-instance SWE-bench
container so it inherits the testbed's Python version, the same way
Layer 2 does. The wiring already exists for FAIL_TO_PASS evaluation
(`benchmarks/swe-bench/Dockerfile.eval`); the v7.1 work is to extend
it to host the synth-eval CLI subprocess. Until then, the
`synth_eval.basePass` / `goldPass` fields on instances whose host-side
import chain breaks should be read as advisory only.
