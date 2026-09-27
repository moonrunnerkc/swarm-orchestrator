# Broad-use upgrade completion ledger

Status: audit corrections implemented and delivered, with local gates, exact-source remote CI,
Action controls and nightly proof passing on `95891957987ec758f58a81ebb800933439f252de`.
The subsequent report and consumer-pin update are documentation-only. Their exact commit checks
and independent publication results are recorded with the [GitHub release](https://github.com/moonrunnerkc/swarm-orchestrator/releases).
The September 27 audit invalidated the earlier blanket completion claim; its reproduced failures
and failed corrective attempts remain in [audit corrections](upgrade-audit-corrections.md) and
the [current observation index](evidence/2026-09-27/upgrade-audit-observations.json).
Unaffected rows retain their original implementation evidence, not an invented new study.

All five workflows share the existing engine. Start with [the broad-use guide](broad-use.md).
[Prior evidence report, superseded for completion status](evidence/2026-09-27/broad-use/report.md) records exact commands and source
identities. [Prior observation manifest](evidence/2026-09-27/broad-use/observations.json) identifies
retained artifacts by digest. [Execution declarations](evidence/2026-09-27/broad-use/execution.md)
preserve the edit sets, amendments and intermediate failures.

| UG | Production path | Meaningful verification | Status |
| --- | --- | --- | --- |
| UG-01 | Existing seals, ratchets, append-only records and independent verifier; captured blocking-check derivation | Full gates, historical bundles, status and upgrade adversarial tests | Corrected and verified |
| UG-02 | Shared-source standalone prepack; tag/version interlock and provenance workflow | Clean installed tarballs; boundary and packaged checks | Complete |
| UG-03 | Shared immutable patch/branch/PR source resolver; exact/merge-base identities | Real Git and PR 73 parity; hostile/moving inputs; dirty workspace preserved | Complete |
| UG-04 | Pinned trusted composite Action; isolated candidate execution; bounded retained outputs | Corrective post-push good/bad controls; recorded rejection, summary and failure evidence retained | Verified |
| UG-05 | Versioned JSON and escaped, truncation-marked Markdown assessment projection | Presentation injection tests; installed summaries and evidence digests | Corrected and verified |
| UG-06 | npm/pnpm and uv/existing-venv detection, initialization and preflight | Real locked preparation, configured runners, idempotent init and missing-tool controls | Complete |
| UG-07 | Repeated repository-relative package selection; qualified checks and scope refusal | Mixed pnpm/Vitest and uv/pytest fixture; shared/outside changes refused | Corrected and verified |
| UG-08 | Native runner plus structured Vitest/pytest outcomes with limited authority | Real collected good/bad tests; malformed, zero, duplicate, truncated and spoofed controls | Complete |
| UG-09 | Typed behavior instruments in sealed goal contracts, existing final acceptance | Pinned artifacts, provenance, final-tree and independent bundle tests | Corrected and verified |
| UG-10 | Controlled argv/stdin CLI adapter; bounded stream assertions | Real success/wrong output/exit, missing executable, timeout, cancellation and cleanup | Complete |
| UG-11 | Owned local HTTP service; separate readiness and finite response assertions | Packed good/bad API responses, redirect refusal and freed ports | Complete |
| UG-12 | Sealed Playwright instruments with immutable runtime and independent provenance checks; project reports unjudged | Both packed CLIs: real isolated Chromium good/bad, exact forged-report refusal, missing/zero/timeout/import controls | Corrected and verified |
| UG-13 | Deterministic setup/infrastructure/implementation/permission classification | Repair policy, no-progress and ordinary worker behavior-repair tests | Complete |
| UG-14 | One explicit alternate model, original budget and verification reserve | Fake-provider controller tests; actual local e2b to 31b escalation recorded once | Complete |
| UG-15 | Owned effect intent/observation records; original recovery contract and reconciliation | Interrupted effects, escalation count/budget recovery and process ownership tests | Complete |
| UG-16 | Bugfix reproducer fails on base output and passes on final candidate | Both packed CLIs clamp reproducer; wrong-behavior candidate rejected | Complete |
| UG-17 | Refactor pinned obligations checked on base and candidate | Mixed packages, CLI, HTTP and browser preserved/changed behavior controls | Corrected and verified |
| UG-18 | Exact dependency-field/lock authorization; installed-version and behavior checks | Real npm/pnpm/uv upgrade matrix and manifest tampering; ordinary worker npm upgrade | Complete |
| UG-19 | Real subprocess/toolchain/isolated browser and installed-package matrix | Local and Linux: 379 files, 3625 tests; macOS: 3607 passed, 18 capability skips; packaged Node 22/24, Action controls and corrected nightly passed | Verified |
| UG-20 | Updated guides, package README, changelog, matrix and audit correction report | Installed controls, documentation checks and retained failed attempts | Verified |
| UG-21 | Coherent local correction commits; user explicitly authorized owner-bypass delivery | Matching remote source SHA, successful corrective CI and nightly; report-only followup checked separately | Verified |

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

Source packages at that delivery: root 14.2.0, standalone 0.2.0. Built tarballs are installation-tested.
Their independently authorized publication, provenance and registry-install evidence are
recorded with the GitHub release; a source push alone never establishes registry availability.
