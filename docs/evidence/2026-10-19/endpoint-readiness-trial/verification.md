# Deterministic verification of the tested commit before the trial

In a fresh clean full-history clone of the branch at `826e60e83` (`~/.cache/swarm-comparison/tools/swarm-826e60e83`,
`v12-final` present), Node 24.15.0, after `npm ci` (exit 0). Logs, verbatim, in `verification/`.
This is the trial's build: its product source is `005d5eb8d`'s, and the commits above it on the
branch change the comparison harness, its fixtures and this evidence only.

| commit | command | exit | result |
| --- | --- | --- | --- |
| **`826e60e83`** | `npm run gates` | **0** | zero doc-path misses, 9.2 MB of weight headroom (6.0 MB required), every pack restores, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info (the counts on `8b17304d9`); **468 test files passed and 5 skipped, 4,592 tests passed and 29 skipped** ([gates-826e60e83.txt](verification/gates-826e60e83.txt)) |
| **`826e60e83`** | `npm run check:packaged`, `npm run fuzz:build` | **0, 0** | [packaged](verification/packaged-826e60e83.txt), [fuzz](verification/fuzz-826e60e83.txt). `npm run build` exited 0 in the same clone (`~/.cache/swarm-comparison/tools/swarm-826e60e83-build.log`, not tracked). |

The 29 skipped tests and 5 skipped files are the ones skipped on `8b17304d9`; this work added 22
tests (4,592 against the branch head's 4,570: 15 in the two new unit files, 7 through the real
runner) and no skip. These are local results on an unpushed branch: no CI ran.
[regressions-before.txt](regressions-before.txt) runs the new cases against the starting harness
`28efda8d6`, read in [README.md](README.md) section 3.

## After the trial

| commit | command | exit | result |
| --- | --- | --- | --- |
| **`0f3210739`** (the branch head after the trial: the evidence of sections 5 to 7 above the tested harness; `src/` and `scripts/` unchanged since `826e60e83`) | `npm run gates`, in the worktree | **0** | zero doc-path misses, 8.5 MB of headroom (the trial's packed streams added 0.6 MB), every pack restores (the trial's, 1,075 files, included), cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info; **468 test files passed and 5 skipped, 4,592 tests passed and 29 skipped** ([gates-0f3210739.txt](verification/gates-0f3210739.txt)) |
