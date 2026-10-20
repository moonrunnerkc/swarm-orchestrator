# Declared files: endpoint readiness, in-task request stalls, and one planned-check trial

Declared before the first edit of this work, on the local branch
`fix/requirement-coverage-and-verification-reserve` at `28efda8d6`, whose product source is
`005d5eb8d`'s. It follows [../requested-example/](../requested-example/README.md), whose second
launch was consumed by a model server that stopped completing inference while its model listing
kept answering. The main checkout's uncommitted work on `v13-main` and the other worktrees are not
touched. Nothing is pushed, merged or published under this work. No protection is changed and no
owner bypass is used.

## What this work does and does not change

The product (`src/`, `packages/`) stays frozen at `005d5eb8d`'s source. The comparison runner and
its fixtures change so that a launch is dispatched only after the pinned model has answered a
bounded chat and tool round trip in the exact wire format the product sends, so that an arm's
model request that has had no answer past a declared deadline ends the launch as an endpoint
failure rather than being consumed as the arm's result, and so that a confirmed endpoint failure
halts the campaign before any later launch. No health-monitoring service, recovery daemon or
automatic restart is added. No planning policy is added.

## Initial declaration

Evidence and records, all new under `docs/evidence/2026-10-19/endpoint-readiness-trial/` (this
directory): what launch 2's records and the model server's log establish; the regressions run
against the starting implementation; the gates on the tested commit; the protocol of the one
planned-check development trial; its ledger, its readiness probes, its launch record and the
scored patch; the recorded recovery of the model server.

Harness, one concern each:

1. The exact wire format, exercised before dispatch.
   - `scripts/comparison/inference.mjs`, `scripts/comparison/inference.test.mjs` (new): a bounded
     inference probe in the product's own request shape (streamed chat completions with usage,
     thinking off, the same tool and tool-result encoding), validating each answer's structure,
     with a hard per-request deadline, a sequence deadline, bounded output, no side effects, no
     repository task; and the lease that refuses a probe while an arm's request is in flight.
2. An arm's request watched without a competing request.
   - `scripts/comparison/stall.mjs`, `scripts/comparison/stall.test.mjs` (new): reads the Swarm
     arm's own event stream for a model call that has had no answer past the declared deadline.
   - `scripts/campaign/exec.mjs`: a command's stdout can be observed as it arrives (an optional
     callback; nothing else changes).
3. Dispatch, halt and recovery.
   - `scripts/comparison/run.mjs`: readiness before dispatch within its allowance, the lease held
     during an invocation, the stall watch ending a stalled invocation as an endpoint failure, a
     probe after the arm is stopped recorded beside it, every probe and its usage recorded in the
     attempt record and the halt, recovery requiring readiness too, and the new budgets frozen.
   - `scripts/comparison/schema.mjs`: the probe records on the attempt, halt and recovery records
     and the probe totals, all optional so earlier records stay valid.
   - `scripts/comparison/control.mjs`: the recovery's readiness, if the revalidation is where it
     belongs.
4. The proof without a live model.
   - `scripts/comparison/fixtures/endpoint-server.mjs`: controlled chat behaviours (listing only,
     chat never answering, plain chat only, a complete round trip, a malformed or cut stream, a
     slow healthy answer, a server that stops answering after N requests) and a request log.
   - `scripts/comparison/fixtures/arm.mjs`: a behaviour that sends one real request to the
     endpoint it was given and reports it in the product's event shape.
   - `scripts/comparison/run.test.mjs`: the cases through the real runner.
   - `scripts/comparison/endpoint.test.mjs`, `scripts/comparison/control.test.mjs`: where their
     modules' behaviour changes.

Documentation: the runner's own header and the comparison protocol's successor in this directory.
`README.md` at the repository root is not expected to change; `CHANGELOG.md` is the product's and
is not expected to change.

## Amendments

(none yet)
