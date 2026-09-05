# 0005. A gate declares what a pass establishes

**Status:** accepted

## Context

A lint run and a test run are both a command the harness spawned. Treating them alike is how a
change nothing executed reads green: linting proves the source parses and establishes nothing
about whether any of it was ever run.

## Decision

Every gate carries a capability, read off its id rather than special-cased per gate (invariant 6:
engine logic never special-cases a gate):

- `static`: reads the source without executing it. Lint, typecheck, format.
- `dynamic`: executes the code under change. The tests gate, the behaviour probe.
- `policy`: rules on the change without executing or judging it. Secrets, placeholders, the
  declared file set, the diff budget.
- `task-oracle`: a trusted check specific to this task. Nothing assembles one today.

"Did anything execute this change" is answered by a `dynamic` gate that passed. A test holds
every assembled gate to being classified by name, so a new gate cannot be quietly defaulted into
`static`.

## Consequences

Making a dynamic pass load-bearing exposed two vacuous passes, both now abstaining: the behaviour
probe reported `passed` where the harness could not spawn a probe at all, and where it probed
zero functions. Both had prose saying "not measured is a verdict" above code that returned exit
zero.

## What this does not buy

`behavioral: pass` means a dynamic gate ran and passed. It does not mean the tests were good
tests, that they covered the change, or that they would have caught the bug. Coverage of changed
lines is a separate measurement with its own abstention rules (invariant 7).
