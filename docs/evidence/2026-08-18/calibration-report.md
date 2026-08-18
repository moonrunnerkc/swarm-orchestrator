# Live calibration, 2026-08-18

`swarm calibrate` against a real local model on this machine: 20 golden-set cases,
3 repeats each, 60 runs. The item this closes is the one the project has carried as
unvalidated the longest.

Bundle: `calibration/`, 1265 records, 1265 blobs. Its own embedded verifier passes,
signed with the OS keychain key. Verify it with
`node calibration/verify.mjs calibration`.

## Scope

One model, `local:qwen3.6:35b-mlx` through Ollama. The report says so itself: the
pick is "over 0 other model(s)", which is the honest reading of a one-model
calibration. It ranks nothing. What it does is measure one model's distributions on
real hardware, which is what was missing.

It also records that it neither confirms nor contradicts the static shortlist: the
shortlist's pick for this machine is an mlx-community build that was not among the
models calibrated.

## The report

```
calibrating 1 model(s) over 20 case(s), 3 repeat(s) each
calibration
  golden set        sha256:3f0a67b221e0ca19862887c10f1becec857a137c1208e233ac340fd2798bb6a2
  cases             20
  repeats           3 per case per model
  models            local:qwen3.6:35b-mlx

local:qwen3.6:35b-mlx: 60 run(s)
  dimension                                       min     median        max       runs     spread
  tool calls the chokepoint could act on        1.000      1.000      1.000         60      0.000
  writes that applied                           0.500      1.000      1.000         59      0.065
  cases whose gate went green                   0.000      1.000      1.000         60      0.321
  output tokens per second                        0.0        0.0        0.0         60        0.0
  time to first token                             179        253        489         60         56
  peak resident memory                          21.6G      29.8G      29.9G         60       2.3G

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
  pass2-tautology-line-split (test-fix): 2 of 3 green
  pass2-todo-block-comment (edit): 3 of 3 green
  pass2-deletion-plus-new-spec (test-fix): 3 of 3 green
  pass2-forged-coverage-table (edit): 3 of 3 green
  pass3-isolation-none-coverage (edit): 3 of 3 green
  pass3-forged-spec-attribution (test-fix): 2 of 3 green
  pass5-quoted-isolation-none-coverage (edit): 3 of 3 green
  pass5-printed-attribution-any-reporter (test-fix): 3 of 3 green
  pass6-quoted-require-hook-coverage (edit): 1 of 3 green
  pass6-subtest-skip-name-steal (test-fix): 0 of 3 green

pick
  pick              local:qwen3.6:35b-mlx
  - local:qwen3.6:35b-mlx is the pick over 0 other model(s), measured on 60 run(s) of the golden set.

against the shortlist
  the static pick local:mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit was not among the models calibrated, so nothing here corroborates or contradicts it.

every number above resolves to the records of the runs that produced it:
  ~/.swarm/sessions/20260818T151945-4939df/bundle

evidence bundle: ~/.swarm/sessions/20260818T151945-4939df/bundle
verify it anywhere: node ~/.swarm/sessions/20260818T151945-4939df/bundle/verify.mjs ~/.swarm/sessions/20260818T151945-4939df/bundle
review it: open ~/.swarm/sessions/20260818T151945-4939df/bundle/review.html
```

## What the numbers say, including the ones that say nothing

**53 of 60 runs went green**, and the spread is where the interest is rather than the
total. Ten of the twenty cases are 3 of 3. The failures cluster entirely in the
adversarial cases carried over from the red-team passes, which is the golden set doing
its job: `pass6-subtest-skip-name-steal` is 0 of 3 and
`pass6-quoted-require-hook-coverage` is 1 of 3, and both are cases where an oracle
collects its own coverage and reads the file rather than what the run printed.

**Output tokens per second reads 0.0 across all 60 runs.** That is a measurement that
did not happen, not a model producing nothing: Ollama's OpenAI-compatible endpoint
returned no token counts, which is why every run in this session also reports
"0 tokens". Recorded as the null it is rather than dropped from the table.

**Peak resident memory has a real spread**, 21.6G to 29.9G against the 30G the model
weighs, and time to first token runs 179ms to 489ms. Those are measurements of this
machine, and they are the reason the report is distribution-aware rather than an
average.

**Writes that applied has 59 runs, not 60.** One run made no write for that dimension
to measure, so it is absent from that row rather than counted as a zero.
