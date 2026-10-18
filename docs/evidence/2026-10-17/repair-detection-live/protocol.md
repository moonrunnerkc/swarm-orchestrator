# Live repair and detection, 2026-10-17 (night): protocol

Registered before the first launch of this work. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts. This file is not edited after the first
launch; a change of plan is an amendment appended below the line at the end, dated, before the
launches it affects. The earlier protocols and results stand unchanged:
[../repair-trust-live/](../repair-trust-live/protocol.md) and
[../planned-check-live/](../planned-check-live/protocol.md).

## Status

**Development records on an exposed task.** The mime task, its retained faulty patch and the
evaluator's audit are known to the people developing Swarm, and the task is a public change that
may be in the model's training data. Nothing here is fresh or comparative evidence, except the
paired comparison in step 5, which is registered by amendment before it runs and uses a task not
used to tune this work.

## Allowance and accounting

- **At most eight model-powered launches or 120 agent-minutes, whichever comes first**, each with a
  15-minute end-to-end ceiling. Agent minutes are the product invocation's own wall, from spawn to
  exit or kill, and include planning, implementation, every repair and the product's final
  verification. Workspace preparation, builds and the evaluator's scoring are reported apart.
- One process owner: the session that registered this protocol starts every model-powered launch
  and keeps the ledger. No auditing or delegated work starts a model. A launch started by
  mistake, and a launch attempt that fails before reaching a model, are counted and entered.
- Local only: Ollama 0.32.14 at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b`, already on
  the machine. No paid API, no model download. One model resident, one request at a time, one
  launch at a time, and no test suite running beside a launch.
- Each record names the exact product commit, built into its own directory with `npm ci` and
  `npm run build` before the launch.

### Allocation

| launches | purpose | condition |
| --- | --- | --- |
| 1 | R: live repair with a supplied counterexample | none |
| 1 | R, once more | only after a concrete blocker in R's trace is identified and a justified correction lands |
| 1 | D: seeded detection and repair | after the relation-check mechanism passes its deterministic development tests |
| 1 | D, once more | as for R |
| 1 | O: an ordinary mime run from the original base, nothing injected | D met its milestone |
| 2 | C: one fresh paired comparison, Swarm and OpenCode | R, D and O met their milestones; registered by amendment first |
| 1 | infrastructure recovery | a launch invalid for an infrastructure reason (server down, out of memory, driver failure), investigated and entered first |

A launch that ran as designed and failed is a result, not a reason to launch again. An
experiment's second launch requires the ledger entry to name the blocker found in the first
launch's trace (failure comprehension, tool execution, incorrect editing, lost feedback, repeated
ineffective work, or budget allocation), the correction, its regression test where one applies,
and the commit. More tokens or another draw of the same build is not a correction.

## R: live repair with a supplied counterexample

By [run.mjs](run.mjs) `--mode supplied`. The workspace is prepared as the comparison launcher
prepares it (`scripts/comparison/workspace.mjs`). The proxy answers the first implementation loop
with the retained faulty patch's files; nothing else is scripted. The supplied contract holds the
visible check and the developers' counterexample ([counterexample.mjs](counterexample.mjs)),
validated before any launch to fail on the base and on the retained faulty patch and to pass on the
upstream fix ([counterexample-validation.json](counterexample-validation.json)). No
`--plan-checks`.

This is **live repair with a supplied counterexample**. It says nothing about whether Swarm finds
the omission on its own.

Met when all of:

- the acceptance gate refused the injected candidate on the counterexample, and a live repair ran;
- no person and no scripted response supplied code after the injected candidate;
- the product's final verification of the exact delivered tree passed the visible check, the
  counterexample and the project's tests (outcome `accepted`);
- the evaluator accepts the exact final patch: the frozen oracle with the 113-case audit
  ([score.mjs](../repair-trust-live/score.mjs)), run apart from the launch.

If it is not met, the trace is read for the first concrete blocker before anything else is
changed.

## D: detection and repair together

By [run.mjs](run.mjs) `--mode seeded`: the same injected candidate, the visible check only, and
`--plan-checks`. The planner receives the ordinary task, the repository and the product's general
instructions; the retained patch, the upstream change, the audit and anything evaluation-only stay
out of its requests (checked on the recorded requests by
`../planned-check-live/scan-exposure.mjs`). Its build is the commit carrying the relation-check
mechanism, named in the ledger before the launch.

Recorded apart, each yes or no with its record: whether a useful property or check was proposed;
whether it executed correctly; whether it found a real omission (it rejects the retained faulty
patch and accepts the upstream control, read by `../planned-check-live/verify-checks.mjs`);
whether the finding reached the worker clearly (the repair brief carries the failing case);
whether repair succeeded; whether preserved behaviour stayed intact; whether the final artifact
passed the evaluator; and what the product reported.

Met when a generated check found the omission, a live repair fixed it, the product's final
verification passed the visible check and the project's tests, and the evaluator accepts the exact
final patch. The product's outcome for such a run is expected to be `unresolved` if a generated
check still disagrees, and `accepted` otherwise (the visible check decides; the planner's
requirements are hypotheses). That is reported as it is.

## O: ordinary run

By [run.mjs](run.mjs) `--mode ordinary`, only if D was met: nothing injected. Read by the same
evaluator. A seeded repair success alone does not establish ordinary task completion.

## Records

Raw exchanges, stdout, stderr and ledgers are packed with `scripts/evidence-pack.mjs` before commit.
The repository's weight headroom is 6.6 MB against 6.0 MB required, so a launch's streams are
packed rather than committed loose.

---

## Amendments

### 1. 2026-10-18, after launch 1, before launch 2

- **R's second launch** runs on a build whose only change touching a supplied-checks run is the
  repair brief carrying a bounded diff of the current change against the base, the correction
  launch 1's trace justifies ([launches.md](launches.md)). The supplied contract, the
  counterexample and every setting stay as they were. The same build also carries the relation
  check, which a run without `--plan-checks` never invokes.
- **The driver** now copies the planner's `declare_planned_relation` calls with its
  `declare_planned_check` calls when it captures the planning chain (`run.mjs`). Nothing it sends
  to the product changed.
- **The relation check's development tests** (no model) are recorded before D: the
  assignment-parser fixture in `src/workers/planned-check-program.test.ts`, and the mime fixture
  in [relation-development-test.json](relation-development-test.json) by
  [validate-relation.mjs](validate-relation.mjs). A developer chose that relation and its seeds
  knowing the omission; it shows the mechanism works there, not that a planner will propose it.
