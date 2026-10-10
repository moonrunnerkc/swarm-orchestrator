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

## Published package receipts

Both packages were published from `d9360e4c167d2d739e62ac4d4db20ce06416b024` on October 10.
Their registry metadata names that exact `gitHead` and now exposes the requested versions as
`latest`. Publication and installation are separately observed:

| Product | Publish workflow | Registry tarball SHA-1 | Fresh installation |
| --- | --- | --- | --- |
| Verify 1.3.1 | [38094904204](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38094904204) | `365709e46182e08d9c48de2f02fbb173ba9f57d7` | 24/24 installed smoke cases on macOS Node 24; all three dependencies/package signatures and attestations verified |
| Orchestrator 14.4.0 | [38094903934](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38094903934) | `f8a3114631fb19b526ac79168eaa186c959b999f` | fresh local and global-prefix installs; binary version/help and metadata verified; 55 registry signatures and 18 available attestations verified |

Both public binaries agree on the intact signed demonstration bundle and refuse its tampered
copy. The first Orchestrator lookup returned 404 while npm processed the successful publication;
a later fresh install succeeded. The failed lookup is retained, not counted as success.

Final package-source validation at `d9360e4c1`: local gates passed 439 files and 4130 tests,
zero skipped; CI [38093918612](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38093918612)
passed Linux (439 files/4130 tests) and macOS (434 files/4101 tests, 5 files/29 container-dependent
tests skipped). These are separate runs, not an invented combined total. Lint reported 24
warnings and one informational diagnostic. Both builds, packaged CLI checks, all eight fuzz
harnesses (84 seeds), all 15 cited bundles and 138 recorded CI verdicts passed. Documentation:
1416 references, zero misses. The deployed Pages HTML matched the generated bytes exactly.

The [fresh-registry platform matrix 38095525959](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38095525959)
passed all seven rows. Node 22.0.0 records the Vitest forgery cases unsupported; Windows retains
its documented verification-only scope. Unsupported observations are not converted to passes.

## Distribution and independent releases

The generated [Verify repository](https://github.com/moonrunnerkc/swarm-verify) is at
`71328695ef1cf8822c6f326e96e5d0888df72db4`: README, changelog, Action reference, examples,
manifest, lockfile and source provenance. All twelve public files match the generated bytes.
`SOURCE.json` binds the published package integrity and source commit. The `v1` tag may move
only after controls against this distribution pass.

The first dispatch used an abbreviated SHA and was cancelled in favor of an exact SHA. The
[exact-SHA run 38095558441](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/38095558441)
then failed before verification: the validation workflow nested the distribution inside the
source npm workspace, causing `npm ci` to consult the source lockfile. The workflow now checks
out the distribution beside the source workspace and keeps both good/bad assertions unchanged.
This follow-up changes validation and documentation, not the already published packages.

Independent release receipts record the passing published-Action controls, final tag identities,
full logs and SHA-512 registry integrity values:
[Verify 1.3.1](https://github.com/moonrunnerkc/swarm-verify/releases/tag/v1.3.1),
[Orchestrator 14.4.0](https://github.com/moonrunnerkc/swarm-orchestrator/releases/tag/v14.4.0).
Until those receipts exist, the independent GitHub releases remain delivery targets.

Two unpublished local draft tags originally pointed to `2333e3ca6`. Their exact annotated tag
objects remain under local `refs/archive/release-drafts/2026-10-10/` before the public release
names were bound to the validated source. No published historical tag was moved.

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
