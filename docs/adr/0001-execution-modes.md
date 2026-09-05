# 0001. Execution modes are measured, not asserted

**Status:** accepted

## Context

The type that decided what a tool call could touch was called `Sandbox`, and the README said the
chokepoint "enforces the sandbox". What it actually does is read a command string into the
programs it would run and the words that could name a file, and rule on those against a
denylist. That is a real check. It is not containment: every executable on the allowlist is an
interpreter, and an interpreter runs whatever a workspace script says. A command whose effect a
shell decides, a substitution or an expansion, names no path for the reader to rule on at all,
and the build guide already listed that as the case where "an answer of yes is the whole of the
protection".

Calling it a sandbox is worse than the gap it names, because a reader who sees the word stops
asking what it covers.

## Decision

Three modes, and which one a run is in is a measurement:

- `isolated`: a kernel-enforced filesystem, process and network boundary that passed the
  containment self-test.
- `restricted`: the lexical path and program policy, on the host.
- `unsafe`: host execution an operator explicitly asked for with the policy off.
- `unknown`: a backend that refused the escapes and also refused the work.

The type is `PolicyGuard`. The word "sandbox" appears nowhere a person reads it except in the
sentence that says this is not one.

Before the first tool call, a self-test runs the escapes rather than reasoning about them:
read a host file outside the workspace, write outside it, open a network connection. Whatever
gets through is named. The result is an `execution-envelope` ledger record carrying the probes
themselves, and it is printed before the run starts.

A fourth check decides nothing about escapes and everything about honesty: the command must be
able to write and read back a file in its own workspace. A backend whose mount is silently empty
refuses every escape probe because it can see nothing, and would otherwise read as perfectly
isolated. Docker Desktop on macOS shares `/Users` and not `/tmp`, and a bind mount of an unshared
path is empty rather than an error, which is how this was found. A backend that fails
reachability is `unknown`, never `isolated`.

## Consequences

`isolated` is reachable: `--isolation docker[:image]` runs shell commands inside a container with
only the workspace mounted, a read-only image filesystem, no network, no capabilities,
no-new-privileges, and bounded memory and process count. The default is the host, so nothing
changes for an existing user until they ask.

## What this does not buy

The self-test probes three escapes. It is a floor, not a proof of containment: a backend that
refuses those three can still have a hole nobody probed for. The container backend has not been
audited against a determined escape, and a container is not a virtual machine. Nothing here
establishes that the machine running the harness was itself sound.
