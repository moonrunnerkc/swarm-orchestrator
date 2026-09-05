# 0006. One place a run is stopped from

**Status:** accepted

## Context

Three separate failures of the same shape.

A timeout signalled the process the harness spawned and nothing that process spawned. A test
runner that forks workers, a build that shells out, a server a test forgot to close: each kept
running against the workspace the next gate was about to read.

`--max-wall-minutes` reached `runInParallel` through a spread into an options object with no such
field. A spread of an object literal into an object literal skips excess property checking, so
the setting compiled, ran, and bounded nothing.

The parallel command handed its workers `new AbortController().signal`: a controller nobody holds
a reference to and nobody ever aborts. A Ctrl-C reached the coordinator and stopped none of the
work under it.

## Decision

Every child is spawned as its own process-group leader and stopped by signalling the group,
SIGTERM then SIGKILL after a grace period. One runner serves the shell tool and the gate
commands.

A run has one cancellation tree. The wall budget, a Ctrl-C and a supervisor's SIGTERM all reach
the same signal, that signal is what workers get, and a worker starting late is handed what is
left of the budget rather than a fresh one, because ten workers with half an hour each is five
hours. The first reason is kept: what stopped a run is not the second thing anyone noticed.

SIGTERM is handled alongside SIGINT everywhere. A run stopped by a supervisor, a container stop
or a CI cancellation arrives as SIGTERM.

## Consequences

Killing a process group is coarse. A command that deliberately backgrounds work meant to outlive
the run will have it stopped. That is the intended direction: work nothing measures, writing into
a tree a gate is about to read, is the failure this exists to prevent.

## What this does not buy

The deadline bounds dispatch and signals what is running. It does not preempt a process that
ignores SIGTERM before the SIGKILL grace period elapses, and it does not roll back what a worker
already wrote.
