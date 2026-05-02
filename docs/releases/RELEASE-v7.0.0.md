# v7.0.0 Release Notes

v7.0.0 is the scope-rewrite release. The orchestrator was rebuilt from the
v6.1 line as a verification harness with audit-trail provenance for
AI-authored bug fixes: a working pipeline that wraps Claude Code, runs an
explicit two-step worker/reviewer plan on bug-fix tasks, applies a
five-layer falsification battery (intent, regression, cheat, property,
attestation), and produces signed SLSA v1.0 attestations for every patch
that clears the battery. Validated end-to-end on Claude Code on a
worst-case Python bug-fix subset of SWE-bench Verified.

Tag: `v7.0.0` (2026-04-30). Commit range: `v6.1.0..v7.0.0` (91 commits;
version bump in `cd84e83`).

## Validated Metrics

Two distinct measurements ship with this release. State the number, name
the corpus, do not generalize.

### Falsification corpus (synthetic, calibration set)

Synthetic calibration run, 36-entry synthetic adversarial corpus, 18
broken / 18 clean. Run on
2026-04-29 with all five layers wired through the corpus harness
(`benchmarks/falsification-corpus/harness.ts`). Generated result files
are archived outside the public repository.

| Layer | False positive rate | False negative rate |
|---|---:|---:|
| intent | 0.0% (0/18) | n/a (0/0) |
| regression | 0.0% (0/18) | 0.0% (0/3) |
| cheat | 0.0% (0/18) | 0.0% (0/12) |
| property | 0.0% (0/18) | 0.0% (0/3) |
| attestation | 0.0% (0/18) | n/a (0/0) |

Composite catch rate (3-of-18 broken entries flagged for review based on
the composite-score threshold): 16.7%. The headline composite number is
low because most synthetic broken patches still score above the
human-review threshold — calibration data, not a quality claim. The
load-bearing finding is the per-layer FN rates: each layer catches its
target patterns at 0% FN on the synthetic targets it was designed for.

This is synthetic data. It validates that the layer code does what it
claims on the inputs it was built to handle. It does not measure
real-world catch rate on agent-authored patches; that measurement
requires the multi-adapter SWE-bench sweeps deferred to v8.

### SWE-bench Verified end-to-end (Claude Code, 5-instance smoke)

`benchmarks/swe-bench/results/smoke-2026-04-30-claude-code-results.json`:
5-instance smoke against the worst-case-Python subset of the 50-instance
seed-42 stratified sample (2 astropy + 3 django, all 2014–2018-era
codebases). Run on 2026-04-30 with the post-bypass pipeline (planner
bypass via `--task-type swebench`, validator drop, candidate
relocation, verifier-fix excludes).

- 4 instances executed, 1 skipped due to transient network failure
  during `git clone` (astropy-8872, exit 128 on the harness's clone)
- 2/4 effective resolution rate
- Mean wall-clock 291s (vs 700-996s on the pre-bypass 04-28 baseline)
- Diff-capture stayed under the 10MB cap on every instance (largest:
  111KB on django-10914)
- Plan shape on every instance: 2 steps `[worker, reviewer]` (planner
  bypass fired correctly)

The two failures are classified and documented in
[docs/known-gaps.md](../known-gaps.md):

- `astropy__astropy-13579` (auto-commit silently failed; agent's
  `sliced_wcs.py` Edit was lost before the worker-branch merge).
- `django__django-10999` (verifier-strictness rejection; agent landed
  the correct one-line `standard_duration_re` regex change matching
  the gold patch, the verifier rejected three replan attempts because
  the transcript lacked a build/test invocation).

Neither failure is "agent capability ceiling on this bug." Both are
verifier-pipeline interaction issues, both are v7.1 work.

## What This Means

The architecture is sound:

- The planner bypass works (every plan in the 5-instance smoke was
  the expected 2-step shape).
- Diff-capture works (zero scaffolding leakage from agent-generated
  content; the only orchestrator-emit lockfile leak is documented and
  cosmetic).
- Falsification battery layers individually catch their targets at 0%
  FN on the synthetic corpus.
- Signed SLSA v1.0 attestation flow round-trips: attest, sign with
  cosign keyless, attach as git note, verify on read. Implementation
  at `src/verification/attestation.ts` and `cosign-attestation.ts`.

The 2/4 effective rate on the 5-set reflects two known
verifier-pipeline limitations, both classified after the fact and both
documented:

- Verifier required-check list isn't task-type-aware (rejects
  acceptable agent fixes for missing build/test invocations in
  transcript).
- Auto-commit silently catches git errors; verifier's secondary
  uncommitted-changes branch passes the step on the assumption that
  auto-commit will land. When it doesn't, agent work is lost. The
  exact failure cause for each silent-catch instance is currently
  unknowable because the catch discards the error message.

## Limitations

Each of the entries below is documented in [docs/known-gaps.md](../known-gaps.md)
with symptom, structural cause, and v7.1 fix shape:

- **Keyword classifier misroutes bug-fix prose.** SWE-bench mode
  bypasses via `--task-type swebench`. The general-purpose
  `swarm run --goal` path is affected: bug-fix prose containing words
  like "server-side" misroutes to the greenfield API template.
- **Verifier required-check list isn't task-type-aware.** SWE-bench
  mode rejects acceptable agent fixes for missing build/test
  invocations in transcript.
- **Auto-commit silently catches git errors.** The verifier's
  secondary branch passes uncommitted-state steps assuming auto-commit
  will land. When it doesn't, agent work is lost. The v7.1 priority
  within the verifier work is to log the swallowed error so the
  failure class becomes observable.
