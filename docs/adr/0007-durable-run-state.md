# 0007. A run's state outlives its process

**Status:** accepted

## Context

The ledger is append-only by design, which makes it the record of what happened and the wrong
thing to ask "what is still owed". A resumed run needs mutable state: which activities were
dispatched and never came back, which files are held, what budget is spent, what a person
already approved. Keeping that only in memory meant a killed process left worktrees, leases and
branches behind with no way to tell work it had committed from work it had only started.

## Decision

SQLite from the standard library (`node:sqlite`), in WAL mode so a reader never blocks the run,
beside the session store rather than inside any workspace.

Intent is written before the effect. A step in flight with no result is exactly what a resume
has to decide about, and a crash between the two is then visible rather than invisible.
Idempotency is keyed on the work and the tree it starts from, never a clock, so replaying a
resumed run does not repeat an effect it already committed.

Six commands act on it: `list-runs`, `inspect`, `resume`, `retry-step`, `abort`, `repair`.
Resume is repair plus a report of what is still owed; it deliberately does not restart the
model, because a resume that quietly did something else is worse than one that says what is
left.

Failing to open the store never stops a run. Durable state is what makes the next process able
to recover, and trading a whole run for that convenience is the wrong direction.

## Consequences

Crash recovery is testable, and tested: a hundred runs each killed at a different point, each
resumed, three committed effects apiece. Three hundred effects, no duplicates.

## What this does not buy

The store records that a step was dispatched, not what that step did to the filesystem. Resume
puts the bookkeeping right; it does not roll back a partial edit, and a step whose effect is not
idempotent will still repeat it if the caller reruns it without checking `alreadyDone`.
