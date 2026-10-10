# Two-product delivery, 2026-10-10

Release targets: Swarm Verify 1.3.1 and Swarm Orchestrator 14.4.0. Product boundaries follow
[ADR 0013](adr/0013-two-products-one-verifier.md). This record distinguishes source validation,
publication, distribution, adoption and readiness; none substitutes for another.

## Baseline and scope

Source baseline: `2333e3ca6b593474fa36ac59b9d23f12e0c02b05`, on an isolated delivery branch.
Existing uncommitted agent-instruction work in the operator's checkout is preserved and excluded.
Initial registry observation on October 10: Verify `latest` 1.3.0, Orchestrator `latest` 14.3.0.
The README now says installation resolves registry `latest`, separately from the source version.

Changes declared before editing: README, debt register, completion tracker, readiness, claims,
verification guide, documentation index, historical-document status notices, archived v13 prompt,
Pages generator and test, Action controls and this record. A recorded amendment added the
verifier matrix's registry-version input. A later amendment removes only compiler-proven unused imports from
`src/gates/oracle-instrumentation.ts` and `src/gates/attack-controls.test.ts`.
No runtime architecture change or dependency migration.

## Documentation and cleanup

- Corrected inherited-failure semantics and the shared-source architecture disposition.
- Reconciled fork evidence, 1.3.0 rollout fixes, elapsed launch windows and support observations.
- Published a current readiness assessment without pooling historical populations.
- Archived the v13 prompt byte-for-byte under `history/`; the old path is a short compatibility
  pointer for historical references. Older implementation reports and launch text are labeled.
- Retained scripts, workflows, configuration, exports and generated evidence unless a consumer
  audit establishes they are dead. Release, CI, scheduled jobs, package boundaries and reproduction
  commands are consumers. No source file is established as safe to delete in this pass.
  The unused-symbol compiler audit identified only two unused imports, now removed.
  A literal-consumer scan found fourteen unreferenced script filenames; inspection identified
  study/ablation runners, goal authoring, campaign publication/rechecks, rescoring and validation
  tools. They retain reproduction or unfinished-study roles and are not deletion candidates.
  Dynamic assets are copied by `build-dist.mjs` and `build-swarm-verify.mjs`; the packaged CLI
  imports its installed command inventory. These are consumers beyond static imports.
- Preserved signed bundles, raw observations, fixtures, historical tags and reproduction inputs.

## Validation and delivery

Preflight commit `2d6a5bec8510cd3adde5900d62f147bc4e7bb054`:

- Local `npm run gates`: 439 files, 4130 tests passed; no skipped tests. Lint completed with
  26 existing warnings and one informational diagnostic. Full output is retained in the delivery
  capture, not combined with another run.
- Both builds passed; the standalone closure contains 177 modules and excludes agent dependencies.
- Packaged behavioral CLI contracts passed, including intact/tampered bundle controls.
- Fuzz smoke passed all eight harnesses, 84 seeds. Documentation resolution: zero misses.
- [Supported-platform matrix 38093662665](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38093662665)
  passed all seven installed rows (Linux/macOS on 22.0.0, 22 and 24; Windows verification on 22).
- [Source Action controls 38093662707](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38093662707)
  passed both the good and bad candidate controls.

The final source commit must repeat gates, builds and package checks after the import cleanup.
Publication runs its own gates again. Independent release receipts will bind the final source,
registry integrity, distribution commit and post-publication matrix/Action runs:
[Verify 1.3.1](https://github.com/moonrunnerkc/swarm-verify/releases/tag/v1.3.1),
[Orchestrator 14.4.0](https://github.com/moonrunnerkc/swarm-orchestrator/releases/tag/v14.4.0).
Until those receipts exist, these are delivery targets, not claims of publication.

## Marketplace transition

Live HTTP inspection on October 10 found the old
[Falsifying Swarm Orchestrator listing](https://github.com/marketplace/actions/falsifying-swarm-orchestrator)
returning 200, while the Swarm Verify listing returned 404. GitHub's documented transition
requires unchecking Marketplace publication on each old listed release and enabling it on the
new independent Action release. Historical release tags and assets must remain intact.
The available computer-use tool refused Chrome access with “Computer Use was not approved to
use Google Chrome”. No listing change is claimed. This UI step remains blocked until authorized
browser access is available; the npm and GitHub release APIs remain usable.

## Work that remains separate

See [current readiness](beta-gates.md) and [the campaign tracker](verifier-first/README.md).
The corrected AI-PR study and final comparative campaign are unfinished; Cursor, rollout owner
choices, controlled-support closeout, independent adversarial work and real human onboarding
remain explicit. The September pilot did not establish a swarm advantage. Relaunch drafts stay
separate from release execution; no external announcement is implied by preparing a release.
