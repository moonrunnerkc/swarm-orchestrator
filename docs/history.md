# History

Past evaluations, acceptance runs and release reports are evidence, not user documentation. They
are kept whole, failed and superseded runs included, outside the active tree, under git tags
that are never moved. Nothing here describes the current tool unless it says so; each result
holds only for the version, model and conditions its own page records.

## Reading archived material

Everything below lives at tag `archive/docs-2026-11-25`. To read it:

```sh
git fetch origin tag archive/docs-2026-11-25
git show archive/docs-2026-11-25:docs/acceptance/2026-11-04-comparison/README.md
git archive archive/docs-2026-11-25 docs/acceptance | tar -x -C /tmp/swarm-history
```

or browse `https://github.com/moonrunnerkc/swarm-orchestrator/tree/archive/docs-2026-11-25/docs`.
The tree id beside each entry is git's own content hash: `git rev-parse <tag>:<path>` must print
it, and a tree that differs in any byte has a different id.

| Path at the tag | Files | Tree or blob id | What it is |
| --- | --- | --- | --- |
| `docs/acceptance/2026-10-31` | 927 | `e019dc5faf90a1ca4d52ec72506db539311f4cab` | Acceptance runs of the 16.0.x releases on real repositories, with sessions, patches and verdicts. |
| `docs/acceptance/2026-11-04-comparison` | 180 | `c0a74363b489b8ca4a448bb245ebfdfaadcfb03e` | Swarm and Claude Code on four tasks under criteria sealed before either ran, and the ten-task run recorded for 17.0.0 (0 of 10 complete; eight tasks on rc.19, two on rc.21). |
| `docs/acceptance/2026-11-05` | 52 | `94c23ae46d068e637846a24123d12cdc1a3bb1d3` | The 17.0.0 release run's sealed-set records. |
| `docs/evidence` | 1 | `1dfc936e41d3990cb2625bb08688ce5a61922535` | Index of earlier evidence branches. |
| `docs/plans` | 8 | `8fbdec0a4dde25fd6f40a6e4478e6ff3ecad24ee` | The product-recovery specification and the release reports from 16.0.2 to 17.0.0. |
| `docs/rebuild-tasks.md` | 1 | `21bf0fd0b9c7b272ae524642b15129f743203784` | The task list of the verifier-first rebuild (15.0.0). |

At tag `archive/acceptance-2026-11-26`, read the same way:

| Path at the tag | Files | Tree or blob id | What it is |
| --- | --- | --- | --- |
| `docs/acceptance/2026-11-26` | 110 | `18c821d5138d75e9b113682251cf8eae361b4e18` | The invoice example with a local model on 17.1.0-rc.15 and on the starting version: reports, patches, replays and an independent evaluation of each patch, with the controls and the seeded fault. |

At tag `archive/acceptance-2026-11-26-closeout`, read the same way:

| Path at the tag | Files | Tree or blob id | What it is |
| --- | --- | --- | --- |
| `docs/acceptance/2026-11-26-closeout` | 560 | `4bf02d27d4bffbae12e44f35faf05fb25bcc6d00` | The closeout of 17.1.0: 22 live runs on the automatic path (drafted acceptance tests and drafted security bindings) on the invoice and notes examples and the seeded-fault task, every attempt kept, each with its signed verifications, replay and an independent judgment; the failures found, their causes and the runs after each fix. |

At tag `archive/acceptance-2026-11-27-packed-17.1.0`, read the same way:

| Path at the tag | Files | Tree or blob id | What it is |
| --- | --- | --- | --- |
| `docs/acceptance/2026-11-27-packed-17.1.0` | 84 | `655cd1f2e407300a216431532c25347bb7155f70` | The packed 17.1.0 installed with swarm-verify 3.2.0 from the registry, before the merge: one live run of each task on the automatic path, with signed verifications, replays, independent judgments, the gates and the release smoke. |

## Still in the active tree

- [DECISIONS.md](DECISIONS.md): dated decisions, append-only. Older entries name archived paths.
- [results.md](results.md) and [eval.md](eval.md): the three-arm and tamper evaluations and how
  they ran, generated from `eval/results/`.
- [adr/](adr/README.md): architecture decisions 0014 and 0015. ADRs 0001 to 0013 are in this
  repository's history before 15.0.0.
- [CHANGELOG.md](../CHANGELOG.md): each release's section describes the tree at its tag.

## Earlier lines of work

Branches from before the 15.0.0 rebuild and from individual studies were retired on 2026-11-25.
Each tip that was not already part of `main` is kept as a tag named `archive/<branch name>`, so
`git fetch origin 'refs/tags/archive/*:refs/tags/archive/*'` retrieves all of them.
