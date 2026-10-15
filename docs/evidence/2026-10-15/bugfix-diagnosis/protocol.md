# Live diagnosis of the csstree bug-fix failure, registered 2026-10-15

Registered before any launch. The retained runs of `csstree-bugfix-raw-value-whitespace` (the
pilot's and the development launch's, six loops in all) establish that the tested configuration
of Swarm and `qwen3.8:27b` did not deliver the fix. They do not by themselves establish a
model-only cause: the trace holds product defects as well, each repaired on this branch with a
deterministic regression ([../../2026-10-14/real-task-pilot/development/README.md](../../2026-10-14/real-task-pilot/development/README.md)
for the earlier set, the commit log of this branch for the later set). What deterministic work
leaves open is one concrete question per launch below.

## Allowance

At most four task-arm launches, fifteen minutes of wall each, sixty agent-minutes in all,
corrections and internal repair included. No manual repair, no hints, no change to the task.
A launch's purpose and the reading of each outcome are written here before it runs. An
unchanged failed configuration is not repeated unless the launch below names the new question
it answers. Every launch, successful or not, is retained with its cost.

## The product under test

This branch's build: the repaired loop (a spiral inside tool arguments is cut off; an answer
the model already holds is replaced by a notice; a repair attempt without one answer's worth
of budget is withheld; a quoted script word is not a path; a numeric argument sent as text is
read), the per-run child HOME, and the repair brief that no longer names a "candidate patch"
to look for. The comparison launcher as merged in PR #81 and repaired in PR #82, unchanged on
this branch (its proof verifies against these bytes).

## Launches

| launch | arm, model | question | reading of a delivery | reading of a non-delivery |
| --- | --- | --- | --- | --- |
| 1 | Swarm, qwen3.8:27b on rapid-mlx (the pilot's settings) | does the repaired loop change the outcome on the known task? | the previously failing bug fix is delivered under the selected configuration, which the readiness bar requires at least once; the launch is checked independently by the amended hidden oracle | the trace is read for a product defect not yet repaired (a new one blocks the comparison and is repaired deterministically) or for the same model behaviour under the new notices, which is then a capability limit of this model on this task and no fresh comparison runs |
| 2 | Swarm, a second installed local model (`qwen3.6:35b-a3b` under Ollama, thinking off) | is the non-delivery specific to the first model? run only if launch 1 does not deliver | the limit is the first model's, not the product's; the readiness bar is still unmet for the pilot's configuration, and the second model is not substituted into a comparison silently | two models fail the same task through the same loop, which narrows the attribution toward the task's difficulty or the product; the trace decides which |
| 3 | OpenCode, the same model as whichever Swarm launch delivered, or qwen3.8:27b | does the other tool deliver the same task under the same budget? run only if a Swarm launch delivered, to see whether the comparison's bug-fix cell can be eligible | both tools can deliver this task; the fresh comparison's bug-fix task is a different, excluded task in any case | an interaction difference between the tools on this task, read from the traces |
| 4 | reserve | a specific new question written here before it runs, or not run | | |

Launches 2 and 3 are conditional as stated; a launch not run is reported as not run. The
server is restarted between models so that one model is resident at a time.

## What a launch cannot establish

One launch of one model on one task shows what happened that once. A delivery does not make
the model reliable on bug fixes; a non-delivery does not make the task impossible for it. The
comparison's spending gate is a separate decision with its own frozen rule.
