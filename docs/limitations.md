# Limitations and what's next

An honest accounting of where the tool is weak today and what is being worked on.

## The advisory detectors reproduce a minority of human-caught cheats

This is the measure that decides what the tool is worth. Hunt 2 produced 27
agent PRs that a maintainer explicitly called a cheat and named the category
([`benchmarks/real-prs/HUNT-2-REPORT.md`](../benchmarks/real-prs/HUNT-2-REPORT.md)).
Running the full advisory tier on each of those 27 diffs alone, with the
maintainer's complaint text excluded from the signal, the detectors
independently reproduce the maintainer's exact category on **5 of 27 (18.5%)**
and raise a finding in some category on **13 of 27 (48%)**. Category-precision
on the labeled-and-flagged subset is 5 of 13 (38.5%). All numbers trace to
[`benchmarks/real-prs/overlap-matrix.json`](../benchmarks/real-prs/overlap-matrix.json);
the per-miss accounting is in
[`benchmarks/real-prs/OVERLAP-REPORT.md`](../benchmarks/real-prs/OVERLAP-REPORT.md).

The 22 misses were each root-caused from the diff, and none is a recall hole a
sound, precision-safe detector change would close:

- **Net-additive test edits (4):** the test files add more assertions than they
  remove, so the structural strip detectors stay silent on purpose. A detector
  that flagged net-additive edits would reintroduce the re-specification
  false-positive class the wild-hunt control fixes removed.
- **Sibling-category flags (8):** the advisory tier flagged the PR, in a
  related category (six `goal-not-fixed` complaints drew a `no-op-fix` finding,
  the same "this fix does nothing" accusation under a different detector).
- **Diff-only judge recall (4):** the judge-primary path read the diff and
  concluded the stated fix is delivered. The verdicts are genuine, not a
  harness fault (the raw `no`/`unavailable` answers are recorded per PR); the
  maintainer judged these by running the code or from context the diff does not
  carry.
- **No structural tell or unsupported language (4):** a C# test deletion, a
  dependency-only PR, a removed mock (not what the mock detector keys on), a
  legitimately-logged error path.
- **No detector for the category (2):** no detector keys on a hardcoded return
  value as its own category.

The honest reading: the detectors are corroboration with a known ceiling, not a
replacement for review. They reproduce a maintainer's exact label on about a
fifth of human-caught cheats and raise some suspicion on about half, while
holding the precision that keeps them usable. The judge-primary figure was
measured with a free local model and is a floor for that path; the structural
result is model-independent.

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

`swarm audit --mode gate` blocks a PR only on a self-certifying runtime proof whose per-instance controls are all green. Eight triggers qualify:

