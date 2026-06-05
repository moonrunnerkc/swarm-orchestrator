# Per-hunk judge localization

10 multi-hunk PRs, each with a mock-of-hallucination defect in one known hunk and benign changes in the rest. Whole-diff judging returns one verdict for the entire diff and cannot point at a hunk; per-hunk judging judges each hunk under a stable (file, hunk-index) id and localizes the verdict. Regenerate with `node dist/scripts/oracle/per-hunk.js`.

| mode | flags the diff | localizes to a hunk | points only at the defect hunk |
|---|---|---|---|
| whole-diff | 2/10 | never (no hunk id) | 0/10 |
| per-hunk | 0/10 (defect hunk) | yes | 0/10 |

> Whole-diff judging returns one verdict for the whole diff, so it can never point at a hunk: its localization is 0 by construction. Per-hunk judging produces a verdict per hunk under a stable (file, hunk-index) id, so a confirmed defect is localizable. On this synthetic fixture the local confirm judge is too noisy to give a clean accuracy number (it flagged benign hunks 10/10 and the planted mock 0/10, a model failure on the isolated confirm question, not a localization-mechanism failure). The mechanism itself is pinned deterministically in `test/audit/cheat-detector/diff-chunker.test.ts` (stable per-hunk ids, one valid one-hunk diff per chunk). A stronger judge would lift the accuracy; the per-hunk infrastructure is in place.

## v2: localized confirm prompt (measured 2026-06)

To test whether the conservative prompt was the cap, the per-hunk path was measured with the localized confirm prompt (local model `glm47-flash-abl`). The localized-prompt calls are not in the committed judge cache, so this row is read from the frozen sidecar `benchmarks/oracle-corpus/localized-experiment.json` and refreshed with `node dist/scripts/oracle/per-hunk.js --refresh-localized`.

| per-hunk confirm prompt | defect hunk flagged | points only at the defect hunk | benign hunk false-flagged |
|---|---|---|---|
| conservative (v1) | 0/10 | 0/10 | 10/10 |
| localized (experiment) | 0/10 | 0/10 | 10/10 |

The localized prompt did not move per-hunk localization. Unlike tail-defect (where the localized prompt lifted recall 0.1 to 0.5, see `tail-defect-recovery.md`), the per-hunk failure is not conservatism: the local model flags benign hunks and misses the planted mock regardless of prompt framing. This is a model-capability gap. Per-hunk localization stays infrastructure (the plumbing is proven by `test/audit/cheat-detector/diff-chunker.test.ts`); a stronger judge is the only path to a real localization number, not a prompt change.

