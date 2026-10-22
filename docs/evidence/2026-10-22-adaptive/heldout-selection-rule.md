# Held-out block 1: selection rule

Registered October 22, 2026, before any held-out candidate's change, tests or evaluator was read
for this stage. The block is an initial transfer test of four tasks, not the broad portfolio.

## Pool and order

1. The 20-identity inventory in `docs/evidence/2026-10-22-capability/candidates.json`, in file
   order. The comparison runner prepares and scores Node projects only, so this block draws from
   the JavaScript/TypeScript repositories there: sindresorhus/p-limit, fastify/fastify and
   sindresorhus/p-queue. The Python candidates stay in the broader portfolio; that is a stated
   limitation of this block, not a judgment of those tasks.
2. One task per family: bug fix, feature, behavior-preserving refactor, API or dependency
   compatibility change. The block must span at least three repositories.
3. For each family, take the first inventory candidate in file order that passes every
   feasibility condition below. Record every rejection and its reason.
4. If a family has no passing inventory candidate, take replacements by this amended rule: the
   same three repositories' first-parent history on the default branch, newest first, from the
   inventory's recorded heads, considering commits whose subject marks the family (fix, feat or
   add, refactor or simplify or move, and deps or compat or support or drop or remove). Exclude
   identities found by the exposure scan, then apply the same conditions. If those repositories
   still fill nothing, the next source is a JavaScript repository with no earlier launch,
   registration or evidence in this project, chosen by the same history rule. Every candidate
   considered is recorded.

## Feasibility conditions

- The base is the change commit's first parent, and its install and project tests run on this
  host without network beyond the package registry.
- Meaningful multi-file work: the reference touches at least two authored files besides
  changelogs and documentation, at least one of them non-test source.
- The task text can state the required behavior without naming or quoting the upstream change.
- A hidden evaluator exists that fails the base, passes the reference, fails at least two
  deliberately faulty controls (for example a partial change and a change that breaks preserved
  behavior), and checks preserved behavior beyond the task text's own examples. A plausible
  alternative correct implementation passes it where one can be written.
- A visible check, weaker than the hidden evaluator, fails the base and passes the reference.
- The reference passes the comparison's allowed-change policy.
- The identity is absent from the exposure scan's corpus.

## Custody

The evaluator author prepares hidden checks, reference patches and controls in
`~/.cache/swarm-heldout-2026-10-22/sealed`, outside every repository checkout and outside worker
access, and runs no model inference. Workers launch under an execution profile that denies that
directory, the comparison mirrors that hold the reference commits, other launches' workspaces and
this repository's checkouts. Hidden material is committed to the repository only after the
block's last launch is scored. Task text, visible checks, bases and digests of the hidden
material are registered before the first launch.
