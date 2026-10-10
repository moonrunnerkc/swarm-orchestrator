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
verifier matrix's registry-version input. No runtime architecture change or dependency migration.

## Documentation and cleanup

- Corrected inherited-failure semantics and the shared-source architecture disposition.
- Reconciled fork evidence, 1.3.0 rollout fixes, elapsed launch windows and support observations.
- Published a current readiness assessment without pooling historical populations.
- Archived the v13 prompt byte-for-byte under `history/`; the old path is a short compatibility
  pointer for historical references. Older implementation reports and launch text are labeled.
- Retained scripts, workflows, configuration, exports and generated evidence unless a consumer
  audit establishes they are dead. Release, CI, scheduled jobs, package boundaries and reproduction
  commands are consumers. No source file is established as safe to delete in this pass.
- Preserved signed bundles, raw observations, fixtures, historical tags and reproduction inputs.

## Validation and delivery

Pending final-commit gates, builds, packaged checks, boundary tests, supported-platform matrix,
Action good/bad controls, registry publication, distribution generation, independent releases,
fresh registry installations, public links and Marketplace transition. Results will be recorded
with their exact source and workflow identities; the target versions alone do not claim delivery.

## Work that remains separate

See [current readiness](beta-gates.md) and [the campaign tracker](verifier-first/README.md).
The corrected AI-PR study and final comparative campaign are unfinished; Cursor, rollout owner
choices, controlled-support closeout, independent adversarial work and real human onboarding
remain explicit. The September pilot did not establish a swarm advantage. Relaunch drafts stay
separate from release execution; no external announcement is implied by preparing a release.
