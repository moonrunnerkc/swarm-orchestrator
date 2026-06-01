# Per-hunk judge localization

10 multi-hunk PRs, each with a mock-of-hallucination defect in one known hunk and benign changes in the rest. Whole-diff judging returns one verdict for the entire diff and cannot point at a hunk; per-hunk judging judges each hunk under a stable (file, hunk-index) id and localizes the verdict. Regenerate with `node dist/scripts/oracle/per-hunk.js`.

| mode | flags the diff | localizes to a hunk | points only at the defect hunk |
|---|---|---|---|
| whole-diff | 2/10 | never (no hunk id) | 0/10 |
| per-hunk | 0/10 (defect hunk) | yes | 0/10 |

> Whole-diff judging returns one verdict for the whole diff, so it can never point at a hunk: its localization is 0 by construction. Per-hunk judging produces a verdict per hunk under a stable (file, hunk-index) id, so a confirmed defect is localizable. On this synthetic fixture the local confirm judge is too noisy to give a clean accuracy number (it flagged benign hunks 10/10 and the planted mock 0/10 — a model failure on the isolated confirm question, not a localization-mechanism failure). The mechanism itself is pinned deterministically in `test/audit/cheat-detector/diff-chunker.test.ts` (stable per-hunk ids, one valid one-hunk diff per chunk). A stronger judge would lift the accuracy; the per-hunk infrastructure is in place.

