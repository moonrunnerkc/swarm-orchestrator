# Architecture

Two packages, one boundary. **Swarm Orchestrator** (this repository) is the coding agent: it owns
the task, the model, the edit loop, the managed workspace and the report.
**[Swarm Verify](https://github.com/moonrunnerkc/swarm-verify)** is the verifier: it owns the
request and result schema, test-result normalization, the acceptance rule, isolated execution,
attestations and evidence validation. Requirement statuses and the overall state are derived
there and only there. This repository reads them and never recomputes them
([ADR 0015](adr/0015-coding-agent-consumes-standalone-verifier.md)). The verifier is pinned to an
exact published version and used only through its public API.

## A run, in order

1. **Setup** (`src/agent/run.ts`). The session's evidence directory is opened under
   `~/.swarm/sessions`, outside the workspace. A clone of the repository is made beside it,
   seeded with the user's tree as it stands. The model's commands run there, never in the
   user's tree, each in a fresh container (`src/tools/executor.ts`, below).
2. **Requirements** (`src/agent/requirement-record.ts`). R1 is the task, verbatim. Items of a
   list in the task and `--require` quotes become further required requirements. Version
   constraints and a request for tests are read from the wording by code. This set is fixed
   before the first edit. The model can add suggestions; it cannot change, drop or downgrade
   anything required.
   Two kinds of requirement are derived and fixed with them (`src/agent/run-derived.ts`), each
   under its own source so neither is read as the user's wording: the approved conventions
   (`profile`), and the security obligations the task brings (`security`). Advisory notes, such
   as an obligation that does not apply and why, go in the report and decide nothing.
3. **Checks** (`src/agent/check-gate.ts`). Each required requirement gets a check the coding
   model did not write: the user's, or one drafted by a separate model call that never sees the
   change. Every check is run against the unchanged repository first and refused if it could not
   tell the change apart. Checks are sealed outside the tree.
4. **The loop** (`src/agent/loop.ts`). One model turn at a time: a command, a file edit, a
   requirements proposal, or a completion marker. Every command and edit passes through one
   chokepoint (`src/tools/chokepoint.ts`) under a lexical path policy, in an environment built
   from scratch. After each change the harness runs the checks and the tests the change reaches.
   When they pass it asks the verifier.
5. **Finalization** (`src/agent/finalize.ts`). Whatever ended the loop, the tree is snapshotted
   as a patch. A verification already held is reused only if it measured exactly that patch
   under exactly that requirement set; otherwise the patch is verified again, or reported
   incomplete with the reason. The tree is read once more afterwards, and a result that no
   longer describes it is not reported as one that does.
6. **Delivery** (`src/agent/workspace.ts`). The patch is applied to the user's tree only if that
   tree is as the run found it.

## The execution boundary

Two parties, kept apart. The supervisor is this process: it talks to the model, holds the
approved profile and the acceptance checks, calls the verifier, and writes and signs evidence.
The worker is where untrusted code runs: the model's commands and the harness's own checks
between turns, which execute the candidate too.

By default the worker is a container per command, from the verifier's sandbox
(`swarm-verify/execution`): a pinned image, the caller's uid, no capabilities, bounded memory,
CPU and processes, and no network. It sees the workspace, a private HOME, and a copy of the
workspace's git directory in place of the real one, so git works there and nothing it writes is
read by the supervisor's git. It does not see the user's home, environment, credential stores,
SSH agent, docker socket, the session's evidence, the sealed checks, the profile or signing keys.
They are not mounted; nothing relies on a prompt to keep them unread.

The network opens for one thing: a package manager's install run as a command of its own, with
install scripts off. Scripts run afterwards, with the network closed. This is recorded on each
command's ledger entry. For Python projects the install builds packages while the network is
open; that is the one place untrusted code runs with a network, inside the container.

If the container cannot be made the run is blocked before anything executes. `--host` is the
only way onto the user's machine, chosen by the user, and it is reported as `host, not
isolated`: there the lexical path policy is all that applies, and it is not a boundary.

Security checks are driven from outside the candidate: the verifier starts the application in
one container with only its own loopback, and a driver in a second container sends the requests
and reports. What the application prints is never read as a result. A sealed unit test, by
contrast, shares a process with the code it tests; the report labels the two kinds apart.

## Budgets

One allowance of steps, tokens and wall time covers the whole run: check drafting, the loop,
any review and any escalation to another model. Time for a final verification is held back from
the loop, sized from the last verification's duration.

## Evidence

- Every command, model reply, check result and verification is a record on an append-only,
  hash-chained ledger (`src/evidence/ledger.ts`), with payloads stored by SHA-256. A failed
  write aborts the run. A damaged chain is reported, never repaired.
- Payloads pass through one scrubber for known credential patterns before they are stored
  (`src/evidence/scrub.ts`). This is pattern matching, not secret removal.
- Session directories are owner-only (0700 directories, 0600 files).
- The verifier signs an in-toto Statement in a DSSE envelope over the patch and the tree it
  measured. Signing keys come from the environment or the OS keychain, never the workspace.

## What this does not give you

- The container bounds the model's commands; it does not defend against a compromised docker
  daemon, kernel or host administrator, and concurrent containers together can use more than one
  container's bound. With `--host` there is no boundary, only the lexical path policy.
- Security automation covers three checks for JavaScript and TypeScript HTTP APIs: resource
  ownership, expiring single-use tokens, and duplicate operations. A passing check shows those
  requests behave; it is not a security review of the application.
- Conventions are measured from syntax in JavaScript and TypeScript files. Whether a comment is
  helpful is guidance for the model, never a checked rule.
- A signature makes evidence tamper-evident. It does not make the tests comprehensive or the
  change correct beyond what they measured.
- Repository instruction files (`AGENTS.md`, `CLAUDE.md`) shape the model's work and are
  untrusted: they cannot grant key access, change who judges, or relax execution policy.
- Dividing a task into requirements is mechanical (lists and quotes). Swarm does not claim to
  understand everything a sentence asks for; R1 holds the whole task for that reason.

## Model selection

`src/runtime` discovers installed models, estimates memory at the context, probes readiness and
ranks by each model's record of attributed finished runs on this machine. The policy is small on
purpose: completion rate where three or more runs are recorded, otherwise an even prior; then
size; then measured speed; then name. See [reference](reference.md#model-records).
