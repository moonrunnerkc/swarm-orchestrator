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
hotfixed). Eight of them are EG-viable, but all eight are pytest projects,
and the sandbox's dependency-install path is Node package managers only
(see [`EG-VIABILITY-POLYGLOT-REPORT.md`](EG-VIABILITY-POLYGLOT-REPORT.md)).
So the eight outcome-bad EG-viable PRs cannot be provisioned to run the
corroboration engine on, and the 12 that can be provisioned are all
outcome-clean. The intersection of "provisionable" and "outcome-bad" is
empty.

## What lights the gate up

The loop is wired end to end and will flip the moment the measurable slice
carries outcome-bad PRs and the precision clears the bar. Two paths grow
that slice:

1. **Backward-mine cron.** `.github/workflows/backward-mine.yml` mines PRs
   backward from revert markers nightly and uploads the grown corpus as an
   artifact for maintainer review. A Node-provisionable outcome-bad PR
   landing in the reviewed corpus adds a positive to the slice.
2. **pytest / Go provisioning.** Wiring `pip install` / `go mod download`
   into the sandbox install step (the bounded follow-on named in the
   polyglot report) makes the eight outcome-bad pytest PRs provisionable,
   which moves them into the measurable slice directly.

Once the slice has outcome-bad PRs, `corroborated-gate:measure` computes
the precision and its Wilson-95 lower bound. The gate is marked ready, and
so eligible to block, only when that lower bound is at or above 0.90 with
at least 5 true positives. `npm run corroborated-gate:check` recomputes the
artifact in CI and refuses any committed verdict that claims ready on
undefined n or below the floor, so the gate cannot be hand-lit without the
measured precision to support it.
