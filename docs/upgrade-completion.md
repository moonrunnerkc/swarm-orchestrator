# Broad-use upgrade completion ledger

Status: in progress. No source delivery or package publication is claimed.

Baseline: `103d3ce4868a7a7fcd74e41adf4626efaa0c2fc0`, preserving local work newer
than remote `43b6c5c764c18a053606185c26366f3f586ee09d`. Isolated worktree:
`/Users/brad/projects/swarm-broad-use`, branch `upgrade/broad-use`.
The original worktree and its two untracked feedback-study artifacts are untouched.
Remote identity: `https://github.com/moonrunnerkc/swarm-orchestrator`; default: `v13-main`.
Full history and `v12-final` present. Tag fetch refused to replace local `v14.0.0`;
local and remote tag identities differ, so neither was rewritten.

## Edit declarations

1. Before implementation: this ledger; `src/cli-ci.ts`, `src/cli-verify-options.ts`,
   `src/cli-command-definitions.ts`; source-resolution and reviewer-report modules
   and adjacent tests under `src/gates` and `src/evidence`; standalone package metadata,
   package validation scripts, Action files and workflows; README, CLI/using/verification/
   verify-only guides, package README, changelog and build/security documentation.
   Additional concrete files will be declared before editing.

## Requirements

| ID | Production implementation | Verification/evidence | Status |
| --- | --- | --- | --- |
| UG-01 | Under inspection | No completion evidence yet | Open |
| UG-02 | Under inspection | No completion evidence yet | Open |
| UG-03 | Under inspection | No completion evidence yet | Open |
| UG-04 | Under inspection | No completion evidence yet | Open |
| UG-05 | Under inspection | No completion evidence yet | Open |
| UG-06 | Under inspection | No completion evidence yet | Open |
| UG-07 | Under inspection | No completion evidence yet | Open |
| UG-08 | Under inspection | No completion evidence yet | Open |
| UG-09 | Under inspection | No completion evidence yet | Open |
| UG-10 | Under inspection | No completion evidence yet | Open |
| UG-11 | Under inspection | No completion evidence yet | Open |
| UG-12 | Under inspection | No completion evidence yet | Open |
| UG-13 | Under inspection | No completion evidence yet | Open |
| UG-14 | Under inspection | No completion evidence yet | Open |
| UG-15 | Under inspection | No completion evidence yet | Open |
| UG-16 | Under inspection | No completion evidence yet | Open |
| UG-17 | Under inspection | No completion evidence yet | Open |
| UG-18 | Under inspection | No completion evidence yet | Open |
| UG-19 | Under inspection | No completion evidence yet | Open |
| UG-20 | Under inspection | No completion evidence yet | Open |
| UG-21 | Under inspection | No completion evidence yet | Open |

## Observations

- Clean `npm ci`: exit 0, 217 packages added, zero reported vulnerabilities.
- Node 24.15.0; Docker server 29.5.2; GitHub authenticated as moonrunnerkc.
- Baseline command logs are retained outside the repository under
  `/tmp/swarm-upgrade-evidence`; results will be recorded after commands finish.

Amendment 2 (before edits): `src/swarm-verify.test.ts` for changed shared parser diagnostics;
`src/evidence/ci-summary.ts` and its adjacent test, and `src/cli-ci-report.ts` for reporting.
Baseline gates exit 0: 356 test files passed, 3520 tests passed, duration 135.89s.
Baseline build, build:verify, check:packaged and fuzz:build exited 0. Source-input targeted
run initially failed one legacy help-diagnostic assertion (99 passed); retained in
`/tmp/swarm-upgrade-evidence/source-tests.log`. No product verdict failed in that run.

## Source-input increment

Implementation: `src/gates/change-source.ts`, `src/gates/github-source.ts`, shared
`src/cli-verify-options.ts` and `src/cli-ci.ts`. Source IDs, actual comparison base and
patch digest are recorded before verification. Local source tests cover binary diffs,
dirty index/worktree preservation, exact versus merge-base comparison, hostile refs,
unsupported special entries and pinned PR transport behavior. The PR transport test
is deterministic and is not evidence of a remote GitHub run.

Reporting: `src/evidence/ci-summary.ts`, `--summary`, additive JSON source/evidence IDs.
Standalone distribution: prepack builds the shared-source closure; verifier publication
has a separate matching-tag interlock. No packages were published.

Amendment 3 (before edits): `src/gates/project-type.ts`, `src/gates/project-environment.ts`
and adjacent tests; `src/config/init.ts`, `src/cli-init.ts`, `src/cli-options.ts`,
`src/gates/default-gates.ts`, `src/gates/dependency-install.ts` and adjacent tests for
manager/interpreter selection and lock-preserving setup. Package scope integration will
amend the gate assembly separately. First source increment: `a05080011`; targeted run
`source-tests-5.log`: 5 files, 100 tests passed, exit 0.

Amendment 4 (before edits): package selection in `src/gates/package-scope.ts` and
adjacent tests, `src/gates/engine.ts`, `src/gates/independent-verification.ts`,
`src/cli-gates.ts`, and the shared CLI parser. Selection remains repository-relative;
`--workspace` continues to identify the repository. Scoped coverage without a controlled
runner stays explicitly unmeasured.

Amendment 5: `src/config/package-discovery.ts` and its tests for bounded workspace
manifest discovery, plus package selection in `src/config/init.ts` and `src/cli-init.ts`.

Amendment 6 (before edits): typed behavior checks in `src/evidence/behavior-check.ts`,
`src/gates/behavior-check.ts`, adjacent tests, `src/evidence/goal-contract.ts`,
`src/gates/goal-acceptance.ts`, and the independent bundled verifier rules. Finite stdin
and output bounds flow through `src/gates/gate-definition.ts`,
`src/gates/node-command-runner.ts`, `src/exec/run-process.ts`,
`src/exec/execution-mode.ts`, and `src/exec/container-backend.ts`.

Amendment 7: `src/evidence/bundle.ts` embeds the additional independent behavior rule
in the existing dependency-free verifier; `src/cli-ci.ts` and the shared parser expose
ordinary sealed goal contracts to verification-only callers. Historical bundles remain
unchanged. Browser instruments still require real integration and adversarial validation.

Amendment 8 (before dependency installation): root `package.json` and `package-lock.json`
add pinned development-only Playwright for real browser acceptance fixtures. This dependency
is necessary to test the advertised browser adapter; it remains outside the standalone
runtime package closure and does not install browsers for consumers automatically.

Amendment 9 (before edits): `src/gates/repair-policy.ts`, `src/agent-escalation.ts`,
adjacent tests, `src/agent-run.ts`, `src/gates/auto-resolve.ts`, `src/evidence/run-spec.ts`,
`src/durable/recovery-context.ts`, `src/cli.ts`, and `src/cli-options.ts` for explicit,
once-per-task escalation under the original budget and recoverable intent records.
