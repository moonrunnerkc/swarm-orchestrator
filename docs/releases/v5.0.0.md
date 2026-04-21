# v5.0.0 Release Notes

Three new features focused on catching quality issues earlier, reducing repair cycles, and integrating with existing CI/CD workflows.

## SARIF Output from Quality Gates

Quality gate violations can now be exported as SARIF 2.1.0 JSON for GitHub code scanning. This produces inline PR annotations for every gate violation alongside existing CodeQL or third-party scanner results.

```bash
swarm gates ./repo --sarif results.sarif
swarm gates ./repo --sarif -  # stdout
```

The GitHub Action gains a `sarif: true` input that runs gates and produces SARIF output automatically. All eight gate types map to SARIF rules with `swarm/` prefixed IDs. Failed gates produce error-level results; skipped gates with issues produce note-level entries.

New files: `src/sarif-formatter.ts`, `test/sarif-formatter.test.ts`
Modified: `src/cli-handlers.ts`, `action.yml`, `entrypoint.sh`

## Per-Project Gate Configuration

Projects can now override gate defaults by placing a `.swarm/gates.yaml` file in their repository root. The schema is identical to `config/quality-gates.yaml`; only include fields that differ from defaults.

```yaml
# .swarm/gates.yaml
gates:
  duplicateBlocks:
    minLines: 20
  accessibility:
    enabled: false
```

Config resolution: built-in defaults, then `.swarm/gates.yaml`, then `--quality-gates-config`. Unknown gate keys now produce a descriptive error listing valid names. YAML syntax errors surface the file path.

The config loader also returns defensive copies, preventing shared-state mutation across concurrent gate runs.

Modified: `src/quality-gates/config-loader.ts`
New test: `test/gate-config-resolver.test.ts`

## Spec-Aware Planning

The plan generator reads the resolved gate configuration before generating steps. When gates are enabled, corresponding requirements are appended as concise clauses to each step's agent prompt:

- `scaffoldDefaults`: "Remove all TODO comments, placeholder text, and default scaffold values before completing."
- `duplicateBlocks`: "Avoid duplicating code blocks. Extract shared logic into utility functions."
- `testCoverage`: "Achieve thorough test coverage. Test every exported function and major code path."
- And similar clauses for all eight gates.

Clauses are filtered by step category (code-generation, test, frontend, documentation). When `testCoverage` is enabled and the plan has no TesterElite step, one is injected automatically.

The cost estimator reduces the estimated retry probability by 30% when gate-aware prompts are active, reflecting fewer repair cycles from front-loaded requirements.

New files: `src/gate-prompt-builder.ts`, `test/spec-aware-planning.test.ts`
Modified: `src/plan-generator.ts`, `src/cost-estimator.ts`

## Bug Fixes (discovered during E2E validation)

Seven bugs were found and fixed across two E2E validation campaigns against a real Python/FastAPI project (PromptVault, 5 coordinated agents, claude-code).

### SARIF stdout contamination

When using `--sarif -` (stdout mode), gate status messages from `console.log` were interleaved with the JSON output, producing invalid SARIF. Status messages now route to `stderr` when SARIF targets stdout.

Commit: `d121a35`

### Run command argument parsing

`handleRunCommand` included flag values in the goal string. Running `swarm run "Add feature X" --tool claude-code --target ./repo` would produce a goal of `"Add feature X claude-code ./repo"`. Rewritten with a `valuedFlags` set and proper positional argument extraction.

Commit: `fe0b3af`

### Double-run on plan files

After a plan-file swarm completed, the `try-catch` block around `storage.loadPlan()` also wrapped `executeSwarm()`, causing fallthrough to the goal-based path, which launched a second swarm. Separated plan detection from execution.

Commit: `03ccfe0`

### Vendored dependency test discovery

`scanBaseline` in `baseline-scanner.ts` listed every test file found by `git ls-files`, including thousands of files from `venv/lib/python3.12/site-packages/*/tests/`. These polluted agent prompts with irrelevant context. Added regex filters for `node_modules/`, `venv/`, `.venv/`, `site-packages/`, and other vendored directories.

Commit: `cefb5ec`

### Verifier test command priority

