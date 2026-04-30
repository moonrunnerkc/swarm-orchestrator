# Swarm Orchestrator v7.0.0-alpha.0

The v7 substrate. Worker/reviewer architecture replacing v6's six-persona
hierarchy, end-to-end orchestration verified across three agent CLIs
(Claude Code, Copilot, Codex), and a five-layer falsification battery
validated as library code with CI-protected layer behavior. The battery
isn't yet wired into the per-step run path; integration is the work that
takes alpha to stable.

## What ships

**Worker/reviewer planner.** v6's six-persona hierarchy (planner,
worker_a, worker_b, qa, security, devops) collapses to two roles. The
plan generator emits worker steps for code-producing work and reviewer
steps for read-only critique, test synthesis, or domain-policy review.
Seven specialist `.agent.md` files survive in `agents/` as
deprecated-but-active fallbacks; deletion is a future PR.

**Falsification battery (library form).** Five layers, validated against
21 hand-authored synthetic adversarial patches with 21/21 detection on
broken and 21/21 cleared on clean:

- Differential gate: per-step diff comparison.
- Mutation gate: targeted mutation testing of agent-changed files.
- Cheat detector: pattern detection for hardcoded answers, exception
  swallowing, mock mutation, and test modification.
- Property gate: property-based assertions for changed surfaces.
- Composite scoring: any advisory layer firing forces human review;
  the composite score reports confidence rather than gating.

The battery is exposed as a library with a CLI entry point; production
runs still go through the evidence verifier and advisory 9-gate engine.

**Attestation envelope.** `swarm attest verify <commit>` validates a
build-time attestation envelope (sigstore cosign) that records inputs,
plan, and gate outputs. Surface for the supply-chain story when it
becomes a hard gate.

**CI regression-fixture protection.** A new GitHub Actions job runs the
synthetic calibration corpus on every push, asserts 21/21 on broken and
21/21 on clean, and fails the build if either drifts. Adversarial
fixtures are committed under `benchmarks/falsification-corpus/` with a
runner that the assertion script reads.

**Fatal-error handling on the agent run path.** The `fatal-error-classifier`
inspects every adapter's stdout/stderr for unrecoverable account-level
walls (usage-limit, expired auth, multi-hour rate-limit) and surfaces a
typed `FatalAgentError`. Adapters thread it through `AgentResult.fatalError`;
the wave scheduler aborts the run, persists `runs/<id>/fatal-run-error.json`,
and skips replan + quality-gate pipelines that cannot recover. The
SWE-bench harness reads the sentinel and folds it into the postmortem so
quota walls during a sweep no longer report as generic
"patch did not apply" failures. The matching scheduler robustness fixes
(blocked-step broker signaling, replan-dependency anchoring) eliminate
the 10-minute-per-task budget burn the codex-quota smoke run hit on
2026-04-28.

**Presenter and live-status output substrate.** A new `Presenter` owns the
user-facing CLI surface (banners, plan summary, final result) and writes
to stdout; a new `LiveStatus` owns the in-place spinner block at the
bottom of stdout. The structured logger gains a `trace` level, a
`silent` floor, and an opt-in route that sends info/debug/trace to
stderr so the presenter can own stdout without two writers
interleaving. Three new flags: `--quiet` / `-q` suppresses the
presenter, `--stream-agent` lifts agent narration above the live block,
`--max-retries <n>` tunes the replan/repair retry budget. Output spec
under `docs/output-spec.md` is the contract the presenter test pins
against.

**Verification accuracy fixes.**

- Hook evidence cross-reference suppresses the check on adapters that
  do not produce hook evidence (claude-code, codex, claude-code-teams),
  removing a synthesized "log exists and is non-empty: false" record
  that misled users on those backends.
- Quality-gate config loader accepts kebab-case spellings
  (`duplicate-blocks`) and normalizes to camelCase, bridging README
  convention and `.swarm/gates.yaml`.
