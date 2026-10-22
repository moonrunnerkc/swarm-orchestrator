# Gates and release checks on the exact commits

Run on the branch `fix/accessor-audit-and-checking-distinction` in its worktree, Node v24.15.0,
npm 11.12.1, macOS, with the worktree's own `npm ci`. The logs are packed under
[packed-derived/verification-logs](packed-derived/verification-logs/) (`scripts/evidence-pack.mjs`
restore gives them back); the lines below are copied from them.

| commit | what | exit | result |
| --- | --- | --- | --- |
| **`3fa28403a`** (the branch head; the code of `87b6f294e`, `cbf9544b4` and the notice's scoping) | `npm run gates` | **0** | checks: "invariant block matches across CLAUDE.md and AGENTS.md: 16 invariants", "predicate catalogue matches the ledger and the verifier: 62 record kinds", "zero misses, 24 known and named, 67 generated", "under the 100.0 MB ceiling with 6.1 MB of headroom (6.0 MB required)", every derived pack restores, "all 15 cited bundles verify from this checkout", CI verdicts re-derive; typecheck clean; lint "Found 29 warnings", no error; **475 test files passed, 5 skipped; 4,687 tests passed, 29 skipped** |
| `3fa28403a` | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0** | "build: dist/ emitted, 21 asset(s) copied"; "every documented command met its packaged behavioral contract"; fuzz smoke: 8 suites ran their seeds |
| `9e2ffc2f0` (before the notice's scoping) | `npm run gates` | **1** | **4 tests failed** of 4,716: the escalation test and three planned-checks integration tests whose scripted repairs decline with no tool call, each asked once more by the notice of `cbf9544b4`; fixed in `3fa28403a` ([verification/gates-9e2ffc2f0-failed.txt](packed-derived/verification-logs/)) |
| `498296a9f` | `npm run gates` | **1** | stopped at the weight check: 5.8 MB of headroom against 6.0 required after launch 2's payload pack; seven more files packed in `038f3af50` |
| `87b6f294e` | `npm test` | **0** | 475 files, 4,686 tests passed, 29 skipped, before the trial's launches (the typecheck and lint of that commit were run apart and were clean) |

The builds the trial launched are `87b6f294e` and `cbf9544b4`, both ancestors of `3fa28403a`; the
code of `3fa28403a` differs from `cbf9544b4` only in giving the no-tool notice to repairs of
failing checks and not to owed attempts, which no launch exercised ([README.md](README.md), section 5).
