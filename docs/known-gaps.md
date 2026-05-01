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

**Two flavors of the same bug.** The `psf__requests-1766` case is a
*false-fail*: the local 2014-era requests's import chain breaks in
modern Python, pytest exits 2 with a collection error, the synth reads
exit 2 as "failed against base → ACCEPT," but the failure was the
import chain, not the assertion. The `astropy__astropy-13579` case
(2026-04-30 2-instance re-run) is a *false-pass*: the local
2018-era astropy *does* import in modern Python, but the candidate
test resolves `import astropy.wcs` to the host's site-packages
astropy (post-2022, has the fix). The test runs against the
host-installed package (with the fix), assertion passes, synth reads
exit 0 as "passed against base → REJECT," but the passing test was
not actually exercising the local source. Both flavors trace to the
same host-Python-vs-instance-Python mismatch and both are addressed
by the same v7.1 fix below.

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

## Verifier required-check list isn't task-type-aware

**Symptom.** On SWE-bench bug-fix tasks, the orchestrator's per-step
verifier rejects steps whose agent landed the correct fix but didn't
emit "build executed" or "test execution" evidence in the transcript.
Observed on `django__django-10999` in the 2026-04-30 5-instance smoke
and the 2-instance re-run: the agent applied the correct one-line
regex change to `standard_duration_re` (matching the gold patch
exactly), the verifier's "Agent produced code changes" check passed
correctly, but the step still failed because:

- "Build executed (required)": no build commands found in transcript
- "Verify claim 'All 32 tests pass': no test execution found in transcript"

Three replan attempts hit the same wall. The agent's fix was
mechanically correct; the SWE-bench evaluator's container test would
have validated it.

**Cause.** `src/verifier-engine.ts:verifyStep` runs the same
required-check list regardless of task type. SWE-bench mode passes
through `--task-type swebench` to the planner but not to the verifier,
so the verifier still demands the same build/test execution evidence
it would for greenfield-app worker steps. For SWE-bench, the
authoritative resolution gate is Layer 2 (FAIL_TO_PASS inside the
per-instance Docker image, with the correct testbed Python and
dependency setup). The orchestrator-host's "ran a build/test command"
check is redundant signal at best and verifier-strictness-induced
false rejection at worst.

**Resolution gate is unaffected.** When the agent's fix actually lands
on the worker branch, Layer 2 in the container decides resolution.
django-10914 and django-11099 both resolved despite the verifier
requiring multiple retries — the issue is wasted budget per instance
(replan attempts cost premium requests), not lost resolution.

**Planned fix.** Make the required-check list task-type-aware. Under
`--task-type swebench`, skip "build executed" and "test execution"
required checks; rely on Layer 2 in the container as the authoritative
gate. Worker-step "agent produced code changes" stays required. The
classifier-bypass surface added for v7.0.0 already has the wiring;
v7.1 extends it from planner to verifier.

## Auto-commit silently swallows errors; verifier accepts uncommitted as success

**Symptom.** On `astropy__astropy-13579` in the 2026-04-30 2-instance
re-run, the agent's transcript described identifying and fixing the
`sliced_wcs.py:245-257` bug correctly. The worker-branch reflog shows
zero post-creation entries. The diff against base shows zero agent
code changes. Yet step 1 was marked verified, the worker branch was
merged into main as a no-op, and resolution failed.

**Cause.** Two interacting components:

