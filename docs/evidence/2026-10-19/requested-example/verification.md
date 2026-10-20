# Deterministic verification of the product before the trial

Each run in a fresh clean full-history clone of the branch (`git clone --branch
fix/requirement-coverage-and-verification-reserve`, `v12-final` present), Node 24.15.0, after
`npm ci` (exit 0). Logs, verbatim but for the clone's path, in `verification/`.

| commit | command | exit | result |
| --- | --- | --- | --- |
| `100306e86` | `npm run gates` | **1** | stopped at lint: one `noUnsafeOptionalChaining` error in a new test (`src/cli-plan-checks.test.ts`), so the tests did not run ([gates-100306e86-failed.txt](verification/gates-100306e86-failed.txt)). Fixed in `221d694b7`. Build, packaged and fuzz exited 0 on that clone; their logs are not kept. |
| `221d694b7` | `npm run gates` | 0 | zero doc-path misses, 10.3 MB of weight headroom (6.0 MB required), every pack restores, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info (the counts on `8b17304d9`); 466 test files passed and 5 skipped, 4,567 tests passed and 29 skipped ([gates-221d694b7.txt](verification/gates-221d694b7.txt)). Superseded: `059af72db` changed `src/agent-run.ts` after it (a follow-up not kept left its own lifecycle as the run's), and `16ec1a7e6` answered a review. Build, packaged and fuzz exited 0. |
| `059af72db` | `npm run gates` | not finished | stopped by hand when a review found two defects; no result is claimed for it. |
| `16ec1a7e6` | `npm run gates` | 0 | superseded by `b470b55e2`, which makes the interpretation trail follow each check's versions across outcomes (the replay of section 2 showed it empty for the launch's sequence): zero doc-path misses, 10.3 MB of headroom, all 103 packs restore, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info; 466 test files passed and 5 skipped, **4,568 tests passed and 29 skipped** ([gates-16ec1a7e6.txt](verification/gates-16ec1a7e6.txt)) |
| `16ec1a7e6` | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | 0, 0, 0 | [build](verification/build-16ec1a7e6.txt), [packaged](verification/packaged-16ec1a7e6.txt), [fuzz](verification/fuzz-16ec1a7e6.txt) |
| **`b470b55e2`** | `npm run gates` | **0** | zero doc-path misses, 10.3 MB of headroom, all 103 packs restore, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info; **466 test files passed and 5 skipped, 4,569 tests passed and 29 skipped** ([gates-b470b55e2.txt](verification/gates-b470b55e2.txt)) |
| **`b470b55e2`** | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0, 0, 0** | [build](verification/build-b470b55e2.txt), [packaged](verification/packaged-b470b55e2.txt), [fuzz](verification/fuzz-b470b55e2.txt). This is the trial's frozen build. |

The 29 skipped tests and 5 skipped files are the ones skipped on `8b17304d9` (4,541 passed there);
this work added 28 tests (4,569 against 4,541) and no skip. These are local results on an unpushed branch: no CI ran.
The new regressions' results against the starting implementation `544f643a3` are in
[regressions-before.txt](regressions-before.txt) and read in [README.md](README.md) section 4.
