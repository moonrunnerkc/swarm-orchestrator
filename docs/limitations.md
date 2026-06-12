# Limitations and what's next

An honest accounting of where the tool is weak today and what is being worked on.

## It over-flags PRs that survive in production

Against outcome-grounded labels (PRs that were never reverted or hotfixed), the
structural detectors still fire on legitimate patterns: relocated tests,
refactors that change assertion shape, pragmatic suppressions, and (under
diff-only scoring without the repo) mocks of real dependencies and "no test
imports this" on projects that have no test suite. PR-level union precision is
0.217 (18 of 23 firing PRs survived). That's why `--mode advise` is the default
and nothing blocks unless you opt in. The deterministic refuters in
[`verify-findings.ts`](../src/audit/cheat-detector/verify-findings.ts) cut the
recurring, repo-context-free classes (a bare empty catch in a file the PR
creates; a mock of a `@/` path alias) without costing oracle recall; the
remaining classes are documented as diff-only-scoring artifacts that a real
`swarm audit --pr` (which provisions the repo) does not hit.

## No single structural detector has cleared the gate bar

A detector becomes gate-eligible only when its measured precision clears a 0.90
Wilson 95% lower bound with a minimum true-positive count behind it. Against
outcome labels every detector is advisory-only (the best is error-swallow at
PR-level precision 0.40, 2 TP / 3 FP, far under the bar); the tier is computed
into [`benchmarks/real-corpus/promotions.json`](../benchmarks/real-corpus/promotions.json)
and CI fails if it drifts (`npm run promotions:check`).

A second tier applies the same 0.90 bar to the subset of a detector's findings that the opt-in execution-grounded layer backs (a surviving mutant, a coverage gap, or a still-failing repro). A detector that is noisy standalone can clear this corroborated tier, which is the concrete path to the first structural gate.

## What blocks today

`swarm audit --mode gate` blocks a PR only on a self-certifying runtime proof whose per-instance controls are all green. Five triggers qualify:

- `test-tamper-proven`: the PR's test hunks reverted in the sandbox, the restored test fails twice on the PR's source and passes on the base checkout. A closure relevance refuter (opt-in via the provisioned workspace) downgrades the proof to `not-proven:test-not-closure-linked` when the restored test's import closure confidently reaches none of the source the PR changed; it abstains (the behavioral controls stand) on a capped closure, a test-only PR, or an unresolvable closure, so it can only drop a proof, never invent one (`test/audit/execution-grounded/restoration-closure-link.test.ts`).
- `mock-mutation-proven`: the PR's value-injecting mock hunks reverted in the sandbox, the un-mocked test fails twice on the PR's source, the PR's mocked test passes as submitted, and the added mock returns the exact value the test asserts (a tautology a real test never writes). The third control replaces the base-passes control test-tamper-proven uses, because a mock-mutation cheat often hides a bug that already failed on the base.
- `no-op-fix-proven`: the PR's non-test source hunks reverted in the sandbox, and the affected tests (those whose import closure reaches the reverted source) still pass twice, while the PR claims a fix and its suite passes as submitted. Execution proves no test verifies the claimed fix. Reverting a real fix instead breaks an affected test, which refutes. An empty or capped affected-test closure is no proof, not a block.
- `claim-falsified`: the linked issue's repro still fails on the patched checkout.
- `obligation-failure`: a declared contract obligation fails on the patched workspace.

No structural detector blocks (every detector is `advisory-only` in `promotions.json`). A `--diff-file` or `--diff-stdin` audit cannot block because the proofs are execution-grounded and need the workspace a `--pr` audit provisions. The gate behavior is pinned by `test/audit/gate/gate-decision.test.ts`, `test/audit/gate/self-certifying.test.ts`, `test/audit/gate/test-tamper-proven.test.ts`, `test/audit/gate/mock-mutation-proven.test.ts`, and `test/audit/gate/no-op-fix-proven.test.ts`; the mock-mutation and no-op-fix proofs have end-to-end demonstrations against a live vitest sandbox in `test/audit/execution-grounded/mock-restoration-e2e.test.ts` and `test/audit/execution-grounded/no-op-fix-restoration-e2e.test.ts` (both gated behind `SWARM_EG_INTEGRATION=1`).

Wiring honesty: `test-tamper-proven`, `claim-falsified`, and `obligation-failure` are produced by the live `swarm audit` execution-grounded loop. `mock-mutation-proven` and `no-op-fix-proven` are proof-capable and gate-eligible (engine, gate, ledger, report, and a live-sandbox e2e all committed), but the live audit loop does not yet invoke their engines; each is exercised end-to-end by its `SWARM_EG_INTEGRATION=1` test. The per-protocol confirm/refute/unprovable behavior is recorded in [`benchmarks/oracle-corpus/proof-protocols.md`](../benchmarks/oracle-corpus/proof-protocols.md).

