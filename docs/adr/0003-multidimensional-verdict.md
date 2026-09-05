# 0003. A run's result is more than one answer

**Status:** accepted

## Context

`green: boolean` has to flatten states that are not the same finding. The two it flattens worst
are "checked and failed" and "nobody checked": one is a defect to fix, the other is a gap to
close, and reporting a gap as a pass is how a change nothing executed came to read green.

The concrete failure: the check for "did anything run over this change" asked whether any command
gate ran and did not stand down. Linting is a command gate. So a change whose declared test
command collected nothing, with a linter passing over it, read as measured and exited 0.

## Decision

A versioned verdict with a dimension per question, each carrying `unmeasured` as a first-class
value with a reason beside it: integrity, signer, executionTrust, policy, mechanical, behavioral,
semantic, task, humanApproval.

Nothing coerces `unmeasured` in either direction. `semantic` and `task` abstain by construction:
judging whether a change means what the task asked for is a judgement about meaning, and the
project's non-goals rule out an LLM judge as an authority for anything.

One boolean is derived and it is called `acceptable`, not `green`. It requires: no blocking gate
failed, no policy gate failed, and something executed the change. It does not mean the change is
right, and no number here could tell doing the whole task from doing the minimum that passes its
own tests.

## Consequences

The standalone `swarm gates` command exits on the verdict rather than on "no blocking gate
failed". A change with only a linter passing now exits 1 where it exited 0.

## What this does not buy

`acceptable` is still a summary. A reader who wants to know what was established has to read the
dimensions, which is why the CLI prints all of them with their reasons rather than the summary
alone.
