# Verifiable-evidence block report

Whether `swarm audit --mode gate` can confidently block a PR, measured against
what production actually did. Regenerate with `npm run block-eligibility:full`;
the numbers below come from `trigger-calibration.json` and `block-eligibility.json`
in this directory.

## Why this exists

Structural detectors cannot earn a block here. Scored against the AI-labeled
real corpus their precision is 0 (`promotions.json`: every detector
`advisory-only`, `gateEligibleDetectors: []`), and human labeling is out of
scope, so detector-versus-label precision stays pinned at 0. The block decision
therefore does not come from a detector's opinion. It comes from runtime facts:
a per-instance proof carried by the firing (self-certifying), or a structural
finding whose precision is calibrated against a label-free ground truth, whether
the PR was reverted or hotfixed afterward (circumstantial).

## The triggers

Four verifiable-evidence triggers in two tiers. The tier decides how a trigger
earns the right to gate.

Self-certifying (each carries its own per-instance proof and gates on a firing
whose controls are all green, independent of the statistical bar):

- `test-tamper-proven`: with the PR's test hunks reverted in the sandbox, the
  restored test fails twice with the same identity on the PR's source and passes
  on the base checkout, the tampered suite green. The differential restoration
  proof, [`benchmarks/results/RESTORATION-REPORT.md`](../results/RESTORATION-REPORT.md).
- `claim-falsified`: the PR claims a fix and the linked issue's repro still
  fails against the patched checkout.
- `obligation-failure`: a declared build/test/property/falsifier obligation
  fails on the patched workspace.

Circumstantial (no per-instance proof; earns the gate only through calibrated
precision):

- `corroborated-under-constraint`: a structural finding (coverage-erosion,
  assertion-strip, test-relaxation, fake-refactor) lands on a changed line where
  a mutant survived or no test runs. The conjunction, not either half.

## Method

Firings are replayed from the committed corpus facts (the execution-grounded
results, the restoration proofs, and the structural audit findings already on
disk), not from a fresh sandbox run, so the calibration regenerates
deterministically. Ground truth is the regression corpus's revert/hotfix proofs.

- Positives: 72 merged PRs proven bad by a later revert (7) or fix-PR (65). Each
  is `revertedOrHotfixed = true`.
- Negatives: 232 merged clean PRs with no such proof.
- A trigger that needs an execution-grounded run can only fire on the PRs that
  have one: 70 of the 72 reverted/hotfixed PRs and 22 of the 232 clean PRs
  (the v11.2 sweep raised reverted-side coverage from 23 to 62, and the
  follow-up tldraw sweep to 70; the 2 still without runs are
  withastro/astro's red-repo skips, whose node:test suite no Stryker
  runner adapter can drive).

For each trigger, precision is the share of the PRs it fired on that were
reverted or hotfixed. Eligibility is two-tier. A circumstantial trigger is
eligible only when its Wilson 95% lower bound is at least 0.90 with at least 5
confirmed reverted true positives, the same precision discipline the detector
gate uses; the bound, not the point precision, is the bar. A self-certifying
trigger is eligible by tier: it does not need the statistical bar, because it
gates only on a firing whose per-instance controls are all green at audit time
(for `test-tamper-proven`, the three restoration controls; for `claim-falsified`
and `obligation-failure`, the double-run controls). Both tiers are computed into
`block-eligibility.json` and held by CI (`npm run block-policy:check`, which
refuses a circumstantial threshold tuned below the floor and refuses a
self-certifying firing record whose controls are not all green).

## Results

| Trigger | Tier | Firings | Confirmed reverted TP | False positives | Precision | Wilson 95% lower | Block-eligible |
|---|---|---|---|---|---|---|---|
| `test-tamper-proven` | self-certifying | 0 | 0 | 0 | n/a | n/a | by tier |
| `claim-falsified` | self-certifying | 0 | 0 | 0 | n/a | n/a | by tier |
| `obligation-failure` | self-certifying | 0 | 0 | 0 | n/a | n/a | by tier |
| `corroborated-under-constraint` | circumstantial | 4 | 4 | 0 | 1.000 | 0.510 | no |

Proof PRs behind the confirmed true positives:

- `corroborated-under-constraint`: `expo/expo#35036`, `expo/expo#38074`,
  `expo/expo#39603`, `tldraw/tldraw#7880` (each reverted/hotfixed).

