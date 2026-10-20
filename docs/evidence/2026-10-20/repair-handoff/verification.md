# Deterministic verification of this work

In the worktree of the branch, Node 24.15.0, the dependencies already installed. Logs, verbatim, in
`verification/`. Each run is recorded as it happened; runs are not combined.

| commit | command | exit | result |
| --- | --- | --- | --- |
| `6504522be` (the evidence of the pair, above the opt-in commit `50c3a84e2`) | `npm run gates`, run 1 | **1** | stopped at the documentation-path check with 3 misses: the README's link to this file, which did not exist yet, and two mentions of `src/rules.ts` (the task's file, not this repository's) in the README and the closed protocol. Typecheck, lint and the tests did not run ([gates-6504522be.txt](verification/gates-6504522be.txt)). The README's mention is rephrased; the protocol is not edited after its first launch, so the checker names that path as known with its reason (scope amendment 1). |