The first self-certifying block fired on a dogfood PR in June 2026: [PR #61](https://github.com/moonrunnerkc/swarm-orchestrator/pull/61) deleted a real guarding assertion, the gate fired, and pasting the reproduce command from the comment into a fresh clone restores the assertion and causes the test to fail with `15 !== 10`. Full write-up in [`benchmarks/real-corpus/BLOCK-REPORT.md`](../benchmarks/real-corpus/BLOCK-REPORT.md).

A circumstantial trigger (`corroborated-under-constraint`) is calibrated but held: it fired four times on the corpus, each on a reverted or hotfixed PR, giving Wilson 95% lower 0.510, still below the 0.90 bar. Block eligibility is tracked in [`benchmarks/real-corpus/block-eligibility.json`](../benchmarks/real-corpus/block-eligibility.json) and pinned by CI via `npm run block-policy:check`.

## Ground truth is repository outcomes, not model opinion

The real-corpus baseline used to be AI-labeled: a model judged each PR and every
label carried a "pending human review" stamp. That baseline is retired. Ground
truth now comes from repository history alone, derived by
[`scripts/labeling/outcome-labels.ts`](../scripts/labeling/outcome-labels.ts)
(`npm run labeling:outcome`): for every corpus entry we ask git/GitHub whether
the landed change was later **reverted** (a `This reverts commit <sha>`), or
**hotfixed** (a surgical, fix-shaped follow-up within 30 days re-touching the
same source lines), or **survived**. Every non-survived label carries its
evidence (the reverting/hotfixing commit sha and the overlapping line ranges) so
it is auditable with `git log` alone. The corpus is commit-grounded: the anchor
is the vendored commit sha, because the entries are agent-attributed commits
whose PR numbers do not resolve to merged upstream PRs.

Of the 205 entries, 197 are usable (8 are indeterminate: the commit 404'd). The
outcome distribution is **0 reverted, 22 hotfixed, 175 survived**, a true bad
base rate of 11.2%. Scored against these outcome labels, the structural
detectors' PR-level union is **precision 0.217, recall 0.227, F1 0.222**
([`benchmarks/real-corpus/scores-outcome/latest.json`](../benchmarks/real-corpus/scores-outcome/latest.json),
with Wilson 95% bounds), versus the retired AI-labeled F1 0.140
([`scores/ai-labeled-baseline.json`](../benchmarks/real-corpus/scores/ai-labeled-baseline.json)).
F1 is slightly higher under outcome grounding because some firings the AI labels
counted as false positives land on PRs that history proves bad.

The AI labels and the outcomes are essentially uncorrelated (Cohen's kappa ~0.00;
of the 22 outcome-bad PRs, exactly one was also AI-labeled broken). That is the
whole point: model-opinion labels were not tracking what happened to the code.
Human adjudication is no longer the path forward; outcomes are. The agreement
arithmetic is in [`outcome-labels.json`](../benchmarks/real-corpus/outcome-labels.json)
and the methodology in [`docs/labeling-methodology.md`](labeling-methodology.md).

A second, agent-attributed corpus is mined the same way
([`npm run agent-incidence:confirmed-bad`](../scripts/real-prs/mine-confirmed-bad.ts)):
a bounded mine of 60 merged agent PRs yields 5 outcome-confirmed-bad (8.3%,
consistent with the 11.2% above). Reaching a 50-PR positive class needs roughly
600 mined agent PRs; that ceiling is recorded, not padded, in
[`agent-corpus/confirmed-bad.json`](../benchmarks/real-prs/agent-corpus/confirmed-bad.json).

## Mock-mutation focusing is a shipped recall win; tail-defect chunking is not yet

Focusing the judge on the hunks that add a value-injecting mock is a shipped recall win for the behavioral category: cheat-mock-mutation judge-primary recall went from 0.16 (the prior rapid-mlx glm47 run) to 0.96 (24/25) on the local qwen3.6 judge, and the clean-PR judge-primary false-positive rate fell from 10% to 0% on the seeded 30-PR sample, because the cheat-mock-mutation judge is now invoked only when an added mock actually exists. The mechanism and the A/B are in [`benchmarks/results/AB-REPORT.md`](../benchmarks/results/AB-REPORT.md) and [`benchmarks/oracle-corpus/judge-primary-vs-structural.md`](../benchmarks/oracle-corpus/judge-primary-vs-structural.md).

Hunk-grouped chunking and per-hunk localization, by contrast, remain infrastructure rather than shipped recall wins. Their mechanism tests pass, but on the current judge the tail-defect and per-hunk recall numbers stay low. A localized confirm prompt lifts tail-defect recovery to 0.5 in measurement, but it is not shipped pending real-PR false-positive validation. Numbers are reported honestly in [`benchmarks/oracle-corpus/tail-defect-recovery.md`](../benchmarks/oracle-corpus/tail-defect-recovery.md) and [`benchmarks/oracle-corpus/per-hunk-localization.md`](../benchmarks/oracle-corpus/per-hunk-localization.md).

## The corroborated promotion tier is viability-screened, not yet run

A detector whose runtime-corroborated findings clear the gate bar would earn the
first structural block. Scoring that tier needs the execution-grounded layer run
across the corpus, but the corpus is arbitrary AI-demo repositories, most of
which cannot provision in a generic sandbox. Rather than leave the tier an opaque
`unmeasured`, a cheap static viability screen
([`npm run execution-grounded:viability-screen`](../scripts/real-prs/eg-viability-screen.ts))
now measures exactly how much of the corpus could even run: per PR it checks for
a Node project, a lockfile, a recognizable test runner, and a satisfiable node
engine. The result is **12 of 197 usable PRs are EG-viable**; 137 are not Node
projects at all, 41 have no recognizable test runner, 2 pin node 20.x
([`benchmarks/real-corpus/eg-viability.json`](../benchmarks/real-corpus/eg-viability.json)).

Every detector's `corroborated` field in
[`benchmarks/real-corpus/promotions.json`](../benchmarks/real-corpus/promotions.json)
therefore now reads `viability-screened` (12/197 provision; corroborated
precision pending the bounded EG run on that 12-PR slice) instead of the bare
`unmeasured`. The 0.90 Wilson precision floor and the minimum-TP count are
unchanged; no detector gates on the corroborated tier, and `npm run
promotions:check` holds that honest state in CI. The EG mutation run on the
12-viable slice is the next bounded step.

## It is a cheat signal, not a bug finder

It does not catch logic bugs that leave no cheat-shaped tell. Use it to answer "did the agent cut a corner?" and "can I prove this patch met its contract?", not "is this code correct?"
