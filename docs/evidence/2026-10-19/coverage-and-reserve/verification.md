# Deterministic verification of the product before any launch

All of it on `4e6c4e510e371821970e9c22afd513b2e6506be4`, in a clean full-history clone (`git clone --branch
fix/requirement-coverage-and-verification-reserve`, `v12-final` present), Node 24.15.0, after
`npm ci` (exit 0). Logs, verbatim but for the clone's path, in `verification/` ([gates](packed-derived/verification-logs/) (the log gates-4e6c4e510.txt, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back), [build](verification/build-4e6c4e510.txt), [packaged](verification/packaged-4e6c4e510.txt), [fuzz](verification/fuzz-4e6c4e510.txt)).

| command | exit | result |
| --- | --- | --- |
| `npm run gates` | 0 | checks: weight 87.7 MB with 12.3 MB headroom (6.0 MB required), 100 derived packs restore, 15 cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings, 1 info, none in a file this work touched (13 in `src/eval/campaign-run.test.ts`, the rest in older scripts); tests 465 files passed and 5 skipped, 4,525 tests passed and 29 skipped ([gates-4e6c4e510.txt](packed-derived/verification-logs/) (the log gates-4e6c4e510.txt, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)) |
| `npm run build` | 0 | [build-4e6c4e510.txt](verification/build-4e6c4e510.txt) |
| `npm run check:packaged` | 0 | every documented command met its packaged behavioural contract ([packaged-4e6c4e510.txt](verification/packaged-4e6c4e510.txt)) |
| `npm run fuzz:build` | 0 | [fuzz-4e6c4e510.txt](verification/fuzz-4e6c4e510.txt) |

The same 5 files and 29 tests were skipped in PR #89's recorded gates run ([../repair-value/verification-final.md](../repair-value/verification-final.md): 462 files and 4,487 tests passed there); this work added 3 test files and 38 tests and no skip.
The new regressions' results against PR #89's head are in [regressions-before.md](regressions-before.md).
These are local results: nothing is pushed, and no CI ran on this branch.

## After the launches

`npm run gates` again on `d86dd8b81c8d99b91fd7f74dee3b87ddbc0acf22` (the branch head after every launch, record and correction; its
`src/`, `scripts/` and lockfile are `4e6c4e510`'s), in a fresh clean full-history clone after
`npm ci` (exit 0): **exit 0**; zero doc-path misses, 11.3 MB of weight headroom, every pack restores
(the three added here included), 15 cited bundles verify; lint 28 warnings and 1 info, as before;
465 test files passed and 5 skipped, 4,525 tests passed and 29 skipped
([gates-d86dd8b81.txt](packed-derived/verification-logs/) (the log gates-d86dd8b81.txt, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)). The only commit after it adds this
paragraph and that log.