"Block-eligible by tier" is the calibration verdict, not a runtime block. A
self-certifying trigger gates only on a real firing with all-green controls, and
none of the three has fired on this corpus: `test-tamper-proven` had zero proven
restorations across the executed funnel
([`benchmarks/results/RESTORATION-REPORT.md`](../results/RESTORATION-REPORT.md)),
`claim-falsified` had one issue-linked repro and it was unevaluable, and
`obligation-failure` needs a declared contract the audit surface does not carry.
So `blockEligibleCount` is 3 in `block-eligibility.json`, all by tier, with 0
firings behind them.

## Outcome

The runtime gate now acts on the self-certifying tier. `BLOCK_ELIGIBLE_TRIGGERS`
in `src/audit/gate/gate-decision.ts` is the three self-certifying kinds, and
`decideBlock` gates a self-certifying firing only when its per-instance controls
are all green (`controlsAllGreen` in `src/audit/gate/self-certifying.ts`). A
firing whose controls are missing, false, or unevaluated surfaces in the comment
but never changes the exit code. The circumstantial trigger is still held out:
it has not cleared the Wilson bar.

No self-certifying trigger has fired on this corpus, so `swarm audit --mode gate`
still passes every corpus PR. The runtime path is wired and tested; what is
absent is a firing, not the gate. The three self-certifying firing counts are 0
for the reasons in the table above: `test-tamper-proven` found zero proven
restorations across the executed funnel
([`benchmarks/results/RESTORATION-REPORT.md`](../results/RESTORATION-REPORT.md)),
`claim-falsified` saw one issue-linked repro and it was unevaluable, and
`obligation-failure` needs a declared contract the audit surface does not carry.

`corroborated-under-constraint` has fired four times, every one on a PR that was
in fact reverted or hotfixed, so its point precision stays 1.0. Four confirmed
cases are not enough: the Wilson 95% lower bound is 0.510, below the 0.90 bar,
and 4 is below the 5-true-positive minimum. (With zero false positives the bound
is n/(n+3.84), so the bar realistically demands on the order of 35 consecutive
confirmed firings; the trend is in the right direction and the precision has not
cracked.) The bar was not moved to manufacture a block.

## What blocks today

A self-certifying trigger blocks `swarm audit --mode gate` the moment it fires
with all-green controls. The gate decision is exercised end to end by the
dogfooded PR in the next section. On a `--diff-file` or `--diff-stdin` audit no
trigger can fire (the proofs are execution-grounded and need the workspace a
`--pr` audit provisions), and every structural detector is advisory-only
(`promotions.json`), so a diff-only audit exits 0 by construction.

## Claims

**CLAIM A (calibrated):** `swarm audit --mode gate` blocks a PR only on
self-certifying runtime proof whose per-instance controls are all green. No
structural detector blocks (every detector is `advisory-only` in
[`promotions.json`](./promotions.json)), and no circumstantial trigger blocks
yet (`corroborated-under-constraint` sits at Wilson 95% lower 0.510, below the
0.90 bar, in [`block-eligibility.json`](./block-eligibility.json)). The gate
wiring is in `src/audit/gate/gate-decision.ts` and `self-certifying.ts`, the
controls are defined in `src/audit/execution-grounded/test-restoration.ts`, and
the behavior is pinned by the gate tests (`test/audit/gate/gate-decision.test.ts`,
`test/audit/gate/self-certifying.test.ts`, `test/audit/gate/test-tamper-proven.test.ts`).

**CLAIM B (dogfooded):** see "First blocked PR" below.

## First blocked PR

On 2026-06-12 the gate blocked a dogfood PR that weakened a real test. The PR
deletes the assertion `clamp(15, 0, 10) === 10` in `dogfood/clamp.test.js` and
changes `dogfood/clamp.js` so the upper bound is no longer capped. The
execution-grounded layer reverted only the test hunk in the sandbox, found the
restored assertion failed twice against the PR's source and passed on the base
checkout with the tampered suite green, raised a `test-tamper-proven` proof, and
`swarm audit --mode gate` exited 1.

- PR: https://github.com/moonrunnerkc/swarm-orchestrator/pull/61
- Failed check run: https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/27385900587/job/80932730889
- Proof comment: https://github.com/moonrunnerkc/swarm-orchestrator/pull/61#issuecomment-4686206549

The proof comment carries a self-contained reproduce command (the restore patch
is embedded in a heredoc). Pasted into a fresh clone with the test runner
installed, it restores the assertion and the test fails with
`AssertionError: 15 !== 10`, the regression the deleted assertion was guarding.
The PR was closed unmerged.