- Composite scoring redesign so advisory layers cannot silently outvote
  hard layers. Premium-request count now reads from
  `cost-attribution.json` (the post-run authoritative record) instead of
  the incrementally-updated session-state metrics map.
- `SWARM_SKIP_OUTCOME_TEST_EXEC=1` opt-out for the test-exec outcome
  check, used by SWE-bench when the parent harness owns test invocation.

**Verification harness scripts.** `scripts/verify/state-mutation-audit.ts`
walks `executeSwarm` in `swarm-orchestrator.ts`, extracts the call
sequence to extracted `orchestrator/*` modules, and verifies cross-module
read/write ordering against the shared-state map. Static analysis only;
not part of the gate. Output backs the matching report under
`docs/phase-3c-mutation-audit.md`.

**Removed:** fleet executor, MCP server, plan cache/replay, critic
governance wave, dead dashboard dependencies, the unused
`ConflictResolver` queue, and the v7-pre `WorkerStep`/`ReviewerStep`/
`RoleStep` discriminated-union types that no caller imported. Repo
hygiene pass: orphaned source removed, runtime artifacts
(`verification-runs/`, per-task swe-bench `.jsonl` outputs,
`*.tmp.json`, interrupted-run sentinels) gitignored.

## What's deferred

- **Falsification battery integration into the per-step run path.** The
  battery runs as a library and against the synthetic corpus in CI.
  Production runs still use the evidence verifier and advisory 9-gate
  engine. Wiring the battery into per-step verification is the work
  that takes alpha to stable.
- **Hook evidence emission on Claude Code and Codex adapters.** Today
  only the Copilot adapter loads hooks from `<gitRoot>/.github/hooks/`.
  Adding hook emission to the other adapters is a per-adapter task.
- **Specialist `.agent.md` deletions.** Seven files in `agents/`
  (`backend_master.agent.md`, `frontend_artisan.agent.md`,
  `fullstack_engineer.agent.md`, `qa_master.agent.md`,
  `security_overseer.agent.md`, `devops_engineer.agent.md`,
  `mobile_creator.agent.md`) are documented as deprecated-but-active
  fallbacks. Deletion is a future PR after downstream consumers
  migrate.
- **SWE-bench Verified 50-instance sweep.** Funded compute pending;
  smoke runs on slugify and the curated 5-instance smoke set are the
  current evidence base.

## Evidence

- Synthetic calibration report: `benchmarks/falsification-corpus/results/synthetic-calibration-2026-04-29/report.md`
- Phase-3 verification trail: `docs/phase-3-summary.md` and the matching
  `phase-3a` through `phase-3f` slice reports under `docs/`.
- Composite scoring redesign: `docs/p1-eval-results.md` and the
  cheat-detector input/output fixtures under
  `docs/p1-eval-fixtures/eval-output/`.
- SWE-bench v6.1 preflight regression analysis (which motivated the
  default-branch detection fix in this release):
  `docs/swe-bench/v6.1-preflight-fail.md`.

## Known limitations

- End-to-end verified on slugify (small JS library). Broader
  language-and-codebase-size coverage is future work.
- Synthetic calibration corpus is hand-authored. Agent-authored catch
  rate is parked behind a hand-labeling workflow that needs more
  fixtures.
- The advisory 9-gate engine returns `passed=true` even when individual
  gates report `fail`. Promotion to hard gates is a config and
  remediation-path change tracked separately.

## Migration from v6

- Anything that consumed the fleet executor, MCP server, plan cache,
  critic governance wave, or dashboard needs to migrate before
  upgrading.
- Six-persona configs (`backend_master`, `frontend_artisan`, etc.) keep
  working through the deprecated specialist `.agent.md` files. New
  configs should use `worker` and `reviewer` roles in
  `config/default-agents.yaml`.
- The v6 `--fleet` and `--team-size` parser flags are removed.
- The example GitHub Actions workflow now builds the orchestrator from
  source in the runner instead of using the
  `moonrunnerkc/swarm-orchestrator@v5` Docker action (which never
  shipped agent CLIs). Default agent flips to `codex`.
