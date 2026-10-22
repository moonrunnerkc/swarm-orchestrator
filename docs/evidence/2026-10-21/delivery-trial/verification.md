# Gates and release checks on the exact commits

Run on the branch `fix/accessor-audit-and-checking-distinction` in its worktree, Node v24.15.0,
npm 11.12.1, macOS, with the worktree's own `npm ci`. The logs are packed under
[packed-derived/verification-logs](packed-derived/verification-logs/) (`scripts/evidence-pack.mjs`
restore gives them back); the lines below are copied from them.

| commit | what | exit | result |
| --- | --- | --- | --- |
| **`4f2c575f0`** (the branch head after the trial's evidence; `src/` and `scripts/` unchanged since `643b9ef4c`) | `npm run gates` | **0** | checks: corpus history ok, "predicate catalogue matches the ledger and the verifier: 62 record kinds", "zero misses, 23 known and named, 66 generated", "under the 100.0 MB ceiling with 6.2 MB of headroom (6.0 MB required)", every derived pack restores, cited bundles verify, CI verdicts re-derive; typecheck and lint clean; **473 test files passed, 5 skipped; 4,665 tests passed, 29 skipped** (283 s) |
| `4f2c575f0` | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0** | "build: dist/ emitted, 21 asset(s) copied"; packed CLI: init, check, verdict, hook, mcp, pre-commit, action, gates, select each with the expected exit and diagnostic; fuzz smoke: bundle-read 6, gate-parsers 12, ledger-chain 7, predicate 15, scrub 14, swarm-toml 9, unified-diff 12 seed(s) |

The commit that adds this file and the logs changes no code and no evidence record. The
pinned builds the trial launched are `d2437c430` and `643b9ef4c`, both ancestors of
`4f2c575f0`; the full suite also passed on `926c9ae96` (473 files, 4,664 tests) before the
trial's commits, with the same checks.
