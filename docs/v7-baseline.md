# v7 Overhaul Baseline Metrics

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
