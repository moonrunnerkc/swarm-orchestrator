# 0008. The final word is a separate run

**Status:** accepted

## Context

Every gate a run executes runs in the workspace the run was editing, with the tests the run may
have changed, under the environment the run was in, reading reports the run's own processes
wrote. Each is a place where a run can be measured by something it controls. The sealed criteria
close the choice of instrument, the ratchet closes the erosion of the measure, and the vouched
invocation closes the environment. What none of them closes is the shape of the thing: a subject
grading its own paper.

## Decision

`swarm ci --patch <file>`: a fresh checkout of the base commit somewhere the producing tree
cannot reach, the patch applied there, the checks run in that checkout. Nothing from the
producer travels except the patch.

The gates are assembled from the base commit's manifests rather than the patched tree's, so a
patch that rewrites the test script does not choose the instrument that measures it. A patch
touching a path the run declared immutable is refused before anything runs rather than measured
and then judged. A patch that will not apply reports that no check happened, rather than passing
on an unchanged tree.

It does not require this tool's agent to have produced the patch. Two adapters read another
agent's event stream beside it, and a line an adapter does not recognise refuses the whole
stream by line number rather than being skipped.

## Amended, 2026-09-05: a passing suite is not an accepted task

Measuring found the first version of this wrong in a way that mattered. Eighteen real-repository
patches were re-scored against hidden acceptance tests, and `swarm ci` verified four that the
oracle refused: a 22% false-green rate against a bar of zero.

The cause was not a bug in a check. A repository's own suite tests the behaviour the project
already had, and a task adds behaviour it did not, so a patch that adds a feature badly still
passes a suite written before the feature existed. Running the suite establishes that nothing
broke; it does not establish that the task was done, and the first version reported the former
as the latter.

So a verification now reports `regression` and `task` separately, `verified` requires both, and
`--oracle <command>` supplies the second. Its absence leaves the task `unjudged`, which is
reported rather than defaulted to a pass. With each repository's hidden test wired in as its
oracle, the same eighteen patches score eighteen of eighteen correct.

A second finding on the way: a fresh checkout has no installed dependencies, so a real project's
runner is absent and every check stands down. That was being reported as "not verified" when it
should have been "not measured", which is the same collapse this whole project exists to avoid.
`--install` installs from the lockfile, off by default because installing runs what the registry
serves.

## Consequences

The verification path is agent-agnostic, which is what lets the product be a verifier rather
than a particular agent.

## What this does not buy

An oracle is only as good as whoever wrote it, and a task with no oracle is unjudged rather than
accepted: this makes the gap visible, it does not fill it. The three oracles measured against
were written by the people who wrote the tool, before the runs and never shown to the arms,
which is what makes them oracles rather than gates and still leaves them three tests chosen by
an interested party.
