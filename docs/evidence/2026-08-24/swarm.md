# Two runs of a swarm that coordinates, competes, and decomposes

Both runs are through the installed command line against scratch repositories the tool had
never seen, on a local model served by Ollama (`local:qwen3-coder-next:latest` at
`http://localhost:11434/v1`). Both bundles are committed whole and verify from where they
sit. Neither is a benchmark: they are two runs, and what they show is what the records say.

## Run 1: one task tried three ways

`swarm parallel --tasks tasks.txt --redundancy 3 --concurrency 3`, bundle in
`swarm/redundancy/`. 27 coordinator records, three worker chains, exit 0.

All three attempts went green in worktrees of their own and the comparator ranked them over a
file universe fixed across the three. What it found, from `attempt-selection`:

| | worker-1 | worker-2 | worker-3 |
| --- | --- | --- | --- |
| tests collected | 2 | 2 | 2 |
| assertions | 2 | 2 | 2 |
| tests | 1 | 1 | 0 |
| changed lines covered | 4 | 4 | 4 |
| uncovered changed lines | 0 | 0 | 0 |
| added lines | 9 | 9 | 8 |

Coverage was measured rather than abstained on: `abstentions` is empty, and
`changedLinesCovered` is a real 4 from an lcov artifact the harness asked for by an argument
vector it built itself. Worker-3 ranked last on `tests`, which is the dimension that saw it
had written one test fewer, and its smaller diff never got to speak because parsimony sits
below the earn-it dimensions. Worker-1 and worker-2 were identical on every dimension, so
`decidedBy` is null and the tie broke on the earliest attempt, which the report says in those
words rather than implying a reason it did not have.

The claim on the chain is `landed == true && workerId == "worker-1"`, cited against the
merge-attempt record, and it renders VERIFIED. It is a claim about what happened to the
chosen attempt, not about the choice: a predicate over the selection would restate the
arithmetic in its own payload.

`node verify.mjs .` exits 0. Flipping one byte of `actor` in the first ledger record makes it
exit 1, naming the broken link:

    FAIL  hash chain intact: record 1 carries previousHash sha256:0bf5f3b2...,
          but the record before it hashes to sha256:a107257e...

## Run 2: a goal decomposed by the tool

`swarm parallel --goal "Give the alpha module a shouting variant, and add a beta module
beside it with its own test"`, bundle in `swarm/decomposition/`. 37 coordinator records,
three worker chains, exit 1.

The planner read the workspace on a chain of its own and declared three nodes:

| node | dependsOn | files |
| --- | --- | --- |
| `shouting-alpha` | none | `src/alpha.js` |
| `create-beta` | none | `src/beta.js` |
| `beta-test` | none | `src/beta.test.js` |

The `task-graph` record precedes every `worker-started` on the coordinator chain, which is
what makes it a declaration rather than an account. It records `parallelSafe: true` and no
overlaps, and the structural checks all held: three unique slug ids, no dependency naming a
node that does not exist, no cycle, every node naming a file.

Two nodes landed and one did not, so the outcome claim `nodes == 3 && landed == 3` renders
UNVERIFIED. Both of its literals come from the declaration rather than from the outcome,
which is what lets it be false at all.

**What this run shows that the checks cannot.** The planner gave `beta-test` no dependency on
`create-beta`, so both were scheduled into the same layer and the test node ran against a tree
with no `src/beta.js` in it and finished red. Every check the harness makes passed: the graph
was well formed, acyclic, and free of file overlaps, and it was still a decomposition that
could not work. That is the residual stated plainly rather than argued around. Whether a set
of nodes adds up to a goal, or even to a runnable order, is a judgement about meaning, and
this tool makes none.

`node verify.mjs .` exits 0 on this bundle too, including the check that each worker chain
head is named by a coordinator record.

## What neither run shows

Two runs on one model on one machine. No throughput figure, no comparison against anything,
and nothing about how often a redundant attempt is worth its tokens. Both signed with a
per-run key, because this machine's keychain entry is not a usable one, and both manifests
say `keySource: ephemeral` rather than implying otherwise.
