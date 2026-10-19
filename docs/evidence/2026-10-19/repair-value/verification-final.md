# Verification of the branch head before push

`npm run gates` and the release checks, run on the branch head in a clean clone with full history,
`npm ci` first, Node 24.15.0, with no model resident and nothing else running. The commit they ran
on is the parent of the commit that records the results below; that recording commit adds this
section's results and the logs beside it, and nothing else.

## Results, on `36772dda9cd3cf04ea1939e2d664022dc909ae4c`

| command | exit | result |
| --- | --- | --- |
| `npm run gates` ([log](verification/gates-36772dda9.log)) | 0 | checks passed (zero doc-path misses, 12.5 MB of weight headroom with 6.0 MB required, 100 packs restore, 15 cited bundles verify); typecheck clean; lint 28 warnings and 1 info, all predating this work (the info is in a line of `src/evidence/rederive.test.ts` from `343ae4740`); 462 test files passed and 5 skipped, 4487 tests passed and 29 skipped |
| `npm run build` ([log](verification/build-36772dda9.log)) | 0 | `dist/` emitted |
| `npm run check:packaged` ([log](verification/packaged-36772dda9.log)) | 0 | every documented command met its packaged behavioural contract |
| `npm run fuzz:build` ([log](verification/fuzz-36772dda9.log)) | 0 | eight smoke targets |

`src/`, `scripts/` and the lockfile at this commit are those of `a1e6c9608`, whose run is in
[verification.md](verification.md); the two runs agree in every count.
