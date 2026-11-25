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
   user's tree.
2. **Requirements** (`src/agent/requirement-record.ts`). R1 is the task, verbatim. Items of a
   list in the task and `--require` quotes become further required requirements. Version
   constraints and a request for tests are read from the wording by code. This set is fixed
   before the first edit. The model can add suggestions; it cannot change, drop or downgrade
   anything required.
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

- The path policy is lexical. It is not an operating-system sandbox, and an allowed interpreter
  can run code the model wrote.
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
