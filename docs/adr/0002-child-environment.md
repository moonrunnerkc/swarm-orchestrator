# 0002. A child process gets a built environment, never an inherited one

**Status:** accepted

## Context

A path check cannot see `process.env.ANTHROPIC_API_KEY`, because that read names no file. Every
command the model wrote and every gate command the repository declared inherited the environment
the run was started from, so a shell holding the operator's provider keys handed them to both.

There was a filter, and it answered a different question: it dropped the names that decide what
node loads, which keeps a measurement honest and leaves the credentials in place.

## Decision

The floor is an allowlist, not a denylist, because a denylist answers "is this one of the names
we thought of" rather than "does this process need it".

`PATH`, the locale names and `TERM` travel. `HOME` is a directory the harness owns rather than
the operator's. `TMPDIR` is the system scratch directory. Everything else needs naming by the
run, and a name that is credential-shaped or that decides what a process loads is refused rather
than filtered down, so authorizing one fails loudly instead of quietly not working.

Credential shape is decided by the detector the write-time scrub and the secret-scan gate already
share, so invariant 9's "one detector" stays one.

Provider keys have no `swarm.toml` setting. A file that names one is refused with rotation
guidance, because `swarm.toml` is committed and cloned: by the time anyone reads a warning, the
key has been shared with everyone holding the repository.

## Consequences

A project whose gate commands need an environment variable must name it. That is the intended
cost: an unnamed variable reaching a repository-declared command is the thing this closes.

`TMPDIR` must name a directory that exists. Pointing it at one that does not fails quietly rather
than loudly: node's test runner writes a zero-byte lcov report, and invariant 7 reads an
incomplete report as not measured, so the coverage arm goes silent. There is a test holding that
directory to existing.

## What this does not buy

The allowlist bounds what a child is handed. It does not bound what a child can read from disk;
that is the policy guard's job on the host and the mount's job behind a backend.
