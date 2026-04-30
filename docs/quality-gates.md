# Quality Gates

Swarm Orchestrator ships a 9-gate quality engine under `src/quality-gates/`. The engine runs after step branches have merged and writes a Markdown plus JSON report.

Gate findings are advisory today. A gate can report `status: "fail"`, but `run_quality_gates` writes `advisory: true` and does not block branch merges. Promoting advisory findings to hard gates is planned work.

## Reports

By default, swarm mode writes reports to:

```text
<runDir>/quality-gates/quality-gates.md
<runDir>/quality-gates/quality-gates.json
```

The CLI can also run the engine directly:

```bash
swarm gates .
swarm gates . --output json
swarm gates . --quality-gates-config .swarm/gates.yaml
swarm gates . --quality-gates-out reports/gates
swarm gates . --base-commit HEAD~1
swarm gates . --sarif reports/swarm-gates.sarif
```

`--sarif -` writes SARIF to stdout. `--output json` and `--sarif -` cannot be combined because both need stdout.

## Built-in gates

| Report ID | Config key | Source | What it checks |
| --- | --- | --- | --- |
| `scaffold-defaults` | `scaffoldDefaults` | `src/quality-gates/gates/scaffold-defaults.ts` | Flags default scaffold titles, default README text, banned placeholder files, and tracked artifacts that should be ignored. |
| `duplicate-blocks` | `duplicateBlocks` | `src/quality-gates/gates/duplicate-blocks.ts` | Finds repeated nonblank code blocks over the configured line and occurrence thresholds. |
| `hardcoded-config` | `hardcodedConfig` | `src/quality-gates/gates/hardcoded-config.ts` | Scans for hardcoded localhost URLs, retry counts, ports, and similar config literals unless a config file or environment variable pattern is present. |
| `readme-claims` | `readmeClaims` | `src/quality-gates/gates/readme-claims.ts` | Checks configured README claims against required code evidence. |
| `test-isolation` | `testIsolation` | `src/quality-gates/gates/test-isolation.ts` | Detects module-scope mutable stores in JavaScript or TypeScript without a reset strategy in source or tests. |
| `runtime-checks` | `runtimeChecks` | `src/quality-gates/gates/runtime-checks.ts` | Runs available project checks: tests, ESLint, and npm audit when the target project has the relevant config. |
| `accessibility` | `accessibility` | `src/quality-gates/gates/accessibility.ts` | Checks HTML, JSX, and CSS for accessibility and UX signals such as skip links, heading order, aria labels, focus styles, reduced motion, real assets, meta tags, responsive CSS, color scheme, semantic landmarks, and image alt text. |
| `test-coverage` | `testCoverage` | `src/quality-gates/gates/test-coverage.ts` | Checks that source files have matching or importing tests, test files include assertions, and React projects have component-level tests. |
| `test-file-protection` | `testFileProtection` | `src/quality-gates/gates/test-file-protection.ts` | Uses `git diff` from a base commit to flag modifications to pre-existing test files. |

## Advisory status

The current runner sets the top-level result to passed even when individual gate results fail:

```json
{
  "passed": true,
  "advisory": true,
  "results": [
    {
      "id": "runtime-checks",
      "status": "fail",
      "issues": []
    }
  ]
}
```

This means gate findings do not stop branch merges. The CLI and CI wrappers may still inspect individual gate statuses and treat failed findings as a failed job after the merged result has been reported. That behavior is reporting, not a pre-merge hard gate.

## Config resolution

Config resolution is implemented in `src/quality-gates/config-loader.ts`.

Resolution order:

1. Built-in defaults from `src/quality-gates/default-config.ts`.
2. Project `.swarm/gates.yaml`, when present.
3. Explicit `--quality-gates-config <path>`, when provided.
4. Legacy `config/quality-gates.yaml`, only when neither project nor explicit config was used.

Unknown gate keys in user-provided config raise a descriptive error. YAML syntax errors include the source file path.

## Config shape

The shipped config example is [../config/quality-gates.yaml](../config/quality-gates.yaml).

```yaml
enabled: true
failOnIssues: true

autoAddRefactorStepOnDuplicateBlocks: true
autoAddReadmeTruthStepOnReadmeClaims: true
autoAddScaffoldFixStepOnScaffoldDefaults: true
autoAddConfigFixStepOnHardcodedConfig: true
autoAddAccessibilityFixStepOnAccessibility: true
autoAddTestCoverageStepOnTestCoverage: true

excludeDirNames:
  - node_modules
  - dist
  - runs

maxFileSizeBytes: 200000

gates:
  duplicateBlocks:
    enabled: true
    minLines: 12
    maxOccurrences: 2
    maxFindings: 20

  runtimeChecks:
    enabled: true
    retries: 1
    runTests: true
    runLint: true
    runAudit: true
    timeoutMs: 120000

  testFileProtection:
    enabled: true
    testFileGlobs:
      - 'tests/**'
      - '**/*.test.ts'
    maxFindings: 25
```

`failOnIssues` and the `autoAdd*` remediation flags are retained for the planned hard-gate path. In the current advisory runner, they do not turn gate findings into pre-merge blockers.

## Target mode scoping

The registry defines self-improvement gates in `SELF_IMPROVEMENT_GATE_KEYS`. When swarm runs against an external target repo, the orchestrator skips those self-improvement gates and still runs universal gates.

Skipped in target mode:

- `scaffoldDefaults`
- `duplicateBlocks`
- `readmeClaims`
- `testIsolation`
- `runtimeChecks`
- `accessibility`
- `testCoverage`

Always eligible:

- `hardcodedConfig`
- `testFileProtection`

The intent is to avoid applying the orchestrator's own app-quality conventions to unrelated target repos while preserving behavior contracts that apply to agent edits.

## Baseline-aware gates

Some gates use baseline file data so they only flag agent-created or agent-modified work:

- `accessibility` only checks files not present in `baselineFiles`.
- `testCoverage` only flags uncovered source and weak tests for files not present in `baselineFiles`.
- `testFileProtection` compares against `baseCommit` and flags modified test files.
- `runtimeChecks` scopes ESLint to changed files when a base commit is available.

## Custom project gates

Project gates can be registered from either:

```text
.swarm/gates/index.js
.swarm/gates/index.cjs
```

The module can export `registerGates`, `gates`, or a default export. A registered gate must provide:

```typescript
{
  key: 'myGate',
  title: 'My Gate',
  defaultConfig: { enabled: true },
  async run(ctx, config) {
    return {
      id: 'my-gate',
      title: 'My Gate',
      status: 'pass',
      durationMs: 0,
      issues: []
    };
  }
}
```

Custom gate keys are then valid under the `gates:` section of `.swarm/gates.yaml`.
