# Verification of the product commits

`npm run gates` and the release checks, run on `a1e6c960856ade615f48917f3036169cf425ffb1` in a clean
clone with full history (the `v12-final` tag present), `npm ci` first, Node 24.15.0, with no model
resident and nothing else running. The commit holds the three product commits of this work
(`193bfbe4e`, `10ee69729`, `a1e6c9608`) on `f556b6313`; the evidence commits after it change no
`src/`, `scripts/` or lockfile. The full output of each command is beside this file.

| command | exit | result |
| --- | --- | --- |
| `npm run gates` ([log](verification/gates-a1e6c9608.log)) | 0 | checks passed (14.6 MB of weight headroom, 6.0 MB required); typecheck clean; lint 28 warnings, none new (the count `7e802a360` recorded); 462 test files passed and 5 skipped, 4487 tests passed and 29 skipped |
| `npm run build` ([log](verification/build-a1e6c9608.log)) | 0 | `dist/` emitted, 21 assets copied |
| `npm run check:packaged` ([log](verification/packaged-a1e6c9608.log)) | 0 | every documented command met its packaged behavioural contract |
| `npm run fuzz:build` ([log](verification/fuzz-a1e6c9608.log)) | 0 | eight smoke targets, 84 seeds |

The gates were run once, on this commit; no total combines separate runs. Focused runs during
development, before and after each change, are in [policy-audit/](policy-audit/). The final state
of the branch is verified again before it is pushed ([README.md](README.md)).
