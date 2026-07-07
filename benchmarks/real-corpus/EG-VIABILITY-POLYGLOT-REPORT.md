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
   corroborated-precision measurement still cover only the 12 Node PRs. Phase 1
   (below) landed the Python and Go dependency install, but the proof tier's
   scoped commands stay Node-only, so a pytest/Go PR is now installable yet still
   not corroboration-scoreable.

So Phase 2 moves the measured screen viability from 6.1% to 39.6% and proves the
pytest and Go runners end to end on fixtures, while the corroborated proof-tier
denominator stays at the 12 Node PRs. No proof-tier or corroborated number was
inflated by the re-measurement.

## Phase 1: the install path lands, and disproves the "install is the blocker" claim

Phase 1 wired the two missing install paths into `provisionWorkspace`
(`src/audit/execution-grounded/polyglot-install.ts`): a Python path (isolated
`.venv` + pip for a pinned `requirements.txt` and/or the project, or `poetry
install` when a `poetry.lock` is present) and a Go path (`go mod download`,
checksum-frozen against `go.sum`). The Node install path is unchanged. Unit and
offline-live coverage is in
`test/audit/execution-grounded/polyglot-install.test.ts`; the restoration proofs
are pinned to fail closed on a pytest/Go runner
(`test/audit/execution-grounded/test-restoration.live.test.ts`).

With the install path live, every one of the 8 outcome-bad EG-viable PRs was
attempted (`npm run polyglot-provision`,
[`polyglot-provisioning.json`](polyglot-provisioning.json)). The result: **7 of 8
are purely additive** (`no-mutable-source`: a new file plus its test, so the
additive-code control finds nothing to revert) and **1 of 8** cloned and then
failed `poetry install` (`provision-failed`: poetry is not on the sandbox PATH,
recorded with the real command). The 8 break down as 5 pytest
(All-Hands-AI/OpenHands) and 3 Go (divord97/ccc), correcting the "eight pytest"
figure in an earlier draft.

The honest finding: the Node-only install path was never the binding constraint
for the corroborated gate. The binding constraint is the Node-only corroboration
engine (mutation/coverage/issue-repro emit no signal on pytest/Go) plus the
additive shape of these specific outcome-bad PRs. `provisionableCount` therefore
stays 12 (corroboration-scoreable = Node), the corroborated gate stays
`undefined-n`, and no number moved. See
[`CORROBORATED-GATE-READINESS.md`](CORROBORATED-GATE-READINESS.md).
