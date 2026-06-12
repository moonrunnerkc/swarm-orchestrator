# Limitations and what's next

An honest accounting of where the tool is weak today and what is being worked on.

## It over-flags clean PRs at scale

On a large clean-PR corpus the structural detectors fire on legitimate patterns: relocated tests, refactors that change assertion shape, pragmatic suppressions. That's why `--mode advise` is the default and nothing blocks unless you opt in. Narrowing the false-alarm rate until a detector can earn the gate is the active work.

## No single structural detector has cleared the gate bar

A detector becomes gate-eligible only when its measured precision clears a 0.90 Wilson 95% lower bound with a minimum true-positive count behind it. Today every detector is advisory-only; the tier is computed into [`benchmarks/real-corpus/promotions.json`](../benchmarks/real-corpus/promotions.json) and CI fails if it drifts (`npm run promotions:check`).

A second tier applies the same 0.90 bar to the subset of a detector's findings that the opt-in execution-grounded layer backs (a surviving mutant, a coverage gap, or a still-failing repro). A detector that is noisy standalone can clear this corroborated tier, which is the concrete path to the first structural gate.

## What blocks today

`swarm audit --mode gate` blocks a PR only on a self-certifying runtime proof whose per-instance controls are all green. Three triggers qualify:

- `test-tamper-proven`: the PR's test hunks reverted in the sandbox, the restored test fails twice on the PR's source and passes on the base checkout.
- `claim-falsified`: the linked issue's repro still fails on the patched checkout.
- `obligation-failure`: a declared contract obligation fails on the patched workspace.

No structural detector blocks (every detector is `advisory-only` in `promotions.json`). A `--diff-file` or `--diff-stdin` audit cannot block because the proofs are execution-grounded and need the workspace a `--pr` audit provisions. The gate behavior is pinned by `test/audit/gate/gate-decision.test.ts`, `test/audit/gate/self-certifying.test.ts`, and `test/audit/gate/test-tamper-proven.test.ts`.

The first self-certifying block fired on a dogfood PR in June 2026: [PR #61](https://github.com/moonrunnerkc/swarm-orchestrator/pull/61) deleted a real guarding assertion, the gate fired, and pasting the reproduce command from the comment into a fresh clone restores the assertion and causes the test to fail with `15 !== 10`. Full write-up in [`benchmarks/real-corpus/BLOCK-REPORT.md`](../benchmarks/real-corpus/BLOCK-REPORT.md).

A circumstantial trigger (`corroborated-under-constraint`) is calibrated but held: it fired four times on the corpus, each on a reverted or hotfixed PR, giving Wilson 95% lower 0.510, still below the 0.90 bar. Block eligibility is tracked in [`benchmarks/real-corpus/block-eligibility.json`](../benchmarks/real-corpus/block-eligibility.json) and pinned by CI via `npm run block-policy:check`.

## The real-corpus baseline is AI-labeled

Against the 205-PR model-labeled baseline the structural detectors score low (F1 0.140, [`benchmarks/real-corpus/scores/latest.json`](../benchmarks/real-corpus/scores/latest.json)), and every label carries a "pending human review" stamp. Closing that gap with human labels is the next milestone. The adjudication loop is built and tested in [`scripts/labeling/adjudicate.ts`](../scripts/labeling/adjudicate.ts): it queues the arbiter-split findings (where two model families disagree), records human verdicts, and promotes them to the scored baseline only once pairwise Cohen's kappa clears 0.60. See [`docs/labeling-methodology.md`](labeling-methodology.md).

## Hunk-grouped chunking improves structure but not yet headlines

Hunk-grouped chunking and per-hunk localization are infrastructure, not shipped recall wins. Their mechanism tests pass, but on the current judge the tail-defect and per-hunk recall numbers stay low. A localized confirm prompt lifts tail-defect recovery to 0.5 in measurement, but it is not shipped pending real-PR false-positive validation. Numbers are reported honestly in [`benchmarks/oracle-corpus/tail-defect-recovery.md`](../benchmarks/oracle-corpus/tail-defect-recovery.md) and [`benchmarks/oracle-corpus/per-hunk-localization.md`](../benchmarks/oracle-corpus/per-hunk-localization.md).

## It is a cheat signal, not a bug finder

It does not catch logic bugs that leave no cheat-shaped tell. Use it to answer "did the agent cut a corner?" and "can I prove this patch met its contract?", not "is this code correct?"
