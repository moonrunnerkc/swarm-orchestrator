# Rule check types

Swarm's orchestration mode (`swarm run`, `swarm compile`) grades a patch
against a typed *rule set*. The internal API name is still `Obligation` — only
the docs vocabulary moved to *rule* / *check* in v10.

Every rule entry has a `type` field; the engine knows how to evaluate each
type listed below. The full JSON Schema lives at
[`src/contract/schema/v1.json`](../src/contract/schema/v1.json).

## Built-in types

| Type | Grades |
|---|---|
| `file-must-exist` | A required file exists on disk. |
| `build-must-pass` | A build command exits `0`. |
| `test-must-pass` | A test command exits `0`. |
| `function-must-have-signature` | A function keeps the declared signature. Both declaration-style (`(...): T`) and arrow-style (`(...) => T`) are accepted. |
| `property-must-hold` | A shell predicate exits `0`. |
| `import-graph-must-satisfy` | Import-graph property (e.g. no cycles, no forbidden edges). |
| `coverage-must-exceed` | A coverage metric stays above a threshold. |
| `performance-must-not-regress` | A benchmark stays within tolerance of a baseline. |

## Real-world patterns

```yaml
# Reject PRs that drop line coverage below 80%
obligations:
  - type: coverage-must-exceed
    scope: coverage/coverage-summary.json
    metric: lines
    threshold: 80
```

```yaml
# Enforce module boundaries: walk src/ and reject any import cycle
obligations:
  - type: import-graph-must-satisfy
    constraint: no-cycles
    scope: src/
```

```yaml
# Verify a specific function signature survives refactors
obligations:
  - type: function-must-have-signature
    file: src/api/handler.ts
    name: handleRequest
    signature: "(req: Request, res: Response) => Promise<void>"
```

```yaml
# Shell predicate: no debugger statements committed
obligations:
  - type: property-must-hold
    predicate: "! grep -r 'debugger' src/"
    target: "no debugger statements in src/"
```

```yaml
# Performance regression gate
obligations:
  - type: performance-must-not-regress
    benchmark: "node scripts/bench.js"
    baseline: benchmarks/build.baseline.json
    threshold: 0.20
```

## Cheat detectors (audit mode)

`swarm audit` runs a separate set of grader modules on a unified diff. The
detector taxonomy (test relaxation, mock-of-hallucination, assertion strip,
no-op fix, and the Phase-2 extensions) is documented in the README and
implemented under [`src/audit/cheat-detector/`](../src/audit/cheat-detector/).
The cheat-detector engine is independent of the rule-set runtime: a PR can be
audited without a contract file.
