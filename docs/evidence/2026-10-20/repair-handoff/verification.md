# Deterministic verification of this work

In the worktree of the branch, Node 24.15.0, the dependencies already installed. Logs, verbatim, in
`verification/`. Each run is recorded as it happened; runs are not combined.

| commit | command | exit | result |
| --- | --- | --- | --- |
| `6504522be` (the evidence of the pair, above the opt-in commit `50c3a84e2`) | `npm run gates`, run 1 | **1** | stopped at the documentation-path check with 3 misses: the README's link to this file, which did not exist yet, and two mentions of `src/rules.ts` (the task's file, not this repository's) in the README and the closed protocol. Typecheck, lint and the tests did not run ([gates-6504522be.txt](packed-derived/verification-logs/) (the log gates-6504522be.txt, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)). The README's mention is rephrased; the protocol is not edited after its first launch, so the checker names that path as known with its reason (scope amendment 1). |
| **`4f17c98d7`** (the branch head: the known-path entry and this record's first row above `6504522be`; `src/` unchanged since `50c3a84e2`) | `npm run gates` | **0** | zero doc-path misses (23 known and named), 7.0 MB of weight headroom (6.0 MB required; the two packed launches added about 0.6 MB), all 108 derived-artifact packs restore, cited bundles verify, CI verdicts re-derive; typecheck clean; lint 0 errors, 28 warnings and 1 info (the counts on `3cdfc34b9`); **468 test files passed and 5 skipped, 4,608 tests passed and 29 skipped** ([gates-4f17c98d7.txt](packed-derived/verification-logs/) (the log gates-4f17c98d7.txt, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)) |
| **`4f17c98d7`** | `npm run build`, `npm run check:packaged`, `npm run fuzz:build` | **0, 0, 0** | `dist/` emitted with 21 assets (the build's log is not tracked); every documented command met its packaged behavioural contract ([packaged](verification/packaged-4f17c98d7.txt)); the fuzz build ran its 9 and 12 seeds ([fuzz](verification/fuzz-4f17c98d7.txt)) |

The 29 skipped tests and 5 skipped files are the ones skipped on `3cdfc34b9`; this work added 10
tests (4,608 against 4,598: two on the tracker, one on the loop, three through the real chokepoint,
four on the account) and no skip. The product source of `4f17c98d7` is `50c3a84e2`'s: the tracker,
loop and worker of `c538331f0`, and the account builder with the results opt-in and off. The two
launches ran on `c538331f0` and `afa2deedc`, whose `dist/` trees the launch records digest
([live-control/record.json](live-control/record.json), [live-treatment/record.json](live-treatment/record.json));
`afa2deedc`'s builder carried the results by default and the head's does not. These are local
results; CI is read on the pushed branch and recorded in the pull request.

[regressions-before.txt](regressions-before.txt) runs the new tool-feedback cases against the
starting implementation `3cdfc34b9`, read in [README.md](README.md) section 2: five fail there,
one behavioural (the listing after a shell command that edited a file, withheld through the real
chokepoint), one on the stall's new `writes` field, and three on the notices' wording (the tracker,
the loop and the worker each telling a repeated write that no writing call had landed); the guard
case, the same listing twice with nothing between, passes on both.
