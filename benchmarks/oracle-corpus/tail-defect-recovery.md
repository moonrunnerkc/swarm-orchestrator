# Tail-defect recovery

An empty-catch (error-swallow) defect was embedded in the tail of 10 synthetically large PRs, past the 120000-char head cut. The confirmation judge was asked in two modes. Regenerate with `node dist/scripts/oracle/tail-defect.js`.

| mode | tail defects caught | recall |
|---|---|---|
| head-truncate (pre-change) | 1/10 | 0.100 |
| hunk-aware chunking (post-change) | 0/10 | 0.000 |

> Head-truncation drops the tail hunk before the judge ever sees it, so a head-truncate hit is the judge flagging the truncated head on other grounds, never a read of the planted tail defect. Chunking judges every hunk, so the tail defect actually reaches the judge; the absolute confirm rate is held down by the conservative confirm prompt, which often declines to flag an isolated empty catch. The mechanism (tail hunk presented under chunking, dropped under head-truncation) is pinned deterministically in `test/audit/cheat-detector/tail-defect.test.ts` with a marker-seeking stub, independent of any live judge.

## v2: localized confirm prompt (measured 2026-06)

The v1 absolute was capped by the conservative confirm prompt declining isolated catches. A localized confirm prompt (`LOCALIZED_CONFIRM_SYSTEM_PROMPT`) judges a single hunk on its face rather than withholding a YES because unseen surrounding code might explain the pattern. Measured against the local model (`glm47-flash-abl`); the localized-prompt calls are not in the committed judge cache, so this row is read from the frozen sidecar `benchmarks/oracle-corpus/localized-experiment.json` and refreshed with `node dist/scripts/oracle/tail-defect.js --refresh-localized`.

| chunked confirm prompt | tail defects caught | recall |
|---|---|---|
| conservative (v1, shipped) | 0/10 | 0.000 |
| localized (experiment) | 5/10 | 0.500 |

The localized prompt lifts tail-defect recall to 0.5 (+0.5 absolute). It is not yet shipped into the production chunked confirm path: a less-conservative confirm prompt's false-positive impact on real PRs is unmeasured. The companion per-hunk experiment (`per-hunk-localization.md`) showed no lift, so the localized prompt was not promoted under the joint precision/recall bar. Recommended follow-up: ship the localized prompt for the chunked confirm path once its real-PR false-positive rate is validated.

