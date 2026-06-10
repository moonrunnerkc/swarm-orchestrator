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
therefore does not come from a detector's opinion. It comes from self-certifying
runtime facts, calibrated against a label-free ground truth: whether the PR was
reverted or hotfixed afterward.

## The triggers

Three verifiable-evidence triggers, each self-certifying and replayable:

- `claim-falsified`: the PR claims a fix and the linked issue's repro still
  fails against the patched checkout.
- `corroborated-under-constraint`: a structural finding (coverage-erosion,
  assertion-strip, test-relaxation, fake-refactor) lands on a changed line where
  a mutant survived or no test runs. The conjunction, not either half.
- `obligation-failure`: a declared build/test/property/falsifier obligation
  fails on the patched workspace.

## Method

Firings are replayed from the committed corpus facts (the execution-grounded
results and structural audit findings already on disk), not from a fresh
sandbox run, so the calibration regenerates deterministically. Ground truth is
the regression corpus's revert/hotfix proofs.

- Positives: 72 merged PRs proven bad by a later revert (7) or fix-PR (65). Each
  is `revertedOrHotfixed = true`.
- Negatives: 232 merged clean PRs with no such proof.
- A trigger that needs an execution-grounded run can only fire on the PRs that
  have one: 62 of the 72 reverted/hotfixed PRs and 22 of the 232 clean PRs
  (the v11.2 sweep raised reverted-side coverage from 23; the 10 still
  without runs are withastro/astro's red-repo skips, tldraw's remaining
  tail, and unfetchable head SHAs).

For each trigger, precision is the share of the PRs it fired on that were
reverted or hotfixed. A trigger is block-eligible only when its Wilson 95% lower
bound is at least 0.90 with at least 5 confirmed reverted true positives, the
same precision discipline the detector gate uses. The bound, not the point
precision, is the bar.

## Results

| Trigger | Firings | Confirmed reverted TP | False positives | Precision | Wilson 95% lower | Block-eligible |
|---|---|---|---|---|---|---|
| `claim-falsified` | 0 | 0 | 0 | n/a | 0.000 | no |
| `corroborated-under-constraint` | 3 | 3 | 0 | 1.000 | 0.438 | no |
| `obligation-failure` | 0 | 0 | 0 | n/a | 0.000 | no |

Proof PRs behind the confirmed true positives:

- `corroborated-under-constraint`: `expo/expo#35036`, `expo/expo#38074`,
  `expo/expo#39603` (each reverted/hotfixed).

## Outcome

No trigger can confidently block yet. `block-eligible` is 0 and `swarm audit
--mode gate` keeps passing every PR that a structural detector did not already
block.

`corroborated-under-constraint` has fired three times, every one on a PR that
was in fact reverted or hotfixed, so its point precision stays 1.0. Three
confirmed cases are not enough: the Wilson 95% lower bound is 0.438, below
the 0.90 bar, and 3 is below the 5-true-positive minimum. (With zero false
positives the bound is n/(n+3.84), so the bar realistically demands on the
order of 35 consecutive confirmed firings; the trend is in the right
direction and the precision has not cracked.) `claim-falsified` never fired because the corpus carries only one
issue-linked repro and it was unevaluable. `obligation-failure` never fired
because the audit surface declares no obligations; it is the orchestrator's
signal, surfaced here for when an audit runs against a declared contract.

The bar was not moved to manufacture a block. The honest state is that the
evidence does not yet support confident blocking. The path to changing it is
more execution-grounded coverage of reverted PRs, not a lower threshold: the
`corroborated-under-constraint` signal is precise where it fired, so more runs
that produce confirmed reverted true positives would raise its Wilson bound. If
it later clears 0.90 with at least 5 confirmed cases, `compute-block-eligibility`
marks it eligible, `BLOCK_ELIGIBLE_TRIGGERS` is bumped in the same commit, and
gate mode begins blocking on it with the evidence attached.