- `test-tamper-proven`: the PR's test hunks reverted in the sandbox, the restored test fails twice on the PR's source and passes on the base checkout. A closure relevance refuter (opt-in via the provisioned workspace) downgrades the proof to `not-proven:test-not-closure-linked` when the restored test's import closure confidently reaches none of the source the PR changed; it abstains (the behavioral controls stand) on a capped closure, a test-only PR, or an unresolvable closure, so it can only drop a proof, never invent one (`test/audit/execution-grounded/restoration-closure-link.test.ts`).
- `mock-mutation-proven`: the PR's value-injecting mock hunks reverted in the sandbox, the un-mocked test fails twice on the PR's source, the PR's mocked test passes as submitted, and the added mock returns the exact value the test asserts (a tautology a real test never writes). The third control replaces the base-passes control test-tamper-proven uses, because a mock-mutation cheat often hides a bug that already failed on the base.
- `no-op-fix-proven`: the PR's non-test source hunks reverted in the sandbox, and the affected tests (those whose import closure reaches the reverted source) still pass twice, while the PR claims a fix and its suite passes as submitted. Execution proves no test verifies the claimed fix. Reverting a real fix instead breaks an affected test, which refutes. An empty or capped affected-test closure is no proof, not a block.
- `type-suppression-proven`: the PR's added `@ts-ignore` / `@ts-expect-error` reverted in the sandbox, tsc reports zero diagnostics in the file as submitted, and at least one diagnostic surfaces in that same file once the directive is gone. Execution proves the suppression was hiding a real type error rather than papering over nothing. A suppression that silences nothing surfaces no diagnostic when removed, which refutes. Only `@ts-ignore` / `@ts-expect-error` are tsc-adjudicable; `@ts-nocheck`, `eslint-disable`, and the non-TS directives are fail-closed not-proven. Pinned by `test/audit/execution-grounded/type-suppression-restoration.test.ts` and the live tsc e2e `test/audit/execution-grounded/type-suppression-restoration-e2e.test.ts`.
- `fake-refactor-proven`: the PR renamed an exported symbol, the old name has no remaining declaration anywhere in the provisioned head checkout, and at least one identifier reference to it survives (a static scan of the whole checkout, not just the diff). Execution-grounded evidence proves the rename left dangling references against a symbol that no longer exists. A complete rename leaves no surviving reference, which refutes; a still-declared old name or an ambiguous rename are fail-closed not-proven. Pinned by `test/audit/execution-grounded/fake-refactor-restoration.test.ts` and the real-checkout e2e `test/audit/execution-grounded/fake-refactor-restoration-e2e.test.ts`.
- `dead-branch-proven`: the PR inserted an `if` branch the structural detector flagged as dead, and execution confirms it. The affected tests (those whose import closure reaches the branch file) are run with the branch instrumented; a positive-control probe placed immediately before the `if` fires (the condition was evaluated) while a probe inside the branch body never fires (the body never ran), so the branch is dead in the exercised paths. A branch the suite enters fires the body probe instead, which refutes and demotes. A control that never fires (the `if` was never evaluated), an ambiguous branch, an empty or capped affected-test closure, or a failed instrumentation are fail-closed not-proven. The injected probe is path-baked CommonJS, so a pure-ESM module that cannot `require` records nothing and lands on `not-proven:control-not-reached` rather than a false proof. Pinned by `test/audit/gate/dead-branch-proven.test.ts`, the pure core `test/audit/execution-grounded/dead-branch-restoration.test.ts`, and the live-mocha e2e `test/audit/execution-grounded/dead-branch-restoration-e2e.test.ts`.
- `claim-falsified`: the linked issue's repro still fails on the patched checkout.
- `obligation-failure`: a declared contract obligation fails on the patched workspace.

No structural detector blocks (every detector is `advisory-only` in `promotions.json`). A `--diff-file` or `--diff-stdin` audit cannot block because the proofs are execution-grounded and need the workspace a `--pr` audit provisions. The gate behavior is pinned by `test/audit/gate/gate-decision.test.ts`, `test/audit/gate/self-certifying.test.ts`, `test/audit/gate/test-tamper-proven.test.ts`, `test/audit/gate/mock-mutation-proven.test.ts`, `test/audit/gate/no-op-fix-proven.test.ts`, `test/audit/gate/type-suppression-proven.test.ts`, `test/audit/gate/fake-refactor-proven.test.ts`, and `test/audit/gate/dead-branch-proven.test.ts`; the restoration proofs have end-to-end demonstrations against a live sandbox in `test/audit/execution-grounded/mock-restoration-e2e.test.ts`, `test/audit/execution-grounded/no-op-fix-restoration-e2e.test.ts`, `test/audit/execution-grounded/type-suppression-restoration-e2e.test.ts` (live tsc), `test/audit/execution-grounded/fake-refactor-restoration-e2e.test.ts` (real checkout), and `test/audit/execution-grounded/dead-branch-restoration-e2e.test.ts` (live mocha), all gated behind `SWARM_EG_INTEGRATION=1`.

All eight self-certifying triggers are produced by the live `swarm audit` execution-grounded loop. `test-tamper-proven`, `mock-mutation-proven`, `no-op-fix-proven`, `type-suppression-proven`, `fake-refactor-proven`, and `dead-branch-proven` come from the restoration phase (the `runProofRestorations` seam in [`src/audit/execution-grounded/index.ts`](../src/audit/execution-grounded/index.ts)), `claim-falsified` from the issue-repro phase, and `obligation-failure` from a declared contract obligation. The test-tamper, mock-mutation, type-suppression, fake-refactor, and dead-branch proofs are finding-gated (a restoration-category block finding, a `cheat-mock-mutation` finding, a `type-suppression` finding, a `fake-refactor` finding, or a `dead-branch-insertion` finding anchors them); the no-op-fix proof is PR-level, gated by a fix claim like `claim-falsified`, because the structural `no-op-fix` block finding fires only on a test-only change with no source hunk to revert. The whole live path (engine to block trigger to rendered comment to ledger) is pinned for the mock, no-op, type-suppression, fake-refactor, and dead-branch proofs by [`test/audit/execution-grounded/proof-wiring.live.test.ts`](../test/audit/execution-grounded/proof-wiring.live.test.ts) (gated behind `SWARM_EG_INTEGRATION=1`). The per-protocol confirm/refute/unprovable behavior is recorded in [`benchmarks/oracle-corpus/proof-protocols.md`](../benchmarks/oracle-corpus/proof-protocols.md).