1. `src/orchestrator/step-executor.ts:347-371` runs an auto-commit
   block: `git status --porcelain` + `git add -A -- . <excludes>` +
   `git commit -m "auto-commit ..."`. The whole sequence is wrapped
   in a `try { ... } catch { /* non-fatal */ }` that swallows every
   error class with a single comment ("Commit may fail if working tree
   is truly clean or in detached HEAD"). The catch does not
   distinguish "truly clean = no-op" from "commit failed for an
   actionable reason" — staging conflict, locked index, identity
   missing, etc. all silently produce the same observable: no commit
   landed.
2. `src/verifier/outcome-checks.ts:checkGitDiff` falls through to a
   "secondary uncommitted-changes" branch when no committed agent
   changes are found. That branch passes the step with evidence
   "agent completed work without committing" — assuming a downstream
   auto-commit will land. When auto-commit silently fails (per #1),
   the verifier's secondary branch returns passed=true on a worker
   branch that is about to be merged with no commits.

The combination produces a step marked verified despite zero work
landing. Confirmed on astropy-13579 via the reviewer-step-2 review
report, which captured the verifier's evidence string verbatim:
`"1 file(s) modified in working tree (uncommitted) — agent completed
work without committing"`. The agent did modify a tracked file; the
auto-commit's `git commit` then failed silently and the verifier's
secondary branch papered over it.

**Why this works on some instances and not others.** `psf__requests-1766`
and the resolved django instances showed auto-commit firing correctly
(`auto-commit uncommitted work from step N (worker)` commits visible
in their git logs). The exact reason auto-commit succeeds on some
instances and fails on others is lost to the silent catch — by design
the error message is discarded. Reproducing requires either tightening
the catch to log the error, or running with verbose git tracing, both
of which are v7.1 work.

**Resolution gate is unaffected when auto-commit succeeds.** When the
agent's commit lands (the common case), Layer 2 validates the fix
correctly and resolution works. The failure mode here is "agent did
the work, orchestrator lost it before merge" — a tail-risk that
manifested as 1-of-4 in the 2026-04-30 5-instance smoke.

**Planned fix.** Two complementary changes in v7.1, with priority on
the first:

1. **(Priority within v7.1 verifier work.)** Tighten the auto-commit
   catch to log the swallowed error to the run's structured log
   instead of silently discarding it. The current catch loses the
   exact error class — staging conflict, locked index, identity
   missing, working-tree race — so every future investigation of "why
   didn't this run land cleanly" hits the same wall the 2026-04-30
   investigation did. Logging is a small change with high diagnostic
   value: post-hoc investigation gets signal, the catch can still
   continue execution non-fatally for cases that are legitimately
   no-ops, and the failure-mode distribution becomes measurable across
   future runs. Once the error class is observable, distinguishing
   "truly clean" from "commit failed for actionable reason" becomes
   evidence-driven instead of code-reading-driven.
2. Tighten the verifier's secondary uncommitted-changes branch to
   require committed evidence for steps whose work needs to survive
   the worker-branch merge. The current "agent completed work
   without committing" semantics presupposes auto-commit always
   lands; that assumption is what makes the silent-failure mode
   merge-survivable.

The two fixes are paired: (1) makes the failure class observable; (2)
prevents it from masquerading as success. Either alone would close
some of the failure surface but leave a different class open. Both
together make "work-but-not-committed" a hard fail at the verifier
with a diagnosable error from the auto-commit step. (1) is the
priority because it converts an unknown-unknown into a known-unknown,
which is what the rest of the verifier work needs in order to be
evidence-driven.

## installDependenciesIfNeeded lockfile leak on Node-shipping repos

**Symptom.** SWE-bench instances whose target repo ships a vestigial
`package.json` at the base commit (django ships eslint+grunt+qunit
config from 2014-era frontend test work) produce a `package-lock.json`
(~100KB) at repo root that leaks into `capture_agent_diff` via
`git add -A -N`. Observed on every django instance in the 2026-04-30
5-instance smoke. Doesn't break resolution (the lockfile addition is
non-conflicting; SWE-bench's evaluator applies the patch and runs
FAIL_TO_PASS on the actual code change), but pollutes the agent diff
with ~2839 lines of orchestrator-emit content the agent never authored.

**Cause.** `src/orchestrator/git-state-utils.ts:installDependenciesIfNeeded`
runs unconditionally between merge-cleanup and final-quality-gates
whenever `package.json` exists at repo root. Its purpose is real: when
an agent on a Node project adds `express` or `cors` to `package.json`,
the orchestrator needs to `npm install` those before `npm test` runs
in quality gates. The function is adapter-agnostic and task-agnostic;
it has no signal that distinguishes "orchestrator running on a real
Node project" from "orchestrator running on a Python repo whose
vestigial package.json is unrelated to the agent's work."

The leak is `npm install`'s side effect: even when the install
partially fails (e.g., 2014-era `eslint@^0.22.1` no longer resolves
cleanly in modern npm), npm produces a `package-lock.json` at repo
root before bailing on the install proper. The lockfile is at repo
root, not in `node_modules/` (which is in
`worktree-reserved-paths.ts`'s `BUILD_ARTIFACT_RESERVED_PATHS`), and
nothing excludes it from `git add -A -N`.

**Cosmetic, not load-bearing.** All resolved django instances on the
2026-04-30 smoke (django-10914, django-11099) resolved cleanly despite
the lockfile in the diff. The unresolved django-10999 was unrelated
to the lockfile (verifier rejected the agent's code-fix steps; the
lockfile was the only thing in the final diff because no real fix
landed). For inspection purposes, the lockfile is noise; for the
SWE-bench evaluator, it's a no-op patch hunk.

**Planned fix.** Move `installDependenciesIfNeeded` to run in a
scratch directory outside the agent's worktree, then symlink or copy
`node_modules/` back into the worktree for quality-gate consumption.
The lockfile lives in the scratch dir and never touches the agent's
view of the repo. This is the same v7.1 structural-scratch-dir work
the planner-bypass entry above references; both have the same shape
("orchestrator-emit content shouldn't pollute agent worktrees,
period") and resolve together.
