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

## Consequences

The verification path is agent-agnostic, which is what lets the product be a verifier rather
than a particular agent.

## What this does not buy

The fresh checkout runs the repository's own gates, so it inherits whatever those establish. A
project whose tests do not cover the change gets a `behavioral: unmeasured` from a fresh
checkout exactly as it does from the run itself. Independence removes one class of doubt, not
every class.
