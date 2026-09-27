# September 27 upgrade audit corrections

Baseline: `a6a83eeb9201957d505824b135f0bc9c83ee9944`. Status: in progress.
The user audit is `/Users/brad/Downloads/Swarm_Orchestrator_Upgrade_Audit.md`.
No previous campaign or evidence bytes are rewritten.

## Findings

- UG-01/09/12/17: candidate configuration can forge Playwright JSON before tests run.
- UG-05/07: package selection removes unavailable language checks.
- UG-19/20/21: nightly run 36304069339 failed with 3612 passed tests and one failure
  because Chromium was absent; later proof steps did not run. Issue notification also
  failed because `ci` was not a repository label.
- The previous owner-role protected-branch exception violated the requested no-bypass
  delivery constraint. Current ruleset 15229475 blocks every branch update and creation.
  No further bypass is authorized. Local fixes continue while a permitted route is resolved.

## Intended edits, declared before implementation

`docs/upgrade-completion.md`, this file, `src/gates/behavior-check.ts`,
`src/gates/browser-results.ts`, `src/evidence/behavior-check.ts`,
`src/evidence/verifier/behavior.mjs`, `src/gates/browser-check.integration.test.ts`,
`src/gates/browser-results.test.ts`, `src/gates/browser-trust.integration.test.ts`,
`src/gates/browser-instrument.ts`, `src/gates/browser-instrument-runner.mjs`,
`src/gates/goal-acceptance.ts`, `src/gates/gate-definition.ts`,
`src/gates/node-command-runner.ts`, `src/exec/execution-mode.ts`,
`src/exec/container-backend.ts`, `src/gates/package-scope.ts`,
`src/gates/package-scope.test.ts`, `.github/workflows/nightly-proof.yml`,
`scripts/nightly-proof.test.mjs`, `scripts/build-dist.test.mjs`,
`scripts/validate-browser-cli.mjs`, `scripts/validate-browser-container.mjs`,
`docs/broad-use.md`, `docs/security-coverage.md`, `CHANGELOG.md`.
Amendments will name additional files before editing them.

## Verification

Pending. Raw failed-nightly log retained at `/tmp/swarm-audit-correction/nightly-before.log`.

Amendment 1, before edits: `src/evidence/bundle.ts` strips the new independent
reader's builtin crypto import when embedding it. `src/evidence/browser-execution.ts`
validates persisted browser provenance. `src/evidence/verifier/behavior.d.mts` retains
its public unknown-input boundary if needed.

Amendment 2, before edits: `src/gates/browser-instrument.integration.test.ts`,
`.github/workflows/gates.yml`, `.github/workflows/publish.yml`,
`.github/workflows/publish-verify.yml` prepare the pinned browser image before Linux gates.
`src/gates/package-assessment.integration.test.ts` checks package omissions through recorded
seals and assessments. `src/gates/behavior-artifacts.ts` is included if diagnostic retention
needs adjustment for protected instrument paths.
