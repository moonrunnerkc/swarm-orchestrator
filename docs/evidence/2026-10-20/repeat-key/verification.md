# Deterministic verification of this work

In the worktree of the branch `fix/stall-generation-and-marked-audit`, Node 24.15.0, npm 11.12.1,
the dependencies already installed, with no model server request in flight (the comparison's two
launches had ended; Ollama's resident model was idle). Logs, verbatim, in `verification/`. Each
run is recorded as it happened; runs are not combined.

| commit | command | exit | result |
| --- | --- | --- | --- |
| **`1240a6e90`** (the branch head with every change of this work: the fix `8ce795eb8`, its evidence, the Marked audit, the registered and recorded comparison; `src/` unchanged since `8ce795eb8`) | `npm run gates` | **0** | zero doc-path misses (the known paths named), 6.4 MB of weight headroom (6.0 MB required; the packed comparison streams and the audit added about 0.6 MB), all 109 derived-artifact packs restore, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info (the counts on `33fbf1693`, none in a file this work touched); **468 test files passed and 5 skipped, 4,615 tests passed and 29 skipped**, 286.8 s ([gates-1240a6e90.txt](verification/gates-1240a6e90.txt)) |
| **`1240a6e90`** | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0, 0, 0** | `dist/` emitted with 21 assets (the build's log is not tracked); every documented command met its packaged behavioural contract ([packaged](verification/packaged-1240a6e90.txt)); the fuzz build ran its 14, 9 and 12 seeds ([fuzz](verification/fuzz-1240a6e90.txt)) |

The 29 skipped tests and 5 skipped files are the ones skipped on `33fbf1693`; this work added 7
tests (4,615 against 4,608: four on the tracker, replacing two whose expectations the rule
changed, one on the loop, two through the real chokepoint) and no skip. The comparison's Swarm arm
ran on `8ce795eb8`, whose `dist/` tree the launch record digests; the commits above it on the
branch change documentation and evidence only (`git diff 8ce795eb8..1240a6e90 --stat -- src scripts packages package.json package-lock.json`
is empty). These are local results; CI is read on the pushed branch and recorded in the pull
request.

[regressions-before.txt](regressions-before.txt) runs the new cases against the starting
implementation `33fbf1693`, read in [README.md](README.md) section 2: the end-to-end shell check
after an edit comes back there as the "already answered" notice with no evidence reference, and
on `8ce795eb8` as the fresh result with its own record.
