# Release v4.2.0

## What changed

Three new capabilities ship in this release: OWASP ASI compliance mapping for the verification layer, structured run reports that turn every execution into publishable output, and a multi-tool adapter layer with Claude Code Agent Teams support.

### OWASP ASI Compliance Mapping

The orchestrator already mitigated the coding-agent-relevant ASI risks through branch isolation, outcome verification, and failure classification. This release labels what we already do.

New modules:
- `src/owasp-mapper.ts` (206 lines): Maps completed verification results to the OWASP Top 10 for Agentic Applications (ASI-01 through ASI-10). Pure logic, no I/O.
- `src/owasp-report-renderer.ts` (43 lines): Renders compliance reports as Markdown and JSON.

Of the 10 ASI risks, 6 apply to the execution model. 4 are explicitly marked not applicable (data leakage, knowledge poisoning, insecure communication, supply chain) with rationale.

New CLI flag: `--owasp-report` on `swarm swarm` and `swarm run`. After verification completes, writes `owasp-compliance.md` and `owasp-compliance.json` to the run directory.

### Structured Run Reports

Every run produces session-state.json, metrics.json, cost-attribution.json, and per-step verification reports. Assembling a coherent narrative was manual work. Now one command does it.

New modules:
- `src/report-generator.ts` (183 lines): Reads run directory artifacts, assembles a `RunReport` object. Handles missing optional data gracefully.
- `src/report-renderer.ts` (89 lines): Renders to Markdown, JSON, and a single-line TUI summary.

New CLI command: `swarm report <run-id>` with `--format md|json`, `--stdout`, and `--latest` flags.

### Multi-Tool Adapter Layer

The adapter layer now supports three agent tools (copilot, claude-code, claude-code-teams) through a unified factory with shared process supervision.

New modules:
- `src/adapters/adapter-factory.ts` (35 lines): Resolves adapter by tool name. Accepts `AdapterFactoryOptions` with `teamSize`.
- `src/adapters/claude-code-adapter.ts` (46 lines): Claude Code subprocess adapter with stall detection.
- `src/adapters/claude-code-teams.ts` (171 lines): Maps plan waves to Claude Code Agent Teams. One team per wave, verification stays external, fallback to standard adapter on failure.
- `src/adapters/process-supervisor.ts` (223 lines): Extracted stall detection (stdout silence, total timeout, output size limits) from SessionExecutor into a shared module. Both Claude adapters use it.

New CLI flags:
- `--tool <name>`: Agent tool selection (copilot, claude-code, claude-code-teams)
- `--team-size <n>`: Max concurrent teammates per wave with claude-code-teams (1-5, default 5)

### Orchestrator Integration

- `src/swarm-orchestrator.ts`: Uses `resolveAdapter()` for non-copilot tools. Runs OWASP mapper after verification when `--owasp-report` is set.
- `src/cli-handlers.ts`: Parses `--tool`, `--team-size`, and `--owasp-report` flags. Validates team-size range. Passes options through to orchestrator.

## Numbers

| Metric | Value |
|--------|-------|
| Files changed (since v4.1.0) | 28 (9 modified, 19 new) |
| Lines added | 2,811 |
| Lines removed | 53 |
| New source modules | 8 files, 996 lines |
| New test files | 6 files, 1,043 lines |
| New tests | 73 (18 + 9 + 12 + 14 + 10 + 10) |
| Total source files | 87 |
| Total test files | 114 |
| Total source lines | 21,747 |
| Total test lines | 22,195 |
| Total passing tests | 1,629 |
| Build errors | 0 |

## New modules

| Module | Lines | Tests | Passing |
|--------|-------|-------|---------|
| owasp-mapper.ts | 206 | owasp-mapper.test.ts (194 lines) | 18 |
| owasp-report-renderer.ts | 43 | owasp-report-renderer.test.ts (129 lines) | 9 |
| report-generator.ts | 183 | report-generator.test.ts (264 lines) | 12 |
| report-renderer.ts | 89 | report-renderer.test.ts (165 lines) | 14 |
| adapters/claude-code-teams.ts | 171 | adapters/claude-code-teams.test.ts (129 lines) | 10 |
| adapters/process-supervisor.ts | 223 | adapters/process-supervisor.test.ts (162 lines) | 10 |
| adapters/adapter-factory.ts | 35 | (covered by claude-code-teams tests) | - |
| adapters/claude-code-adapter.ts | 46 | (covered by claude-code-teams tests) | - |

## CLI changes

New command:
```
swarm report <run-id>     Generate structured run report from artifacts
  --format md|json          Output format (default: both)
  --stdout                  Print to terminal instead of writing files
  --latest                  Use most recent run directory
```

New flags on swarm/run:
```
--owasp-report            Generate OWASP ASI compliance report after verification
--tool <name>             Agent tool: copilot, claude-code, claude-code-teams
--team-size <n>           Max concurrent teammates per wave (1-5, default 5)
```

## Output artifacts (new)

```
runs/<execution-id>/
  owasp-compliance.md       OWASP ASI compliance report (Markdown)
  owasp-compliance.json     OWASP ASI compliance report (JSON)
  report.md                 Structured run report (Markdown)
  report.json               Structured run report (JSON)
```

## Testing

All 1,629 tests pass. Each new module tested in isolation and as part of the full suite:

```
mocha dist/test/owasp-mapper.test.js           18 passing
mocha dist/test/owasp-report-renderer.test.js   9 passing
mocha dist/test/report-generator.test.js        12 passing
mocha dist/test/report-renderer.test.js         14 passing
mocha dist/test/adapters/claude-code-teams.test.js  10 passing
mocha dist/test/adapters/process-supervisor.test.js  10 passing
```

## Known issues

- The `swarm dashboard` command fails with a React rendering error. This is pre-existing (present in v4.1.0) and unrelated to v4.2.0 changes.

## Upgrade path

No breaking changes. The adapter interface is unchanged. Existing `--tool copilot` (default) behavior is identical. New flags are opt-in. The `swarm report` command works against any existing run directory that has a `session-state.json`.
