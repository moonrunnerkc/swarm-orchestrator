# Gates and release checks on the exact commits

Run in the branch's worktree, Node v24.15.0, npm 11.12.1, macOS, with the worktree's own `npm ci`.
The logs are packed under [packed-derived/verification-logs](packed-derived/verification-logs/)
(`scripts/evidence-pack.mjs` restore gives them back); the lines below are copied from them.

| commit | what | exit | result |
| --- | --- | --- | --- |
| **`a7de453ed`** (the comparison reported; the product code of `099558499`) | `npm run gates` | **0** | "invariant block matches across CLAUDE.md and AGENTS.md: 16 invariants", "predicate catalogue matches the ledger and the verifier: 62 record kinds", "zero misses, 24 known and named, 68 generated", "under the 100.0 MB ceiling with 6.2 MB of headroom (6.0 MB required)", "all 142 derived-artifact pack(s) restore their inventories", "all 15 cited bundles verify from this checkout", CI verdicts re-derive; typecheck clean; lint "Found 29 warnings", no error; **476 test files passed, 5 skipped; 4,705 tests passed, 29 skipped** |
| `a7de453ed` | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0** | "build: dist/ emitted, 21 asset(s) copied"; "every documented command met its packaged behavioral contract"; fuzz build exit 0 |
| `736251101` (the build the comparison launched) | `npm run gates` | **0** | 6.2 MB of headroom; all 15 cited bundles verify; lint 29 warnings, no error; 476 test files passed, 5 skipped; 4,705 tests passed, 29 skipped |
| `736251101` | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0** | as above |
| `f4c9a10b2` (before `099558499`) | `npm run gates` | **1** | **1 test failed** of 4,734: `src/workers/contract-enforcement.test.ts` pinned the worker assessment's policy as `run-acceptance-v4`; updated to v5 in `099558499` ([gates-f4c9a10b2-failed.txt](packed-derived/verification-logs/)) |

Commits after `a7de453ed` change only this file and the packed logs.
