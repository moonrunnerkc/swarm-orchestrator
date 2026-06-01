# Tail-defect recovery

An empty-catch (error-swallow) defect was embedded in the tail of 10 synthetically large PRs, past the 120000-char head cut. The confirmation judge was asked in two modes. Regenerate with `node dist/scripts/oracle/tail-defect.js`.

| mode | tail defects caught | recall |
|---|---|---|
| head-truncate (pre-change) | 0/10 | 0.000 |
| hunk-aware chunking (post-change) | 1/10 | 0.100 |

> Head-truncation never sees the tail hunk, so the judge cannot confirm a defect it was never shown (recall 0). Chunking judges every hunk, so the tail defect reaches the judge. The post-change absolute is held down by the conservative confirm prompt, which often declines to flag an isolated empty catch; the point is that the defect now reaches the judge at all. The mechanism is pinned deterministically in `test/audit/cheat-detector/tail-defect.test.ts` with a marker-seeking stub that confirms the tail hunk is presented to the judge under chunking and dropped under head-truncation.

## v2: localized confirm prompt (measured 2026-06)

The v1 absolute (0.1) was capped by the conservative confirm prompt declining isolated catches. A localized confirm prompt (`LOCALIZED_CONFIRM_SYSTEM_PROMPT`) judges a single hunk on its face rather than withholding a YES because unseen surrounding code might explain the pattern. Re-measured against the local model (`glm47-flash-abl`) with `node dist/scripts/oracle/tail-defect.js --localized`:

| chunked confirm prompt | tail defects caught | recall |
|---|---|---|
| conservative (v1, shipped) | 1/10 | 0.100 |
| localized (experiment) | 5/10 | 0.500 |

The localized prompt lifts tail-defect recall to 0.5 (+0.4 absolute). It is not yet shipped into the production chunked confirm path: the judge cache key does not fold the prompt text (so a switch needs a cache-key discriminator), and a less-conservative confirm prompt's false-positive impact on real PRs is unmeasured. The companion per-hunk experiment (`per-hunk-localization.md`) showed no lift, so the localized prompt was not promoted under the joint precision/recall bar. Recommended follow-up: ship the localized prompt for the chunked confirm path once its real-PR false-positive rate is validated.

