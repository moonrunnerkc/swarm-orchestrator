# Fresh block 2: selection rule

Registered October 23, 2026, before any candidate's change, tests or evaluator was read for this
block, and before the revised implementation was frozen. The block is a small fresh comparison,
not the broad portfolio, and supports counts only.

## Families and size

Three tasks, at least two repositories:

1. **Bounded API change with preservation.** A library gains or changes a public option, method
   or signature, and the change has to keep behavior an existing implementation already provides
   (the task text names that preserved behavior).
2. **Mechanical multi-file transformation.** One systematic transformation applied across at least
   five authored files: files moved or renamed with their references, or one identifier or import
   path renamed throughout, behavior unchanged.
3. **Bug fix.** A behavior defect fixed in non-test source with a regression test.

## Pool and order

1. JavaScript or TypeScript repositories with no earlier launch, registration or evidence in this
   project: a repository qualifies only if its `owner/name` appears nowhere under `docs/evidence/`
   and `scripts/comparison/` at the registration commit.
2. Candidates come from each repository's first-parent history on its default branch, newest
   first, considering commits whose subject marks the family (family 1: feat, add, support,
   option, compat; family 2: rename, move, refactor, migrate; family 3: fix).
3. Repositories are considered in the order the evaluator author records before reading any
   change, and the first candidate in history order that passes every condition below is taken.
   Every candidate considered is recorded with its reason for rejection.

## Feasibility conditions

The same as held-out block 1 ([rule](../2026-10-22-adaptive/heldout-selection-rule.md)), and:

- The base installs and its project tests run on this host with `npm install --ignore-scripts`
  pinned to the registry as it stood before this registration (`--before=2026-10-23T00:00:00Z`),
  or with the repository's own lockfile.
- The evaluator is validated against the base (fails), the reference (passes), at least two faulty
  controls (fail), one plausible alternative correct implementation (passes) and one
  **absence-assertion control**: a correct patch whose own added tests mention a removed name,
  file or behavior in order to assert it is gone (passes). Where a check reads text, it judges
  semantic use (a require, import or call of the old name), never the presence of the name in a
  string or an assertion.
- The task text asks for the tests the reference adds, where it adds any.

## Custody

The evaluator author prepares hidden checks, reference patches and controls in
`~/.cache/swarm-heldout-2026-10-23/sealed`, runs no model inference, and reports to the
implementer only task ids, bases, task text, visible checks, digests and validation outcomes. The
implementer reads no hidden source, reference or control before the block's last launch is
scored. Workers launch under an execution profile that denies that directory, the mirrors holding
reference commits, other launches' workspaces and this repository's checkouts.
