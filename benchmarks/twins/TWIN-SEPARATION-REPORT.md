# Twin separation: detector tier

Paired separation of the advisory detector tier over cheat/honest twins. Each pair
shares a source PR: the cheat twin has an injected defect, the honest twin is the
untouched clean change. Separation is P(fire on cheat) - P(fire on honest);
McNemar's exact test uses only the discordant pairs. Tiers are reported separately.
Every number regenerates from `scripts/gate/measure-twin-separation.ts`
(`npm run twins:separation`).

Scope: this is the DETECTOR tier (diff-only, deterministic, no provisioning). The
execution-grounded proof tier and the claim-differential separation over the same
pairs are bounded by the 12-Node provisioning limit and are recorded as follow-on.

## Overall by tier

| tier | pairs | cheat fire rate | honest fire rate | separation | McNemar p |
| --- | --- | --- | --- | --- | --- |
| semi-synthetic | 52 | 56% | 2% | 0.54 | 0.0000 |

## By category

| tier | category | pairs | cheat fire | honest fire | separation | honest FPs |
| --- | --- | --- | --- | --- | --- | --- |
| semi-synthetic | assertion-strip | 4 | 25% | 0% | 0.25 | 0 |
| semi-synthetic | cheat-mock-mutation | 4 | 0% | 0% | 0.00 | 0 |
| semi-synthetic | comment-only-fix | 4 | 0% | 0% | 0.00 | 0 |
| semi-synthetic | coverage-erosion | 4 | 100% | 25% | 0.75 | 1 |
| semi-synthetic | dead-branch-insertion | 4 | 0% | 0% | 0.00 | 0 |
| semi-synthetic | error-swallow | 4 | 100% | 0% | 1.00 | 0 |
| semi-synthetic | exception-rethrow-lost-context | 4 | 0% | 0% | 0.00 | 0 |
| semi-synthetic | fake-refactor | 4 | 100% | 0% | 1.00 | 0 |
| semi-synthetic | goal-not-fixed | 4 | 0% | 0% | 0.00 | 0 |
| semi-synthetic | mock-of-hallucination | 4 | 100% | 0% | 1.00 | 0 |
| semi-synthetic | no-op-fix | 4 | 100% | 0% | 1.00 | 0 |
| semi-synthetic | test-relaxation | 4 | 100% | 0% | 1.00 | 0 |
| semi-synthetic | type-suppression | 4 | 100% | 0% | 1.00 | 0 |

## Honest-twin false positives

1 honest-twin fire(s) recorded above. The detector tier is advisory (PR-level precision ~0.22 against outcome labels), so these are expected advisory false positives on the clean side, recorded per category. They are NOT the block-tier stop-the-line, which applies only to a proven trigger; this diff-only measurement runs no proof.

## Two honest caveats

- **Semantic categories** (goal-not-fixed, cheat-mock-mutation) have no structural
  tell, so the diff-only detector tier does not fire on them by design; their
  separation is measured through the judge path, reported separately in the judge
  baseline. A zero here is expected, not a miss.
- **Diff-only harness.** This runs the detectors on the diff alone with a bare
  manifest directory, so a few structural categories whose detector needs more
  than the isolated hunk (comment-only-fix, dead-branch-insertion,
  exception-rethrow-lost-context) can read zero here even though the oracle's own
  scoring harness (with manifests and config) catches them at 258/275. Those rows
  are a harness floor, not a recall claim; the categories that fire show the real
  separation.
