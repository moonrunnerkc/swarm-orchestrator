# Execution-grounded viability: pytest and Go runners

Phase 2 added pytest and Go to the execution-grounded runner-detection seam
and re-measured how much of the 197-PR outcome-labeled corpus the sandbox can
recognize and run. Every number below regenerates from a committed script.

## Result: 12/197 -> 78/197 EG-viable

`npm run execution-grounded:viability-screen -- --refresh`
(`scripts/real-prs/eg-viability-screen.ts`) over the 197 usable PRs.

| ecosystem | viable | how it is recognized |
|---|---|---|
| Node | 12 | package.json + lockfile + recognizable runner + node engine admits 22 |
| Python | 52 | pyproject/setup/requirements + a pytest signal (pytest config or a tests dir) |
| Go | 14 | go.mod (go test needs no declared runner) |
| **total** | **78 / 197 (39.6%)** | up from 12/197 (6.1%), a 6.5x increase |

Artifact: [`eg-viability.json`](eg-viability.json) (`viableCount: 78`), per-PR
evidence under [`eg-viability-cache/`](eg-viability-cache/), each record
carrying its `ecosystem` and the marker that made it viable.

The Node count is unchanged at 12: Node viability criteria did not move, so the
entire gain is the two new ecosystems. This is the number Phase 0 froze as a
floor and the upgrade must now hold: `eg-viable-count` in
`benchmarks/baselines/ground-truth-v12.json` was raised 12 -> 78, guarded by
`npm run baseline:check`.

## What still cannot provision (119/197)

| reason | count |
|---|---|
| not a Node, Go, or pytest project (C++, docs, config repos) | 58 |
| Node with no recognizable test runner | 45 |
| Python with no pytest signal (no config, no tests dir) | 5 |
| repo/sha unreadable (deleted or private) | 9 |
| Node pinning node 20.x (excludes the pinned major) | 2 |

## Honest caveat: screen-viable is not proof-tier-provisionable yet

The screen is a viability upper bound. It recognizes the ecosystem from the
repository root; it does not verify that dependencies install or that tests
pass, exactly as the Node screen only checks that a runner is declared. Two
things follow:

1. The positive merge-safety gate's pytest and Go runners are proven on
   committed fixtures and on real `python3 -m pytest` and `go test` runs
   (`test/audit/gate/positive-gate-polyglot.test.ts`), so the runner-scoped
   execute-and-parse path works on a provisioned tree.
2. The proof tier (mutation, coverage, the six restoration engines) and the
   corroborated-precision measurement still cover only the 12 Node PRs. The
   sandbox's dependency-install path (`provisionWorkspace` /`runInstall`) is
   Node package managers only; a Python or Go PR is screen-viable but its
   dependencies are not yet installed by the sandbox, so the proof tier cannot
   run on the 66 new PRs. Wiring `pip install` / `go mod download` into the
   provisioning install step is the bounded follow-on that turns screen-viable
   into proof-tier-provisionable.

So Phase 2 moves the measured screen viability from 6.1% to 39.6% and proves the
pytest and Go runners end to end on fixtures, while the corroborated proof-tier
denominator stays at the 12 Node PRs until the Python and Go install paths land.
No proof-tier or corroborated number was inflated by the re-measurement.
