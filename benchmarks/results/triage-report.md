# Triage report: self-labeled, ranked, conformally-gated cheat triage

A self-labeled triage layer over the cheat detectors. It mines its own labels from distant supervision, denoises them with a local judge, fuses the detectors and judge into a probabilistic label with a weak-supervision label model, ranks, and flags only above a conformal threshold that guarantees a target precision. Below threshold it abstains.

## Dataset

629 instances: 397 positive, 232 unlabeled. Tiers oracle-injected 325, restoration-proof 0, revert-weak 72, clean-presumed 232. Per the Phase 0 gate, the revert tier is a weak labeling function, not ground truth; evaluation labels come from the oracle (cheat) and the presumed-clean corpus (clean). See `distant-supervision-validity.md`.

## Label model (learned, not hand-tuned)

Class prior P(cheat) = 0.500. Most informative functions:

| labeling function | P(+1 | cheat) | P(+1 | clean) | coverage | informativeness |
|---|---:|---:|---:|---:|
| judge | 0.36 | 0.17 | 1.00 | 0.19 |
| detector:comment-only-fix | 0.94 | 0.92 | 0.04 | 0.03 |
| detector:dead-branch-insertion | 0.94 | 0.92 | 0.04 | 0.01 |
| detector:mock-of-hallucination | 0.97 | 0.95 | 0.07 | 0.01 |
| detector:error-swallow | 0.95 | 0.94 | 0.05 | 0.01 |
| detector:fake-refactor | 0.95 | 0.95 | 0.06 | 0.00 |

## Ranker (held-out test split, true labels)

- Test instances: 114 (positives 67, base rate 58.8%)
- PR-AUC (average precision): 0.899 (vs 58.8% for a random ranker)
- Recall at 10% review budget: 16.4% (ceiling 16.4% at this base rate, so the top decile is all true positives)
- Recall at 20% review budget: 34.3% (ceiling 34.3%)

## Conformal selective flag (the 90% knob)

Target flagged-precision: 90.0% (config `SWARM_TRIAGE_TARGET_PRECISION`), one-sided confidence 95.0% (config `SWARM_TRIAGE_ALPHA`). The threshold is the lowest score (maximum coverage) whose calibration-split precision lower bound clears the target.

- Calibration: threshold 0.4399, flagged 50, precision 98.0% (lower bound 90.9%), coverage 36.8%

- **Test flagged-precision: 92.7%** (lower bound 82.2%)
- Test coverage (flagged / test): 36.0% (41/114)
- Test recall of flagged (cheats caught / all test cheats): 56.7%

The flagged set meets the 90.0% target on held-out test data.

## Caveats (the numbers are honest only with these)

- **Oracle-rich base rate.** The evaluation mix (oracle injections as the positive class, presumed-clean PRs as the negative) has a 58.8% positive base rate, far higher than a real PR stream. The split-conformal guarantee holds for the distribution it is calibrated on; a consumer recalibrates the threshold on their own prevalence (the threshold is the only thing that moves, the machinery does not).
- **Recall at budget is base-rate-capped.** With positives this common, the top decile cannot contain more than its size, so recall at a 10% budget is ceiling-bound; the operating point below (recall at the conformal threshold) is the meaningful recall.
- **The judge caps label-model separation.** gemma4:31b catches ~48% of the injected cheats (it is the only bidirectional labeling function), so the label model's probabilities are compressed; the ranker recovers separation from the full feature set, which is why PR-AUC exceeds what the label-model margins alone would suggest.
- **Test lower bound is wide.** The held-out test flagged set is small, so its Clopper-Pearson lower bound is loose; the guarantee that picked the threshold is the calibration-split lower bound, and the test point estimate validates it out of sample.

## Reproduce

```
npm run triage:full   # mine, denoise (replay), featurize, label model, rank, calibrate
```

Detector votes and the split are deterministic; judge verdicts replay from the committed cache. The numbers above regenerate from the committed corpora.