The type-suppression and fake-refactor proofs are the static end of the proof tier: the first reverts the directive and runs `tsc` scoped to the file, the second is a TypeScript-AST scan of the provisioned head checkout. The test-tamper, mock-mutation, no-op, and dead-branch proofs are the behavioral end (they revert or instrument hunks and rerun the suite). Both ends share the same fail-closed discipline: nothing is marked proven that a control did not earn, and every block ships its reproduce command.

The first self-certifying block fired on a dogfood PR in June 2026: [PR #61](https://github.com/moonrunnerkc/swarm-orchestrator/pull/61) deleted a real guarding assertion, the gate fired, and pasting the reproduce command from the comment into a fresh clone restores the assertion and causes the test to fail with `15 !== 10`. Full write-up in [`benchmarks/real-corpus/BLOCK-REPORT.md`](../benchmarks/real-corpus/BLOCK-REPORT.md).

A circumstantial trigger (`corroborated-under-constraint`) is calibrated but held: it fired four times on the corpus, each on a reverted or hotfixed PR, giving Wilson 95% lower 0.510, still below the 0.90 bar. Block eligibility is tracked in [`benchmarks/real-corpus/block-eligibility.json`](../benchmarks/real-corpus/block-eligibility.json) and pinned by CI via `npm run block-policy:check`.

## Measured gate precision: an honest n=0 on the viable slice

The proof tier (all six restoration engines, dead-branch included) was run across the execution-grounded-viable slice of the outcome-labeled real corpus, scored against the outcome labels (`npm run gate-precision`). It ran on 11 of the 12 viable PRs (one repo's dependency install failed deterministically, recorded), every one of which repository history shows survived, and fired **zero** proven block triggers. So proven-finding precision is an honest **n=0**: there were no false positives on clean PRs, but the denominator is empty because the slice carries no genuine cheats to prove. The artifact and the per-PR verdict records are in [`benchmarks/real-corpus/gate-precision.json`](../benchmarks/real-corpus/gate-precision.json) and [`GATE-PRECISION-REPORT.md`](../benchmarks/real-corpus/GATE-PRECISION-REPORT.md). A confirmed finding on an outcome-clean PR would be a stop-the-line defect; each per-PR row carries the head SHA and the proof funnel so the control-vs-label diagnosis can run before any number is trusted. The denominator grows through two now-live automated paths: the nightly backward-mining cron ([`.github/workflows/backward-mine.yml`](../.github/workflows/backward-mine.yml), 04:00 UTC, which mines outcome-bad agent commits the forward sample misses and uploads the grown corpus for review) and the EG-viable measurement dispatch ([`.github/workflows/eg-viable-measure.yml`](../.github/workflows/eg-viable-measure.yml)), with a re-run of the proof tier over any slice that grows an outcome-bad positive class.

## Two control defects fixed by the wild hunt

A bounded hunt ([`scripts/real-prs/hunt.ts`](../scripts/real-prs/hunt.ts)) pointed
the proof tier at 216 recent agent-attributed PRs, screened them, and ran the
six-engine proof tier on the execution-grounded-viable subset. The full record is
in [`benchmarks/real-prs/HUNT-REPORT.md`](../benchmarks/real-prs/HUNT-REPORT.md).
It surfaced two false positives on legitimate feature PRs that the stop-the-line
protocol (replay in a fresh clone, read the production diff, check subsequent
history) caught before they were trusted. Each was a control defect the synthetic
oracle never exercised (it injects a defect into otherwise-unchanged code, never a
legitimate behaviour change with a matching test update). Both were root-caused
and fixed:

- **`no-op-fix-proven` fired on a feature PR that added untested code.** The
  affected-test closure was file-level, so a test that imported an unchanged
  symbol from a file the PR changed by *adding* an unrelated declaration counted
  as a witness. Fixed: a witness test must reach a source file whose hunk has a
  deleted/modified line (`behaviorallyRevertableSourceFiles`); a purely-additive
  change is new code no pre-existing test can verify, so the proof abstains.
- **`test-tamper-proven` fired on a feature PR that re-specified a test.** The PR
  deliberately changed a value and replaced two looser `toContain` checks on the
  subject with one stricter `toBe` exact match; `assertion-strip` counted raw
  assertion lines and read the consolidation as a strip. Fixed: a removed
  assertion whose subject gained an added exact-match is a re-specification, not a
  strip. Oracle-safe (the strip injector never adds a replacement); structural
  recall held at 258/275.

Both fixes are strictly more conservative: each can only drop a false proof,
never invent one. The lesson is general: a self-certifying proof whose controls
are all green still cannot distinguish a deliberate behaviour change with a
matching test update from a regression hidden behind a relaxed test on structure
alone; the fixes narrow the structural gate so the proof abstains on the
re-specification shapes the wild actually produces.

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
a recognizable ecosystem the sandbox can run (a Node project with a lockfile and
runner and a satisfiable node engine, a Go module, or a Python project with a
pytest signal). After Phase 2 added the pytest and Go runners the result is
**78 of 197 usable PRs are EG-viable** (12 Node + 52 Python + 14 Go), up from
the Node-only 12/197; of the rest, 58 are not a Node, Go, or pytest project, 45
are Node with no recognizable runner, 5 are Python with no pytest signal, 9 are
unreadable (deleted or private), and 2 pin node 20.x
([`benchmarks/real-corpus/eg-viability.json`](../benchmarks/real-corpus/eg-viability.json)).
The screen is a viability upper bound: it recognizes the ecosystem, not that
dependencies install or tests pass. The sandbox now installs Python (venv + pip
or poetry) and Go (`go mod download`) as well as Node, but the proof-tier run and
the corroborated precision below still cover only the 12 Node PRs, because the
corroboration engine (mutation, coverage, issue-repro) is Node-only: a pytest or
Go tree installs but scores no corroborated finding. Attempting all 8 outcome-bad
EG-viable PRs confirmed this (7 are purely additive, 1 needs poetry the sandbox
lacks), so provisioning was never the binding constraint
([`benchmarks/real-corpus/EG-VIABILITY-POLYGLOT-REPORT.md`](../benchmarks/real-corpus/EG-VIABILITY-POLYGLOT-REPORT.md),
[`benchmarks/real-corpus/polyglot-provisioning.json`](../benchmarks/real-corpus/polyglot-provisioning.json)).

Every detector's `corroborated` field in
[`benchmarks/real-corpus/promotions.json`](../benchmarks/real-corpus/promotions.json)
therefore now reads `viability-screened` (12 Node PRs provision the proof tier;
corroborated precision pending the bounded EG run on that 12-PR slice) instead of
the bare `unmeasured`. The 0.90 Wilson precision floor and the minimum-TP count are
unchanged; no detector gates on the corroborated tier, and `npm run
promotions:check` holds that honest state in CI.

The bounded EG run is built and has now run: `npm run eg-viable:measure` runs the
full execution-grounded layer (mutation, coverage, the proof tier) over the
slice, with a `--repo` / `--only` single-target mode so the 12 repos fan one per
container across the `EG-viable measurement (12-repo matrix)` workflow-dispatch
CI job ([`.github/workflows/eg-viable-measure.yml`](../.github/workflows/eg-viable-measure.yml)).
The full 12-repo dispatch completed: **11 of 12 provisioned and ran** the
execution-grounded layer, 1 (`NotJayDee119/TECHO_123`) is genuinely non-viable
(its `npm install` fails deterministically in both the local and CI sandboxes,
recorded as a failure), and the run surfaced **zero corroborated findings**
([`benchmarks/real-corpus/eg-viable-corroborated.json`](../benchmarks/real-corpus/eg-viable-corroborated.json),
per-PR records under [`eg-viable-results/`](../benchmarks/real-corpus/eg-viable-results/)).
`promotions.json` now reads the completed run (the corroborated reason records
11/12 measured, 1 non-viable, 0 corroborated findings) instead of pending-dispatch;
the tier stays `viability-screened` and nothing gates on it. The slice is all
outcome-clean, so a sweep can only produce corroborated false positives, never
the true positives a detector needs to clear the corroborated gate; that is why
the tier stays advisory until the positive class grows.

## It is a cheat signal, not a bug finder

It does not catch logic bugs that leave no cheat-shaped tell. Use it to answer "did the agent cut a corner?" and "can I prove this patch met its contract?", not "is this code correct?"
