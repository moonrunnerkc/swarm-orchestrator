# Verification Finding Shapes

This survey covers every module in `src/verification/` and records whether its
output can become an inline PR review comment. The normalized schema is
`Finding` from `src/types/finding.ts`.

## cheat-detector

Produces `CheatDetectorResult.findings: Finding[]`.

Fields:

- `id`: stable hash of path/scope, line when present, `ruleId`, and `message`.
- `scope`: `line`, `file`, or `summary`.
- `producerId`: `cheat-detector`.
- `ruleId`: `hardcoded-answer`, `exception-swallowing`, `test-modification`,
  `complexity-mismatch`, `mock-mutation`, or a Semgrep `check_id`.
- `severity`: `high`, `medium`, or `low`.
- `message`: one sentence, 200 characters or fewer.
- `filePath`: present for `line` and `file` findings.
- `line`: present only for line-scoped findings and 1-indexed in the patched
  file.
- `endLine`: present when Semgrep reports a bounded line range.

Example:

```json
{
  "scope": "line",
  "producerId": "cheat-detector",
  "ruleId": "hardcoded-answer",
  "severity": "medium",
  "filePath": "src/token.ts",
  "line": 1,
  "message": "Implementation adds literal \"expected-token\" that also appears in test expectations."
}
```

Diff mapping:

- `hardcoded-answer` and `exception-swallowing` use added diff lines.
- `test-modification` uses the first added or context line in the changed test
  file. Deletion-only test changes fall back to file scope.
- Semgrep findings preserve `start.line` and `end.line` from Semgrep JSON.
- `complexity-mismatch` is a known gap: it is a patch-level heuristic, so it is
  file-scoped when an implementation file exists and summary-scoped otherwise.

## property-gate

Produces `PropertyGateResult.findings: Finding[]`.

Fields:

- `id`: stable hash.
- `scope`: `line`.
- `producerId`: `property-gate`.
- `ruleId`: `property-counterexample` or `generic-property-fuzzing`.
- `severity`: `medium` for typed targets, `low` for advisory untyped targets.
- `message`: includes the function name and counterexample when available.
- `filePath`: repo-relative target file path.
- `line`: function declaration line, 1-indexed in the patched file.

Example:

```json
{
  "scope": "line",
  "producerId": "property-gate",
  "ruleId": "property-counterexample",
  "severity": "medium",
  "filePath": "src/math.ts",
  "line": 1,
  "message": "Property-based test found a counterexample in reciprocal: [0] -> division by zero."
}
```

Diff mapping:

- Property findings use the parsed function declaration line. If the function
  declaration is not present in the PR diff, the diff resolver can still
  relocate within the configured hunk distance or fall back to the review body.

## mutation-gate

Produces `MutationGateResult.findings: Finding[]` and per-tool
`MutationToolResult.findings: Finding[]`.

Fields:

- `id`: stable hash.
- `scope`: `line` when mutation tool output includes `file:line`, otherwise
  `file`.
- `producerId`: `mutation-gate`.
- `ruleId`: `mutation-score-fail`, `mutation-score-warning`, or
  `mutation-tool-failed`.
- `severity`: `high` for failing scores or tool failures, `medium` for warnings.
- `message`: mutation score or tool failure summary.
- `filePath`: repo-relative target file path.
- `line`: present only when parsed from mutation tool output.

Example:

```json
{
  "scope": "line",
  "producerId": "mutation-gate",
  "ruleId": "mutation-score-warning",
  "severity": "medium",
  "filePath": "src/a.ts",
  "line": 4,
  "message": "Mutation score 0.650 did not meet the configured threshold."
}
```

Diff mapping:

- Bounded line capture is implemented by parsing source locations from Stryker,
  mutmut, or PITest style command output. When a tool emits only aggregate
  metrics, the finding remains file-scoped.

## mutation-findings

Helper used by `mutation-gate`; it produces the same `Finding[]` shape from a
single mutation tool result.

Example:

```json
{
  "scope": "file",
  "producerId": "mutation-gate",
  "ruleId": "mutation-score-fail",
  "severity": "high",
  "filePath": "src/a.ts",
  "message": "Mutation score 0.400 did not meet the configured threshold."
}
```

Diff mapping:

- Uses parsed source locations when available, otherwise file scope.

## differential-gate

Produces `DifferentialGateResult.findings: Finding[]`.

Fields:

- `id`: stable hash.
- `scope`: `line` when failing command output includes `file:line`, otherwise
  `summary`.
