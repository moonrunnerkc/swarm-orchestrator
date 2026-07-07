# Corroborated structural gate: readiness

The corroborated structural gate blocks a merge when a structural cheat
finding is backed by a runtime signal (a surviving mutant, a coverage gap,
or a still-failing issue repro) on the same changed line. This is the
measurement that decides whether that signal is precise enough, against
real merged-PR outcomes, to be allowed to gate. Every number here
regenerates from a committed script.

## Result: undefined-n, gate stays advisory

`npm run corroborated-gate:measure`
(`scripts/gate/measure-corroborated-gate.ts`) over
[`eg-viable-corroborated.json`](eg-viable-corroborated.json) and
[`eg-viability.json`](eg-viability.json), written to
[`corroborated-gate-precision.json`](corroborated-gate-precision.json).

| quantity | value |
|---|---|
| provisionable slice (Node) | 12 PRs |
| outcome-bad in that slice | 0 (all 12 survived) |
| corroborated findings scored | 0 |
| status | `undefined-n` |
| Wilson-95 lower bound | not computed (no positive class) |

The gate is **not** lit. There is no positive class to measure precision
against: the 12 PRs the sandbox can provision are all outcome-clean, so a
corroborated finding on any of them would be a false positive by
construction, and precision has no meaningful value. Per the measurement
loop's rule, a slice with no outcome-bad PR is `undefined-n` and can never
be reported as ready.

## Why the positive class is empty here

The outcome-labeled corpus has 22 outcome-bad PRs (0 reverted, 22
hotfixed). Eight of them are EG-viable: **5 pytest (All-Hands-AI/OpenHands)
and 3 Go (divord97/ccc)**, not "eight pytest" as an earlier draft of this
report stated. The 12 Node PRs that provision the corroboration engine are
all outcome-clean. The intersection of "corroboration-scoreable" and
"outcome-bad" is empty.

## Phase 1 result: the install path is not the binding constraint

Phase 1 wired pytest (venv + pip / poetry) and Go (`go mod download`)
dependency install into the sandbox
([`EG-VIABILITY-POLYGLOT-REPORT.md`](EG-VIABILITY-POLYGLOT-REPORT.md)), then
attempted every one of the eight outcome-bad EG-viable PRs
([`polyglot-provisioning.json`](polyglot-provisioning.json),
`npm run polyglot-provision`). Wiring the install did **not** move them into
the measurable slice. The recorded per-PR outcome:

| status | count | what it means |
|---|---|---|
| `no-mutable-source` | 7 | the PR adds source but modifies/deletes none, so the v12 additive-code control finds no revertable line to corroborate (correct, by design) |
| `provision-failed` | 1 | `openhands…pr14505` cloned, then `poetry install` failed closed (poetry is not on the sandbox PATH); the real command is recorded |

Two independent reasons keep the positive class empty, and provisioning
fixes neither:

1. **The corroboration engine is Node-only.** Mutation (Stryker), coverage
   delta, and issue-repro all emit runtime signals only for JS/TS runners; a
   pytest or Go tree scores zero corroborated findings even when it installs
   cleanly. Porting the engine to Python/Go is recorded future work, not part
   of the install seam.
2. **Seven of the eight outcome-bad PRs are purely additive.** They add a new
   file and its test; there is no pre-existing behaviour to falsify, so the
   corroboration engine has nothing to revert regardless of ecosystem.

So the binding constraint was never the Node-only install path; it is the
Node-only corroboration engine plus the additive shape of these specific
outcome-bad PRs. Phase 1 is the honest disproof of the earlier claim that
"pytest / Go provisioning … moves them into the measurable slice directly."

## What lights the gate up

The loop is wired end to end and will flip the moment the measurable slice
carries corroboration-scoreable outcome-bad PRs and the precision clears the
bar. The paths that grow that slice:

1. **Backward-mine cron.** `.github/workflows/backward-mine.yml` mines PRs
   backward from revert markers nightly and uploads the grown corpus as an
   artifact for maintainer review. A Node-provisionable outcome-bad PR with a
   revertable source hunk landing in the reviewed corpus adds a positive.
2. **A Python/Go corroboration engine.** Only extending mutation/coverage/
   issue-repro to pytest and Go turns the now-installable pytest and Go PRs
   into corroboration-scoreable positives. The install path (Phase 1) is the
   prerequisite; the engine port is the remaining work.

Once the slice has corroboration-scoreable outcome-bad PRs,
`corroborated-gate:measure` computes
the precision and its Wilson-95 lower bound. The gate is marked ready, and
so eligible to block, only when that lower bound is at or above 0.90 with
at least 5 true positives. `npm run corroborated-gate:check` recomputes the
artifact in CI and refuses any committed verdict that claims ready on
undefined n or below the floor, so the gate cannot be hand-lit without the
measured precision to support it.