`detectTestCommand()` checked for a Makefile `test:` target before checking Python-specific configs (`pyproject.toml`, `setup.cfg`, `requirements.txt`). Agents frequently generate Makefiles with bare `pytest` (no venv activation), which fails in git worktrees where the venv is absent. Reordered detection: Python configs are checked first, Makefile is the fallback.

Commit: `cefb5ec`

### Git state sanitizer

Crashed or killed runs left unmerged binary files (`.pyc`, `.db`) in the git index, blocking subsequent verification commits and branch switches with "unmerged files" errors. Added `sanitizeGitState()` at the start of `executeSwarm()`: aborts pending merges, resets unmerged index entries, and prunes stale worktrees.

Commit: `0111fe6`

### Binary merge conflicts during wave merges

Tracked `.pyc` files in `venv/` caused `UU` (both-modified) and `AA` (both-added) conflicts during stash pop after wave merges. The strategy 3 conflict filter only handled `UD`/`DU` patterns, so these binary conflicts persisted in the index. This produced "Could not commit verification report: unmerged files" warnings during the run and "Failed to switch to branch master" at exit. Extended the conflict filter to include `UU` and `AA` patterns. Added `resetUnmergedState()` before every branch switch in `mergeWaveBranches` and `mergeAllBranches`. Replaced the stash pop warning-only handler with proper reset and stash drop.

Commit: `9e81d64`

## E2E Validation

All three v5.0.0 features were validated against `promptvault-orch`, a Python/FastAPI application with SQLite, HTMX, and Fernet encryption.

**Run configuration:**
- Goal: "Add request logging middleware that logs method, path, status code, and response time for every request. Store logs in a SQLite audit_log table. Add a GET /api/audit-log endpoint that returns the last 50 entries. Include tests for the middleware and endpoint."
- Tool: `claude-code`
- Plan: 5 steps across 3 waves (BackendMaster, DevOpsPro, SecurityAuditor, TesterElite, IntegratorFinalizer)
- Run ID: `swarm-2026-04-11T22-41-55-731Z`
- Flags: `--no-dashboard`

**Results (5/5 passed, zero warnings, clean exit):**

| Step | Agent | Duration | Result |
|------|-------|----------|--------|
| 1 | BackendMaster | 179s | PASSED |
| 2 | DevOpsPro | 263s | PASSED |
| 3 | SecurityAuditor | 343s | PASSED |
| 4 | TesterElite | 373s | PASSED |
| 5 | IntegratorFinalizer | 425s | PASSED |

Total: 5/5 completed, 0 failed, 3 batches, 17m 46s. Clean exit with "All steps completed successfully!" No unmerged-file warnings, no branch-switch errors, no stash conflicts.

Post-run: 168 tests passing in promptvault-orch (up from 80 pre-run). Clean git state on master.

**Feature 1 (SARIF):** Valid SARIF 2.1.0 JSON produced. Tested both `--sarif results.sarif` (file mode) and `--sarif -` (stdout). Schema version, tool driver, rules, and results all conform. Clean gate run produces valid SARIF with empty results array. Combined `--sarif` with `--json` to confirm additive output. Stdout mode produces clean JSON with no status message contamination.

**Feature 2 (gates.yaml):** Created `.swarm/gates.yaml` in promptvault-orch disabling `accessibility` and raising `duplicateBlocks.minLines` to 20. Ran gates: accessibility gate skipped as configured, 7/7 remaining gates passed. Unknown key validation confirmed (rejected `bogusGate` with descriptive error listing valid names).

**Feature 3 (spec-aware planning):** Plan file contains gate-aware clauses in acceptance criteria. `hardcoded-config` requirements appeared in Steps 1 and 5. Disabled gates excluded from prompt additions. Cost estimator confirmed 30% retry probability reduction.

## Prerequisite Features (from v4.2.0, verified and stabilized)

- OWASP ASI Mapper and Report Renderer
- Structured Run Report Generator and Renderer
- Claude Code Agent Teams Adapter
- CLI commands: `swarm report`, `--owasp-report`, `--tool claude-code-teams`, `--team-size`

## Test Summary

65 new tests across 4 test files. Full suite: 1386 passing, 6 pending, 0 failing. All 8 quality gates green on swarm-orchestrator. 168 tests passing on the target project (promptvault-orch) after the E2E run.
