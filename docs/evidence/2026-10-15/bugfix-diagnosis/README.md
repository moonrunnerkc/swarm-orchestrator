# Live diagnosis of the csstree bug-fix failure: results, 2026-10-15

Two of the four launches the [protocol](protocol.md) registered were run; the third and fourth
were not, under the protocol's own conditions. The bug fix was not delivered by either
installed model under the repaired product. The fresh comparison the assignment conditioned on
an autonomous delivery therefore did not run.

| launch | arm, model | question | outcome | agent time | tokens | reading |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ([launch-1/](launch-1/results.md)) | Swarm, `qwen3.8:27b` on rapid-mlx, the pilot's settings | does the repaired loop change the outcome on the known task? | not delivered: no edit in four loops; the initial invocation stalled three times, each scripted correction ended at its wall; final tree is the base; hidden oracle fail | 13.6 min (7.0 + 5.8 + 0.8) | 651,214 | the repaired mechanisms engaged (one text spiral cut off after 96 repeats, five repeated calls answered with the notice, three stalled stops, no refusal of a probe) and the model still never edited the generator; the same behaviour as the six earlier loops, at lower cost per loop |
| 2 ([launch-2/](launch-2/results.md)) | Swarm, `qwen3.6:35b-a3b` on Ollama, thinking on (Ollama's OpenAI route ignores the off switch) | is the non-delivery specific to the first model? | not delivered: the model edited `lib/generator/create.js` and `lib/syntax/node/Raw.js` (5,922-byte patch) and left a `ReferenceError`; the product's tests gate and visible check caught it; each invocation spent its 600,000-token allowance in about three minutes of thinking; hidden oracle fail | 9.1 min (2.7 + 3.0 + 3.4) | 1,854,235 | a different failure shape: this model moves to editing and edits wrongly, with its budget gone to reasoning. Two models fail the same task through the same loop in different ways, which narrows nothing toward the product: the loop's own gates rejected the broken tree each time |
| 3 | OpenCode | run only if a Swarm launch delivered | not run | | | |
| 4 | reserve | no new question arose that a launch could answer | not run | | | |

Agent time 22.7 of the 60 minutes allowed; 2 of 4 launches; end-to-end with preparation and
scoring 23.4 minutes. No manual repair, no hints, no change between launches. Records,
patches, every cited blob and each session's ledger, gate runs and bundle manifest are under
[launch-1/diagnosis-1/](launch-1/diagnosis-1/) and [launch-2/diagnosis-2/](launch-2/diagnosis-2/),
with the analyses derived from those directories alone; the stdout excerpt copies the
publisher writes are omitted to keep the repository under its weight ceiling (the full
streams are the packed blobs the records cite).

## What the traces add

- The three loop repairs from the retained traces all engaged live in launch 1 and cost no
  correctness: the spiral cut-off, the already-answered notice, the stall stop.
- In launch 1's first correction the model call ran 276 seconds without returning until the
  wall ended it. The server's stream probe ([stream-probe.json.gz](stream-probe.json.gz))
  shows why the watcher cannot see such a call: rapid-mlx with the `qwen3_coder_xml` parser
  emits a tool call's arguments as one chunk per parameter value, so a spiral inside one
  unterminated parameter produces no delta until the output cap. The watcher reads text,
  reasoning and tool-argument deltas; what this server does not stream, it cannot cut off.
  A residual of the server, named rather than worked around.
- Launch 2 refused two `node -e` probes for a bare `/` inside the script, which resolved to
  the filesystem root; repaired on this branch (a derived piece with no letter or digit is
  not a path) with a regression. The model's other refusals were its own: writes to
  `/private/tmp/debug.js` and `/workspace/debug.js`, outside the workspace, and a call to a
  tool named `set` that does not exist.
- Launch 2's first loop reported 628,848 tokens against a 600,000 allowance: the allowance is
  checked before each call and bounds output, not the input of the last call. Reported as it
  is; the overrun is one call's input.
- Launch 2's second correction answered its first turn with a plan and no tool call, which the
  loop reads as a completion claim; the gates then failed and the repair attempt did the
  editing. The reading is the product's documented rule, and it cost one gate cycle here.
- With Ollama, thinking cannot be turned off through the OpenAI-compatible route the product
  uses, so the second model's allowance went to reasoning deltas (183 in the probe's one
  answer). A configuration limit of that arm, disclosed; it was not substituted into any
  comparison.

## What this establishes

Under the repaired product, the first model repeats itself without editing and the second
edits wrongly; neither delivers this bug fix within the pilot's budgets. The product's share of
the earlier failure (cost, refusals, unmeasured attempts) is repaired and shown engaged; what
remains is not supplied by the product and was not supplied by either model. The readiness
bar for a fresh comparison ("at least one independently checked autonomous delivery of the
previously failing bug fix") is unmet, and the comparison did not run. Two launches on one
task show what happened twice; they do not bound either model's ability on bug fixes in
general.
