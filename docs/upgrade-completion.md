# Broad-use upgrade completion ledger

Status: reopened after the independent September 27 audit of
`a6a83eeb9201957d505824b135f0bc9c83ee9944`. Browser report forgery, omitted unavailable
package gates and failed nightly proof invalidate the prior blanket completion claim.
The earlier passing runs remain historical observations, not evidence that these defects
were covered. See [audit corrections](upgrade-audit-corrections.md).

All five workflows share the existing engine. Start with [the broad-use guide](broad-use.md).
[Evidence report](evidence/2026-09-27/broad-use/report.md) records exact commands and source
identities. [Observation manifest](evidence/2026-09-27/broad-use/observations.json) identifies
retained artifacts by digest. [Execution declarations](evidence/2026-09-27/broad-use/execution.md)
preserve the edit sets, amendments and intermediate failures.

| UG | Production path | Meaningful verification | Status |
| --- | --- | --- | --- |
| UG-01 | Existing seals, ratchets, append-only records and independent verifier; captured blocking-check derivation | Full gates, historical bundles, status and upgrade adversarial tests | Reopened |
| UG-02 | Shared-source standalone prepack; tag/version interlock and provenance workflow | Clean installed tarballs; boundary and packaged checks | Complete |
| UG-03 | Shared immutable patch/branch/PR source resolver; exact/merge-base identities | Real Git and PR 73 parity; hostile/moving inputs; dirty workspace preserved | Complete |
| UG-04 | Pinned trusted composite Action; isolated candidate execution; bounded retained outputs | Local retention tests and real post-push good/bad controls; downloaded bundles independently verified | Complete |
| UG-05 | Versioned JSON and escaped, truncation-marked Markdown assessment projection | Presentation injection tests; installed summaries and evidence digests | Reopened |
| UG-06 | npm/pnpm and uv/existing-venv detection, initialization and preflight | Real locked preparation, configured runners, idempotent init and missing-tool controls | Complete |
| UG-07 | Repeated repository-relative package selection; qualified checks and scope refusal | Mixed pnpm/Vitest and uv/pytest fixture; shared/outside changes refused | Reopened |
| UG-08 | Native runner plus structured Vitest/pytest outcomes with limited authority | Real collected good/bad tests; malformed, zero, duplicate, truncated and spoofed controls | Complete |
| UG-09 | Typed behavior instruments in sealed goal contracts, existing final acceptance | Pinned artifacts, provenance, final-tree and independent bundle tests | Reopened |
| UG-10 | Controlled argv/stdin CLI adapter; bounded stream assertions | Real success/wrong output/exit, missing executable, timeout, cancellation and cleanup | Complete |
| UG-11 | Owned local HTTP service; separate readiness and finite response assertions | Packed good/bad API responses, redirect refusal and freed ports | Complete |
| UG-12 | Optional project Playwright adapter; individual structured results and bounded diagnostics | Both packed CLIs run real isolated Chromium good/bad interactions; startup/missing/zero/timeout controls | Reopened |
| UG-13 | Deterministic setup/infrastructure/implementation/permission classification | Repair policy, no-progress and ordinary worker behavior-repair tests | Complete |
| UG-14 | One explicit alternate model, original budget and verification reserve | Fake-provider controller tests; actual local e2b to 31b escalation recorded once | Complete |
| UG-15 | Owned effect intent/observation records; original recovery contract and reconciliation | Interrupted effects, escalation count/budget recovery and process ownership tests | Complete |
| UG-16 | Bugfix reproducer fails on base output and passes on final candidate | Both packed CLIs clamp reproducer; wrong-behavior candidate rejected | Complete |
| UG-17 | Refactor pinned obligations checked on base and candidate | Mixed packages, CLI, HTTP and browser preserved/changed behavior controls | Reopened |
| UG-18 | Exact dependency-field/lock authorization; installed-version and behavior checks | Real npm/pnpm/uv upgrade matrix and manifest tampering; ordinary worker npm upgrade | Complete |
| UG-19 | Real subprocess/toolchain/isolated browser and installed-package matrix | Full local gates and packed matrix; exact-commit Ubuntu/macOS and Node 22/24 CI passed | Reopened |
| UG-20 | Updated guides, package README, changelog, matrix and executable walkthroughs | Installed commands compared with documentation; documentation path checks | Reopened |
| UG-21 | Coherent local source commits; authorized default-branch delivery | Default-branch push, matching remote SHA and exact-commit required CI verified | Reopened |

Production entry points and shared modules:

- Verification/distribution: `swarm ci`, `swarm-verify ci`, `verify`, `gates`;
  `src/gates/change-source.ts`, `src/cli-ci.ts`, `src/evidence/ci-summary.ts`, `action.yml`.
- Setup and selected units: `swarm init --package`; `src/config/init.ts`,
  `src/gates/package-scope.ts`, `environment-preflight.ts`, `node-gates.ts`, `python-gates.ts`.
- Behavior: `--goal-contract`; `src/evidence/behavior-check.ts`, `src/gates/behavior-check.ts`,
  `goal-acceptance.ts`, `goal-effects.ts`; independent rules under `src/evidence/verifier`.
- Bounded escalation: `--escalate-model`; `src/gates/repair-policy.ts`,
  `src/agent-escalation.ts`, `src/durable/recovery-context.ts`.
- Presets: ordinary `swarm --preset bugfix|refactor|upgrade --goal-contract`;
  `src/cli-task-goal.ts`, `src/evidence/task-preset.ts`, `src/gates/preset-verification.ts`.

The live local task actually escalated once and still failed its objective. Its rejection is
preserved; it is not evidence of model task success. Vitest/pytest counts do not gain native
coverage or deletion-exemption authority. Browser artifacts are diagnostic. Signer trust,
execution restrictions, regression and task acceptance remain separate. See the capability
matrix and private-PR/special-file limitations in the guide.

Source packages: root 14.2.0, standalone 0.2.0. Built tarballs are the installation path;
registry publication and release tags are separate, unperformed actions.
