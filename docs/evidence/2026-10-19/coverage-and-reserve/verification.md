# Deterministic verification of the product before any launch

All of it on `4e6c4e510e371821970e9c22afd513b2e6506be4`, in a clean full-history clone (`git clone --branch
fix/requirement-coverage-and-verification-reserve`, `v12-final` present), Node 24.15.0, after
`npm ci` (exit 0). Logs, verbatim but for the clone's path: [verification/](verification/).

| command | exit | result |
| --- | --- | --- |
| `npm run gates` | 0 | checks: weight 87.7 MB with 12.3 MB headroom (6.0 MB required), 100 derived packs restore, 15 cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings, 1 info, none in a file this work touched (13 in `src/eval/campaign-run.test.ts`, the rest in older scripts); tests 465 files passed and 5 skipped, 4,525 tests passed and 29 skipped ([gates-4e6c4e510.log](verification/gates-4e6c4e510.log)) |
| `npm run build` | 0 | [build-4e6c4e510.log](verification/build-4e6c4e510.log) |
| `npm run check:packaged` | 0 | every documented command met its packaged behavioural contract ([packaged-4e6c4e510.log](verification/packaged-4e6c4e510.log)) |
| `npm run fuzz:build` | 0 | [fuzz-4e6c4e510.log](verification/fuzz-4e6c4e510.log) |

The same 5 files and 29 tests were skipped in PR #89's recorded gates run ([gates-36772dda9.log](../repair-value/verification/gates-36772dda9.log): 462 files and 4,487 tests passed there); this work added 3 test files and 38 tests and no skip.
The new regressions' results against PR #89's head are in [regressions-before.md](regressions-before.md).
These are local results: nothing is pushed, and no CI ran on this branch.
