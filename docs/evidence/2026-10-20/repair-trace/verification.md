# Deterministic verification of this work

In the worktree of the branch at `e7c60c7a6` (the product change: the tracker, the loop, the
worker's wiring, their tests and the changelog entry, above `d6972897e`), Node 24.15.0, the
dependencies already installed. Logs, verbatim, in `verification/`.

| commit | command | exit | result |
| --- | --- | --- | --- |
| **`e7c60c7a6`** | `npm run gates` | **0** | zero doc-path misses, 8.4 MB of weight headroom (6.0 MB required), every pack restores, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info (the counts on the branch head before this work); **468 test files passed and 5 skipped, 4,598 tests passed and 29 skipped** ([gates-e7c60c7a6.txt](verification/gates-e7c60c7a6.txt)) |
| **`e7c60c7a6`** | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0, 0, 0** | `dist/` emitted with 21 assets; every documented command met its packaged behavioural contract ([packaged](verification/packaged-e7c60c7a6.txt)); the fuzz build ran its 9 and 12 seeds ([fuzz](verification/fuzz-e7c60c7a6.txt)). The build's log is not tracked. |

The 29 skipped tests and 5 skipped files are the ones skipped on `d6972897e`; this work added 6
tests (4,598 against 4,592: four on the tracker, one on the loop, one through the real chokepoint)
and no skip. These are local results; CI is read on the pushed branch and recorded in the pull
request. [regressions-before.txt](regressions-before.txt) runs the new cases against the starting
implementation `d6972897e`, read in [README.md](README.md) section 5: four fail there, three on
behaviour and one on wording, and the two guard cases pass on both.

## After the evidence

Filled in below once the branch head carrying this evidence is gated.
