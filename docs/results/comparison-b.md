# Comparison B: complete coding workflows

Derived from `docs/evidence/2026-09-28/comparison-b/rows.json` (digest sha256:ca45d376e332eb0b79cf2a612406a7b2ad95d1965bd50eb0e553b90a5a8a2020) under
the Comparison B amendment of `docs/verifier-first/comparison-protocol.md`, registered before
any B run. Shared prefix: the reach-pressure experiment's generation 3 over
`mined-pr-viable-79` with Qwen3.8-27B (MLX, 8-bit, greedy, thinking off).

79 tasks; 14 reached a fork (the visible oracle accepted a step). Every
task without a fork ends on the prefix's final patch in every arm, so its pair is concordant by
construction.

| Arm | Held-back outcomes over 79 tasks |
| --- | --- |
| B0: the repository's own visible checks, stop at the fork | fail 67, pass 12 |
| B1: plus the released verifier's regression-only verdict fed back | fail 67, pass 12 |
| B2: plus requirement challenges | not applicable: no task in the cohort carries a requirement contract |

Paired B0 against B1: help 0 (B0 fails held-back, B1 passes), harm 0
(B0 passes, B1 fails), concordant 79, not yet paired 0. The frozen
rule calls no difference below ten discordant pairs; the most this design can produce is
14, one per fork.

## B1's repairs

5 fork patch(es) failed the verifier's regression-only verdict and were fed back.
- iamkun/dayjs#2330: 1 invocation(s); regression passed with the visible oracle still accepting; the final patch differs from the fork patch. Feedback: lint: the command exited 1.
- koajs/koa#1904: 2 invocation(s); regression still failed after the last invocation; the final patch is the fork patch unchanged. Feedback: tests: 400 collected, 398 passed, 2 failed, 0 skipped (exit 1).
- koajs/koa#1961: 2 invocation(s); regression still failed after the last invocation; the final patch is the fork patch unchanged. Feedback: tests: 439 collected, 437 passed, 2 failed, 0 skipped (exit 1).
- koajs/koa#1999: 2 invocation(s); regression still failed after the last invocation; the final patch is the fork patch unchanged. Feedback: tests: 459 collected, 457 passed, 2 failed, 0 skipped (exit 1).
- tj/commander.js#1671: 2 invocation(s); regression still failed after the last invocation; the final patch is the fork patch unchanged. Feedback: tests: the runner reported: 978 passed, 978 total.

## Fork rows

| Task | Prefix regression at the fork | B1 verdict (1.0.4) | B1 decision | B0 held-back | B1 held-back |
| --- | --- | --- | --- | --- | --- |
| iamkun/dayjs#2330 | fail | regression fail, failed: lint, inherited: tests, build | repaired | pass | pass |
| iamkun/dayjs#3180 | pass | regression pass, inherited: tests, build | stop | pass | pass |
| jhlywa/chess.js#378 | pass | regression pass | stop | pass | pass |
| koajs/koa#1904 | pass | regression fail, failed: tests | repaired | pass | pass |
| koajs/koa#1961 | pass | regression fail, failed: tests | repaired | pass | pass |
| koajs/koa#1999 | pass | regression fail, failed: tests | repaired | pass | pass |
| tj/commander.js#1557 | pass | regression pass | stop | pass | pass |
| tj/commander.js#1613 | pass | regression pass | stop | pass | pass |
| tj/commander.js#1671 | pass | regression fail, failed: tests | repaired | fail | fail |
| tj/commander.js#1726 | pass | regression pass | stop | pass | pass |
| tj/commander.js#1763 | pass | regression pass | stop | fail | fail |
| tj/commander.js#1832 | pass | regression pass | stop | pass | pass |
| tj/commander.js#2223 | pass | regression pass | stop | pass | pass |
| winstonjs/winston#2256 | pass | regression pass | stop | pass | pass |
