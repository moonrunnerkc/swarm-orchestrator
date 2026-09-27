# Broad-use upgrade completion ledger

Status: implementation, final local validation and installed integration complete; remote delivery
in progress. No default-branch delivery, required remote CI success or package publication is claimed.

All five workflows share the existing engine. Start with [the broad-use guide](broad-use.md).
[Evidence report](evidence/2026-09-27/broad-use/report.md) records exact commands and source
identities. [Observation manifest](evidence/2026-09-27/broad-use/observations.json) identifies
retained artifacts by digest. [Execution declarations](evidence/2026-09-27/broad-use/execution.md)
preserve the edit sets, amendments and intermediate failures.

| UG | Production path | Meaningful verification | Status |
| --- | --- | --- | --- |
| 01 | Existing seals, ratchets, append-only records and independent verifier; captured blocking-check derivation | Full gates, historical bundles, status and upgrade adversarial tests | Locally verified |
| 02 | Shared-source standalone prepack; tag/version interlock and provenance workflow | Clean installed tarballs; boundary and packaged checks | Locally verified |
| 03 | Shared immutable patch/branch/PR source resolver; exact/merge-base identities | Real Git and PR 73 parity; hostile/moving inputs; dirty workspace preserved | Locally verified |
| 04 | Pinned trusted composite Action; isolated candidate execution; bounded retained outputs | Local retention controls; remote good/bad workflow required before delivery | Remote pending |
| 05 | Versioned JSON and escaped, truncation-marked Markdown assessment projection | Presentation injection tests; installed summaries and evidence digests | Locally verified |
| 06 | npm/pnpm and uv/existing-venv detection, initialization and preflight | Real locked preparation, configured runners, idempotent init and missing-tool controls | Locally verified |
| 07 | Repeated repository-relative package selection; qualified checks and scope refusal | Mixed pnpm/Vitest and uv/pytest fixture; shared/outside changes refused | Locally verified |
| 08 | Native runner plus structured Vitest/pytest outcomes with limited authority | Real collected good/bad tests; malformed, zero, duplicate, truncated and spoofed controls | Locally verified |
| 09 | Typed behavior instruments in sealed goal contracts, existing final acceptance | Pinned artifacts, provenance, final-tree and independent bundle tests | Locally verified |
| 10 | Controlled argv/stdin CLI adapter; bounded stream assertions | Real success/wrong output/exit, missing executable, timeout, cancellation and cleanup | Locally verified |
| 11 | Owned local HTTP service; separate readiness and finite response assertions | Packed good/bad API responses, redirect refusal and freed ports | Locally verified |
| 12 | Optional project Playwright adapter; individual structured results and bounded diagnostics | Both packed CLIs run real isolated Chromium good/bad interactions; startup/missing/zero/timeout controls | Locally verified |
| 13 | Deterministic setup/infrastructure/implementation/permission classification | Repair policy, no-progress and ordinary worker behavior-repair tests | Locally verified |
| 14 | One explicit alternate model, original budget and verification reserve | Fake-provider controller tests; actual local e2b to 31b escalation recorded once | Locally verified |
| 15 | Owned effect intent/observation records; original recovery contract and reconciliation | Interrupted effects, escalation count/budget recovery and process ownership tests | Locally verified |
| 16 | Bugfix reproducer fails on base output and passes on final candidate | Both packed CLIs clamp reproducer; wrong-behavior candidate rejected | Locally verified |
| 17 | Refactor pinned obligations checked on base and candidate | Mixed packages, CLI, HTTP and browser preserved/changed behavior controls | Locally verified |
| 18 | Exact dependency-field/lock authorization; installed-version and behavior checks | Real npm/pnpm/uv upgrade matrix and manifest tampering; ordinary worker npm upgrade | Locally verified |
| 19 | Real subprocess/toolchain/isolated browser and installed-package matrix | Final local commands and matrix recorded in evidence report; exact remote CI required | Remote pending |
| 20 | Updated guides, package README, changelog, matrix and executable walkthroughs | Installed commands compared with documentation; documentation path checks | Locally verified |
| 21 | Coherent local source commits; authorized default-branch delivery | Final push, matching remote SHA and exact-commit required CI pending | Remote pending |

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
