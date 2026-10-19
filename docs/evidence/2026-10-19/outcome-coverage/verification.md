# Deterministic verification of the product before the launch

All of it on `b148573e38d90464c72c5af49d75fdb409b09563`, in a clean full-history clone (`git clone
--branch fix/requirement-coverage-and-verification-reserve`, `v12-final` present), Node 24.15.0,
after `npm ci` (exit 0). Logs, verbatim but for the clone's path, in `verification/`.

| command | exit | result |
| --- | --- | --- |
| `npm run gates` | 0 | checks: zero doc-path misses, weight under the 100.0 MB ceiling with 11.2 MB headroom (6.0 MB required), every derived pack restores, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info, none in a file this work touched (the same counts as on `4e6c4e510`); tests 465 files passed and 5 skipped, 4,541 tests passed and 29 skipped ([gates-b148573e3.txt](verification/gates-b148573e3.txt)) |
| `npm run build` | 0 | [build-b148573e3.txt](verification/build-b148573e3.txt) |
| `npm run check:packaged` | 0 | [packaged-b148573e3.txt](verification/packaged-b148573e3.txt) |
| `npm run fuzz:build` | 0 | [fuzz-b148573e3.txt](verification/fuzz-b148573e3.txt) |

The 5 skipped files and 29 skipped tests are the ones skipped on `4e6c4e510`
([../coverage-and-reserve/verification.md](../coverage-and-reserve/verification.md): 4,525 passed
there); this work added 16 tests and no skip. The new regressions' results against the starting
implementation are in [regressions-before.md](regressions-before.md). The D1 replays of
[README.md](README.md) section 2 ran on this commit's build (`dist/cli.js`
`sha256:c371adadda72...`, the same bytes as the launch build in
`~/.cache/swarm-comparison/tools/swarm-b148573e3`). These are local results: nothing is pushed, and
no CI ran on this branch.
