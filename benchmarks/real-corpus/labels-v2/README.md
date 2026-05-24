# labels-v2

Hand-labeled real-corpus labels following the rubric in
[`docs/labeling-methodology.md`](../../../docs/labeling-methodology.md).

## Directory layout

```text
labels-v2/
  README.md                         this file
  raters.json                       per-rater anonymized id + rate + count
  agreement.json                    pairwise Cohen's kappa + overall min
  schema.json                       JSON Schema for an individual label
  rater-001/
    labels.jsonl                    one JSON object per line, one PR per object
  rater-002/
    labels.jsonl
  rater-003/
    labels.jsonl
  final/
    <pr-id>.json                    promoted entries after kappa + dispute path
  dropped.json                      PRs dropped at the 2-2 split case
```

## Status

The scaffold is committed empty. The rater pool is the next milestone;
recruitment, payment, and the actual labels are the work that earns the
"first AI-PR cheat detector with a published human-labeled benchmark"
positioning the v10.2-advisory release sets up.

`benchmarks/real-corpus/labels/` is the v10.1 AI-judged labels (the
"pending human review" set). It stays in tree as the regression
sidebar until labels-v2 reaches a comparable size.

## Reproducing

```bash
# verify a rater pool's pairwise agreement
node dist/scripts/labeling/compute-kappa.js \
  --labels-dir benchmarks/real-corpus/labels-v2

# score against the human-labeled subset once final/ is populated
node dist/scripts/corpus/score-real.js \
  --labels-dir benchmarks/real-corpus/labels-v2/final
```