- `producerId`: `differential-gate`.
- `ruleId`: `invalid-regression-test`, `patch-regression-test-failed`,
  `differential-setup-failed`, or `differential-execution-failed`.
- `severity`: `high`.
- `message`: differential failure summary.
- `filePath`: present for line-scoped findings.
- `line`: present for line-scoped findings.

Example:

```json
{
  "scope": "line",
  "producerId": "differential-gate",
  "ruleId": "patch-regression-test-failed",
  "severity": "high",
  "filePath": "calc.test.js",
  "line": 3,
  "message": "Regression test still fails against the patch."
}
```

Diff mapping:

- Bounded line capture is implemented from failing test output. If the command
  output has no source location, the finding is summary-scoped.

## test-synthesizer

Does not emit verification findings. It returns `TestSynthesisResult` with:

- `status`: `GENERATED`, `AMBIGUOUS_GOAL`, or `GENERATION_FAILED`.
- `reason`: synthesis outcome.
- `attempts`: per-attempt adapter and validation evidence.
- `testFilePath`: generated test path when accepted.
- `testCommand`: generated test command when accepted.

Example:

```json
{
  "status": "GENERATED",
  "reason": "generated test fails against the base codebase",
  "testFilePath": "/repo/swarm-synth-attempt-1-regression.test.js",
  "testCommand": "node swarm-synth-attempt-1-regression.test.js"
}
```

Diff mapping:

- No findings to annotate.

## semgrep-normalizer

Helper used by `cheat-detector`; it produces `Finding[]` from Semgrep JSON
results while preserving Semgrep's `start.line` and `end.line` fields.

Example:

```json
{
  "scope": "line",
  "producerId": "cheat-detector",
  "ruleId": "swarm.test-rule",
  "severity": "high",
  "filePath": "src/app.ts",
  "line": 7,
  "endLine": 8,
  "message": "Detected a recorded Semgrep fixture finding."
}
```

Diff mapping:

- Line-scoped when Semgrep reports `start.line`; file-scoped when it reports
  only a path; summary-scoped when neither path nor line is usable.

## attestation

Does not emit verification findings. It returns attestation envelopes,
signatures, and verification results.

Example:

```json
{
  "found": true,
  "verified": true,
  "reason": "unsigned test attestation verified structurally"
}
```

Diff mapping:

- No findings to annotate.

## cosign-attestation

Does not emit verification findings. It signs and verifies attestation payloads
and returns signature metadata or `AttestationVerificationResult`.

Example:

```json
{
  "found": true,
  "verified": false,
  "reason": "cosign bundle or key signature metadata missing"
}
```

Diff mapping:

- No findings to annotate.

## composite-score

Does not emit verification findings. It returns aggregate scoring data:

- `score`
- `threshold`
- `humanReviewRequired`
- `advisoryLayerTriggered`
- `advisoryPenalty`
- `weightedLayerScore`

Example:

```json
{
  "score": 0.68,
  "threshold": 0.7,
  "humanReviewRequired": true,
  "advisoryLayerTriggered": false,
  "advisoryPenalty": 0.02,
  "weightedLayerScore": 0.7
}
```

Diff mapping:

- No direct findings to annotate.

## command-runner

Does not emit verification findings. It returns command execution evidence:

- `command`
- `cwd`
- `exitCode`
- `stdout`
- `stderr`
- `durationMs`
- `timedOut`

Example:

```json
{
  "command": "npm test",
  "cwd": "/repo",
  "exitCode": 1,
  "stdout": "",
  "stderr": "AssertionError",
  "durationMs": 250,
  "timedOut": false
}
```

Diff mapping:

- No direct findings to annotate.

## diff-analysis

Does not emit verification findings. It parses unified diffs into:

- `oldPath`
- `newPath`
- `lines[].kind`
- `lines[].content`
- `lines[].oldLine`
- `lines[].newLine`

Example:

```json
{
  "oldPath": "src/a.ts",
  "newPath": "src/a.ts",
  "lines": [{ "kind": "add", "content": "export const x = 1;", "newLine": 1 }]
}
```

Diff mapping:

- This layer supplies line data for other layers but does not produce findings.

## source-locations

Does not emit verification findings. It extracts source locations from command
output into:

- `filePath`: repo-relative path.
- `line`: positive 1-indexed source line.

Example:

```json
{
  "filePath": "src/a.ts",
  "line": 5
}
```

Diff mapping:

- This helper supplies bounded line capture for mutation and differential
  findings when external tool output includes source locations.