- **Synth eval's basePass/goldPass signal is host-Python-sensitive.**
  Advisory-quality on instances whose dependency chain doesn't import
  cleanly in modern Python. Resolution gate (Layer 2 FAIL_TO_PASS in
  per-instance container) is unaffected.
- **`installDependenciesIfNeeded` lockfile leak.** Cosmetic; pollutes
  the agent diff on Node-shipping repos but doesn't break resolution.
- **Synthesizer per-agent JSONL filenames don't reflect actual
  per-agent execution.** The synthesizer hardcodes `ClaudeCodeAdapter`
  regardless of orchestrator-level tool. Release notes here do not
  claim per-agent synthesis comparison.

## Multi-Adapter Scope

v7.0.0 ships with full validation on Claude Code. The Copilot CLI and
Codex adapters compile, the persistent-session machinery is wired, and
both have working spawn paths in `src/adapters/`. They were not
re-validated against the post-bypass pipeline in this release cycle.

Multi-adapter validation is deferred to v8. Per the path-B decision,
v8's P10 SWE-bench sweep generates the multi-adapter baseline as part
of measuring swarm lift; running multi-adapter validation once for v8
is cleaner than twice. Until then, "shipped on Claude Code" is the
honest scope.

## What's Not Measured

- **Real-data falsification catch rate** ("X% of agent-claimed-success
  patches fail at least one layer"). The synthetic corpus number stands
  on its own evidence; a real-data number requires multi-adapter sweeps
  + hand-classification of layer disagreements + Layers 3 and 5 wired
  into the SWE-bench harness, all of which feed v8's validation path.
- **Cost-to-completion comparison vs iterative human prompting.**
  Methodology design defers to v8 or to a separate research effort.
- **Cross-repo generalization beyond the 50-instance Verified sample.**
  The 50-instance sample is stratified by repo with seed=42; it is not
  a uniform sample and does not claim representativeness across all
  Python codebases.

## Removed from v6

The v7 overhaul removed surface that didn't earn its keep on the
v7.0.0 thesis. Each of these is gone, not deprecated:

- **Persona collapse.** The six personas (`BackendMaster`,
  `FrontendExpert`, `TesterElite`, `SecurityAuditor`, `DevopsPro`,
  `IntegratorFinalizer`) collapsed to two: `worker` and `reviewer`.
  The v7 baseline audit trail is archived outside the public repository.
- **Fleet executor.** `src/fleet-executor.ts` and the `--fleet`,
  `--team-size` flags removed. Wave-of-N parallel mode removed.
- **MCP server.** `src/mcp-server.ts` and the JSON-RPC stdio
  surface removed.
- **Plan cache and replay.** `--plan-cache` and `--replay` flags
  removed, no replacement.
- **Critic governance wave.** `src/critic-reviewer.ts` removed; the
  reviewer-step pattern in the falsification battery covers the
  reviewer-pass intent without the governance-wave overhead.
- **Web dashboard runtime deps.** Ink-based TUI dependencies
  trimmed; the orchestrator's CLI output is structured-logger
  routed and respects the dashboard-owned-stdout split when present.

## Migration

See [docs/v6-to-v7-migration.md](../v6-to-v7-migration.md) for the
breaking-change list. Highlights:

- Custom persona configs in `config/agents/*.yaml` need to map to
  `worker`/`reviewer`.
- Imports from removed modules (`fleet-executor`, `mcp-server`,
  `plan-storage`, `critic-reviewer`) error at load time; rewrite call
  sites or remove them.
- `--plan-cache` / `--replay` / `--fleet` / `--team-size` flag
  invocations error; no replacement path.
- Quality gates are advisory in v7 (do not block merges); CI that
  relied on gate-failure-blocks-merge needs to switch to composite
  score thresholds via `.swarm/gates.yaml`.

## Themes Across the 91 Commits

The commit range `v6.1.0..v7.0.0` covers four workstreams:

- **P0 / persona collapse** (`feat(v7-P0):` tags). Worker/reviewer
  type system, plan-generator decomposition, downstream consumer
  updates. Commits: `b3af342`, `dfaefc4`, `1821102`, `c4bc45c`.
- **P1 / falsification battery wiring**. Differential gate, mutation
  gate, cheat detector, property gate, attestation. The synthetic
  corpus harness at `benchmarks/falsification-corpus/` plus its 2026-
  04-29 calibration run. Commits range across `chore(v7):`,
  `feat(v7):`, `refactor(v7):` scope tags.
- **SWE-bench harness rebuild and validation**. The bypass entry
  point (`feat(plan): add createSwebenchPlan bypass`, `3d5b061`),
  the synthesizer model-ID fix (`fdbe243`), candidate relocation
  (`15c33ac`), validator drop (`1db5668`), verifier-excludes fix
  (`b644031`). Plus the 04-30 5-instance smoke and 2-instance
  verifier-fix re-run that produced the resolution numbers above.
- **Documentation that survives the audit trail**. Six known-gaps
  entries with full discovery sequences (`docs/known-gaps.md`).
  Layer 1 real-data findings and the v7 phase-evidence audit are
  archived outside the public repository.

## Acknowledgements

The 04-30 round of investigation was guided by halt-on-surprise rules
that fired three times across two re-smokes. Each halt produced a
corrected understanding (validator-drop's primary blocker was a
JS-only assertion regex; auto-commit silent catch is a debug-info-loss
class, not a single-instance bug; the lockfile leak is orchestrator-
emit not quality-gate-emit). The known-gaps doc preserves the
discovery sequence for each so future work doesn't re-derive what's
already been measured.
