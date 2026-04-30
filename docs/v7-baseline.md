# v7 Overhaul Baseline Metrics

> Baseline snapshot pre-v7 cleanup. Files referenced here may no longer exist; numbers are historical and not updated as the v7-overhaul branch progresses.

Captured: 2026-04-25, before any v7 code changes.
Branch created from HEAD `83d1d93` (main, post-v6.1.0 release commit).

## Version

`package.json` version at branch point: `6.1.0`
Version bumped to `7.0.0-alpha.0` as first commit on `v7-overhaul`.

## Test Suite (HEAD, pre-overhaul)

```
1452 passing (36s)
6 pending
0 failing
```

## Source File Count

`src/`: 81 files
`test/`: 95 files

## Key Module Line Counts

| Module | Lines |
|---|---|
| `src/plan-generator.ts` | 1396 |
| `src/swarm-orchestrator.ts` | 870 |
| `src/fleet-executor.ts` | 282 |
| `src/mcp-server.ts` | 769 |
| `src/knowledge-base.ts` | 340 |
| `src/plan-storage.ts` | 154 |
| `src/critic-reviewer.ts` | 65 |
| `src/context-broker.ts` | 412 |
| `src/demo-mode.ts` | 164 |
| `src/config-loader.ts` | 390 |
| `src/gate-prompt-builder.ts` | 143 |
| `src/pm-agent.ts` | 308 |
| `src/hook-generator.ts` | 289 |

## Persona Reference Counts (pre-removal)

### Source files (91 total hits)

| File | Hits |
|---|---|
| `src/plan-generator.ts` | 77 |
| `src/gate-prompt-builder.ts` | 4 |
| `src/config-loader.ts` | 3 |
| `src/pm-agent.ts` | 2 |
| `src/demo-mode.ts` | 2 |
| `src/swarm-orchestrator.ts` | 1 |
| `src/hook-generator.ts` | 1 |
| `src/fleet-executor.ts` | 1 (removal target) |

### Test files

| File | Hits |
|---|---|
| `test/plan-generator.test.ts` | 79 |
| `test/spec-aware-planning.test.ts` | 26 |
| `test/pm-agent.test.ts` | 26 |
| `test/agents-exporter.test.ts` | 22 |
| `test/session-manager.test.ts` | 16 |
| `test/hook-generator.test.ts` | 16 |
| `test/config-loader.test.ts` | 14 |
| `test/pr-manager.test.ts` | 12 |
| `test/metrics-collector.test.ts` | 12 |
| `test/fleet-executor.test.ts` | 12 |
| `test/pr-automation.test.ts` | 8 |
| `test/report-generator.test.ts` | 7 |
| `test/step-runner.test.ts` | 6 |
| `test/copilot-planning.test.ts` | 6 |
| `test/persistent-sessions.test.ts` | 5 |
| `test/context-broker.test.ts` | 4 |
| `test/session-executor.test.ts` | 3 |
| `test/report-renderer.test.ts` | 3 |
| `test/plan-storage.test.ts` | 3 |
| `test/plan-cache-replay.test.ts` | 3 |
| `test/cost-attribution.test.ts` | 3 |
| `test/test-command-discovery.test.ts` | 2 |
| `test/templates.test.ts` | 2 |
| `test/multi-repo.test.ts` | 2 |
| `test/governance.test.ts` | 1 |

## Non-Planner Persona Reference Classification

| File | Line(s) | Classification |
|---|---|---|
| `gate-prompt-builder.ts` | 19, 22, 25 | **Routing** (Sets for prompt-type branching) |
| `gate-prompt-builder.ts` | 137 | Comment |
| `config-loader.ts` | 270, 361, 379 | **Config mapping** (PascalCase -> snake_case) |
| `pm-agent.ts` | 94, 98 | **Routing** (IntegratorFinalizer last-step check) |
| `demo-mode.ts` | 69, 70 | JSDoc comment |
| `swarm-orchestrator.ts` | 200 | JSDoc comment |
| `hook-generator.ts` | 205 | **Routing** (test-modification permission by persona) |
| `fleet-executor.ts` | 222 | Comment (removal target) |

No unexpected routing dependencies. No halt condition triggered.

---

## Post-overhaul phase-evidence audit

Captured 2026-04-30 to reconcile the v7-overhaul phase claims against
committed evidence. Documents what backs each claim and where the
commit trail lives, so future audits don't re-derive the same map.

### P0 — Worker/reviewer collapse

Commits tagged `feat(v7-P0):`, found cleanly under `git log --grep=v7-P0`:

- `c4bc45c feat(v7-P0): replace 6 persona agents with worker/reviewer in config and agents/`
- `1821102 feat(v7-P0): update downstream persona consumers to worker/reviewer roles`
- `dfaefc4 feat(v7-P0): collapse plan-generator.ts from 6 personas to worker/reviewer roles`
- `b3af342 feat(v7-P0): add WorkerStep/ReviewerStep/RoleStep types in src/types/plan.ts`

Deliverable: `src/types/plan.ts` (`WorkerStep | ReviewerStep | RoleStep`),
`src/plan-generator.ts` (worker/reviewer assignment), `config/default-agents.yaml`.

### P0.5 — Named-session stress test

Commit: `ffd4035 test(stage-p0): record named session stress result`
(2026-04-26). The `git log --grep=P0.5` filter misses this because the
scope tag is `stage-p0`, not `v7-P0.5`. Future searches that need to
locate stage-tagged commits should grep for the deliverable filename
instead of guessing the scope tag.

Deliverable: `docs/stress-test-results.md`.

### P1 — Falsification battery layers

Wiring commits land under multiple scope tags (`feat(v7-P1)`, `chore(v7)`,
plus the eval-script work that landed as part of the swebench harness
buildout). Status doc: `docs/p1-eval-results.md`. Per-layer source:
`src/verification/{differential-gate,test-synthesizer,mutation-gate,cheat-detector,property-gate,attestation,cosign-attestation}.ts`.

The 2026-04-29 falsification-corpus run (`benchmarks/falsification-corpus/results/synthetic-calibration-2026-04-29/`)
exercises all five layers with per-layer FN rates of 0% on the synthetic
target sets (intent, regression, cheat, property, attestation). The
SWE-bench harness wires only B.1 (synth) and B.3 (property) as spot-checks
by design — see `docs/p1-real-data-findings.md` for the real-data
behaviour of Layer 1 specifically.

### P2 — Benchmark guardrails

Doc: `docs/p2-benchmark-results.md` (2026-04-26). Baseline numbers
verified against raw data on 2026-04-30:

| Benchmark | Doc value | Raw mean (`wall_clock_ms / 1000`) | Source |
|---|---:|---:|---|
| demo-fast | 84.3s | 84.27s | `benchmarks/harness/raw_data/demo-fast/metrics.jsonl` (n=10) |
| api-quick | 359.1s | 359.07s | `benchmarks/harness/raw_data/api-quick/metrics.jsonl` (n=5) |

No drift. The 0.03-0.05s differences are expected rounding (doc rounds
to 1 decimal, raw is full precision).

### P3 — Context broker (deferred)

Commit: `6354e48 docs(v7): document P3 context broker deferral past 7.0.0`.
Deliverable: `docs/p3-deferral.md`. The `src/context/embedding-store.ts`
slot is reserved in the v7 module layout but not implemented in 7.0.0.
