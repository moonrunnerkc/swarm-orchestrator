# Fresh block 3: selection rule

Registered October 23, 2026, before any repository below was cloned for this block and before any
candidate change, test or evaluator was read. The block is a small fresh comparison, not the broad
portfolio, and supports counts only.

## Families and size

Three tasks from at least two repositories, one per family:

1. **Bounded API change with preservation.** A library gains or changes a public option, method or
   signature. The task text names behaviour an existing implementation already provides that must
   be kept.
2. **Bug fix with preservation.** A behaviour defect is fixed in non-test source, with a
   regression test. The task text names the neighbouring behaviour that must stay as it is.
3. **Mechanical transformation that reaches configuration.** Files are moved or renamed, or a path
   or identifier is renamed throughout, with behaviour unchanged. The change must update at least
   one project configuration, build or script file that names a moved path: a lint, test or build
   configuration, a `package.json` script or field, or a build script.

## Pool and order

1. JavaScript or TypeScript repositories never cloned, launched or prepared by this project. A
   repository named in an earlier block's recorded repository order, but never cloned and with no
   candidate read, qualifies. Block 2 considered candidates only from markdown-it and svgo; its
   order named ten more (`unjs/ufo`, `postcss/postcss`, `jprichardson/node-fs-extra`,
   `micromatch/picomatch`, `ljharb/qs`, `Rich-Harris/magic-string`, `unjs/pathe`, `unjs/defu`,
   `ai/nanoid`, `pmndrs/zustand`), and none of those is among the comparison's mirrors.
2. The evaluator author records the repository order before cloning any of them. They may add
   repositories that pass the exposure check of block 2's rule: the `owner/name` and the mirror
   spelling appear nowhere under `docs/evidence/` or `scripts/comparison/`, apart from that one
   order list.
3. Candidates come from each repository's default-branch first-parent history, newest first, by
   subject keyword:
   - family 1: feat, add, support, option, compat;
   - family 2: fix;
   - family 3: rename, move, refactor, migrate.

   The first candidate in that order that passes every condition below is taken. Every candidate
   considered is recorded with its reason for rejection.

## Feasibility conditions

Block 2's conditions ([rule](../2026-10-23-controller/heldout-2-selection-rule.md)), and in
addition:

- The task text states the behaviour to keep in families 1 and 2. The evaluator holds at least one
  hidden check of that kept behaviour, run against both the base and the candidate.
- For family 3, the reference itself edits a configuration, build or script file to follow the
  move. The validation also runs the faulty controls that hide damage behind a configuration
  edit: a test glob narrowed, a lint rule disabled or a file ignored, a failure swallowed, a
  success printed, a build output left unwritten. Each must fail the evaluator.
- The installation and the project tests run on this host, either with the repository's own
  lockfile or with `npm install --ignore-scripts --before=2026-10-23T00:00:00Z` and a lockfile the
  harness freezes.

## Custody

- The evaluator author prepares the hidden checks, reference patches and controls in
  `~/.cache/swarm-heldout-2026-10-23c/sealed`. The author runs no inference on the local model.
- The author reports to the implementer only:
  - task ids and bases;
  - task text and visible checks;
  - digests and validation outcomes.
- The implementer reads no hidden source, reference or control before the block's last launch is
  scored.
- Arms launch under the comparison's execution profile. It denies that directory, the mirrors that
  hold reference commits, other launches' workspaces and this repository's checkouts.
