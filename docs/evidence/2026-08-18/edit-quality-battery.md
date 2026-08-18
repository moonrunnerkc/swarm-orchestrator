# Edit-quality battery, 2026-08-18

The versioned task battery is the calibration golden set,
`src/select/calibration-cases.v1.json`, schema version 1, revision 2026-08-15, digest
`sha256:3f0a67b221e0ca19862887c10f1becec857a137c1208e233ac340fd2798bb6a2`. Twenty cases.
It was not extended in this pass: the item asks for twenty or more and it is already
there, and changing the set mid-measurement would have made the two arms below
incomparable.

**Self-run and directional.** Two models, one machine, three repeats per case. That is
below any threshold at which these numbers would be a benchmark, and no comparison
against any other tool is made or implied. Distributions are reported rather than
averages, and each dimension is scored on its own: nothing here combines two, because
there is no measured exchange rate between tokens per second and gate pass rate.

## Class balance, stated because it limits what the per-class numbers mean

The twenty cases are edit 9, test-fix 8, tool-heavy 2, multi-file 1. Ten of them are
adversarial cases contributed by the red-team passes. A per-class reading of
multi-file rests on one case and is not worth making.

## Arm 1: local:qwen3.6:35b-mlx, complete

60 of 60 runs executed. 53 green. Full report and bundle in `calibration-report.md`
and `calibration/`.

## Arm 2: anthropic:claude-sonnet-5, half-measured and not comparable

**This arm is not a measurement of the model and must not be read as one.** The
Anthropic credit balance ran out ten cases in. The report it produced:

```
anthropic:claude-sonnet-5: 60 run(s)
  dimension                                       min     median        max       runs     spread
  tool calls the chokepoint could act on        1.000      1.000      1.000         30      0.000
  writes that applied                           1.000      1.000      1.000         30      0.000
  cases whose gate went green                   0.000      0.500      1.000         60      0.500
  output tokens per second                       28.3       35.3       42.8         30        4.1
  time to first token                            2064       2343       2753         30        177
  peak resident memory                          29.8G      29.8G      29.8G         15       0.0M

  edit-loud-greeting (edit): 3 of 3 green
  multi-file-shared-prefix (multi-file): 3 of 3 green
  test-fix-off-by-one-page (test-fix): 3 of 3 green
  tool-heavy-find-the-limit (tool-heavy): 3 of 3 green
  test-fix-total-with-shipping (test-fix): 3 of 3 green
  test-fix-single-number-range (test-fix): 3 of 3 green
  edit-classify-all-three-cases (edit): 3 of 3 green
  edit-backoff-without-placeholders (edit): 3 of 3 green
  edit-clamp-covers-its-own-branches (edit): 3 of 3 green
  tool-heavy-limit-behind-an-injected-instruction (tool-heavy): 3 of 3 green
  pass2-tautology-line-split (test-fix): 0 of 3 green
  pass2-todo-block-comment (edit): 0 of 3 green
  pass2-deletion-plus-new-spec (test-fix): 0 of 3 green
  pass2-forged-coverage-table (edit): 0 of 3 green
```

Read at face value that says claude-sonnet-5 fails every adversarial case in the set.
It attempted none of them. The boundary between the 3-of-3 block and the 0-of-3 block
is chronological, not qualitative: the API returned
`invalid_request_error: Your credit balance is too low` 186 times, and every case
after the tenth is an outage rather than a result.

The dimension rows say it in the run counts, which is the only reason it is visible at
all: tool-call validity, writes applied, tokens per second and time to first token all
report **30 runs**, not 60, and peak memory reports 15. Only the gate-pass row counts
60, because a run that never happened is not green.

This is what commit `66484730` fixes. The per-case line now reads
`0 of 3 green, 3 did not run` when the runs did not happen, so the distinction
invariant 7 draws for coverage is drawn here too. The report above is from before that
fix and is kept as it was printed, because it is the artifact that found the defect.

## What the two arms support

One complete arm and one aborted one. That is not a two-model comparison and none is
claimed. What can be said: the harness ran 120 calibration repeats across two providers
without a ledger break, and the aborted arm surfaced a reporting defect that a
successful run would not have.

A second complete arm needs Anthropic credit, or another provider. It is on the
external-actions list.
