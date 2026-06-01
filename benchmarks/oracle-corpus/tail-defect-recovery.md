# Tail-defect recovery

An empty-catch (error-swallow) defect was embedded in the tail of 10 synthetically large PRs, past the 120000-char head cut. The confirmation judge was asked in two modes. Regenerate with `node dist/scripts/oracle/tail-defect.js`.

| mode | tail defects caught | recall |
|---|---|---|
| head-truncate (pre-change) | 0/10 | 0.000 |
| hunk-aware chunking (post-change) | 1/10 | 0.100 |

> Head-truncation never sees the tail hunk, so the judge cannot confirm a defect it was never shown (recall 0). Chunking judges every hunk, so the tail defect reaches the judge. The post-change absolute is held down by the conservative confirm prompt, which often declines to flag an isolated empty catch; the point is that the defect now reaches the judge at all. The mechanism is pinned deterministically in `test/audit/cheat-detector/tail-defect.test.ts` with a marker-seeking stub that confirms the tail hunk is presented to the judge under chunking and dropped under head-truncation.

