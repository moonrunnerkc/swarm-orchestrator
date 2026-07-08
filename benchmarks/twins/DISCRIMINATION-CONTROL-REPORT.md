# Discrimination control: twin-measured separation

The discrimination control closes the Hunt 4 `claim-falsified-synthesized` false
positive (`benchmarks/real-prs/hunt4/HUNT-4-REPORT.md`): a witness that fails
identically on base and head for its own setup reasons no longer fires the
finding. The fix is a four-clause conjunction (failure classification, K=3
determinism quorum, failure-identity discrimination, and pass-capability
evidence); the source is `src/audit/execution-grounded/discrimination-control.ts`.

This report measures it on an executable semantic-twin corpus
(`scripts/gate/discrimination-twins.ts`): 16 twins over the two
semantic categories the claim-differential targets (goal-not-fixed,
cheat-mock-mutation), each run through the real base/head execution path (live
node:test, a fixed witness, agreeing arbiters, no model call). Regenerate with
`npm run discrimination-control:measure`.

## The four modes and what a sound control does in each

| mode | setup | expected sound verdict |
| --- | --- | --- |
| honest | base defect, head fixed, no twin | `claim-delivered` (no finding) |
| cheat-twin | base defect, head not fixed, honest twin supplied | `claim-falsified-synthesized` (fires) |
| cheat-production | base defect, head not fixed, NO twin | `abstain:no-pass-capability-evidence` |
| broken-witness | base defect, head not fixed, honest twin, a witness that never passes anywhere | `abstain:no-pass-capability-evidence` |

## Results (n with Wilson-95 bounds)

| measurement | value |
| --- | --- |
| honest-twin false positives (fires on honest PRs) | 0/16 (0%) [0.00, 0.19] |
| cheat recall, twin mode (fires with pass-capability) | 16/16 (100%) [0.81, 1.00] |
| production reach cost (cheats that abstain with no twin) | 16/16 (100%) [0.81, 1.00] |
| broken-witness refusal (the outline pattern, abstains) | 16/16 (100%) [0.81, 1.00] |

Twin-mode separation (recall on cheats minus false-positive rate on honest twins):
**1.00**.

### By category

| category | honest-twin false positives | cheat recall (twin mode) |
| --- | --- | --- |
| cheat-mock-mutation | 0/8 (0%) [0.00, 0.32] | 8/8 (100%) [0.68, 1.00] |
| goal-not-fixed | 0/8 (0%) [0.00, 0.32] | 8/8 (100%) [0.68, 1.00] |

## What the numbers say

- **Zero findings on honest twins.** The control raises no
  `claim-falsified-synthesized` on any honest PR: an honest fix makes the witness
  pass on the head, which is `claim-delivered`, never the finding.
- **Separation exists in twin mode.** With the honest twin supplying
  pass-capability, the control fires on genuine cheats and never on honest twins.
- **The reach cost is the whole production detection.** In production there is no
  honest twin, so the pass-capability clause cannot be satisfied and every cheat
  abstains at `abstain:no-pass-capability-evidence`. The control buys soundness by refusing to
  fire in production, exactly the outline lesson: an identical everywhere-failure
  is indistinguishable from an undelivered claim without evidence the witness can
  pass on a correct implementation.
- **The broken-witness (outline) pattern is refused even with a twin.** A witness
  that cannot pass on the honest twin is not shown capable of passing on a correct
  implementation, so it abstains rather than firing.

## Production semantics (why the finding abstains in production)

Clause 4 requires affirmative evidence the witness can pass on some correct
implementation of the claim. On twins that is direct (the honest twin passes). In
production no reference implementation exists, and the honest design work found no
bounded runtime proxy sound enough to certify pass-capability: a sensitivity probe
that perturbs the asserted expectation shows only that the assertion is live, not
that a correct implementation would satisfy it (the outline witness's assertion was
live and still could never pass); a self-check scaffold that reconstructs a correct
scenario needs the domain knowledge the witness compiler lacked in the first place.
So `claim-falsified-synthesized` stays abstaining in production and advisory
elsewhere, pending a folded measurement that clears the promotions bar. An honest
abstaining trigger beats an unsound firing one. See
`benchmarks/oracle-corpus/proof-protocols.md` for the full conjunction and its
production semantics.

## Disclosed verification: the outline false positive

The control was developed and validated on the synthetic and executable
semi-synthetic twins above only. As the single disclosed verification, the
committed Hunt 4 outline record
(`benchmarks/real-prs/hunt4/records/claude-code-outline-outline-pr12197.json`,
which the pre-discrimination raw table fired as `claim-falsified-synthesized`)
is replayed through the finished control in production mode. It **abstains**,
refused at **clause 4 (pass-capability)**: nothing establishes the outline witness
could pass on a correct implementation, and the outline re-run nondeterminism (1 of
3 runs errored) independently trips clause 1 (setup error). The receipt is
`test/audit/execution-grounded/outline-discrimination-replay.test.js`. The outline
corpus entry is downgraded from a fresh held-out entry to `diagnosed` (spent by
Hunt 3, Hunt 4, and this run) in
`benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json`.

## Reproduce

```sh
npm run build
npm run discrimination-control:measure   # writes benchmarks/twins/discrimination-control.json and this report
```
