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

`b51d4fe7d` is the branch head carrying this evidence and the claims row; `src/` is unchanged
since `e7c60c7a6`. Two full runs, recorded as they happened and not combined:

| commit | command | exit | result |
| --- | --- | --- | --- |
| **`b51d4fe7d`** | `npm run gates`, run 1 | **1** | checks, typecheck and lint as above (8.3 MB of headroom); **467 test files passed, 1 failed, 5 skipped; 4,597 tests passed, 1 failed, 29 skipped.** The failure is one timeout: `src/agent-run.test.ts` "the gates after a loop that spent its wall > still runs the required checks on the exact tree the loop delivered", 60,098 ms against its 60 s limit. That case runs a real 2 s wall on the system clock and then real gates in a fresh checkout; the five-minute load average on the machine was 9.6 during the run (other sessions' work). It passed in the run on `e7c60c7a6` above, whose source is this commit's ([gates-b51d4fe7d-run-1.txt](verification/gates-b51d4fe7d-run-1.txt)) |
| **`b51d4fe7d`** | that test group alone | **0** | 3 passed ([rerun-agent-run-b51d4fe7d.txt](verification/rerun-agent-run-b51d4fe7d.txt)) |
| **`b51d4fe7d`** | `npm run gates`, run 2 | **0** | the same checks; **468 test files passed and 5 skipped, 4,598 tests passed and 29 skipped** ([gates-b51d4fe7d-run-2.txt](verification/gates-b51d4fe7d-run-2.txt)) |

The timeout is a load-sensitive wall-clock case and not a behaviour of this change; it is named
here rather than dropped. CI on the pushed branch is recorded in the pull request.
