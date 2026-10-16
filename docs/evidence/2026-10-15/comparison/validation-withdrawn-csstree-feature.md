# Withdrawn before the freeze: csstree-feature-parser-list-option

Chosen first as the feature task (upstream 20f56718315e832a70d4c761ae037a78187dec29, base
39a0c7289fdb5d7698f2cc066e5146ffc067d50b), with a task text requiring plain arrays for every
node's children at every depth under `list: false` and the same generated CSS either way. The
validator's reference control refused it twice, and the second refusal is the finding.

- First run: the task-authored hidden check counted nodes through the walker, which does not
  traverse array children; the check was rewritten to traverse the tree directly.
- Second run: on the maintainer's own change, `parse(css, { list: false })` holds arrays only at
  7 nodes (StyleSheet, AtrulePrelude, MediaQueryList, Condition, three Blocks) where the list
  tree holds 15; every rule prelude and every declaration value comes back as a `Raw` node, so
  `generate` returns `a:hover, b > c{color:rgb(1, 2, 3);margin:1px 2px}.x{--y: z }` for input
  the list tree serializes with normalized spacing. The sub-parsers for selectors and values
  fall back to `Raw` when the list methods are replaced by array ones. The upstream tests check
  the root's children only, so they pass.

A reference that does not satisfy the task's stated contract is not a valid task under
[candidates.md](candidates.md) criterion 3, and a contract weakened to "arrays at the root and
in blocks, with preludes and values degraded to raw text" would be describing a side effect
rather than a feature. The task was withdrawn and replaced by `pako-feature-inflate-push-after-end`
before any arm attempted either. Nothing here says the upstream change is wrong for its own
purpose; it says the change does not do what a task text could honestly ask for.
