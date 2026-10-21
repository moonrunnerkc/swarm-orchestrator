# Development trial of the task continuation on the exposed accessor task: protocol, registered before any inference

Registered after the deterministic work of this follow-up was committed and verified: the two
delivery failures of the 2026-10-21 development trial established from their published records
([README.md](README.md), sections 1 and 2), the continuation and the lifecycle rule implemented
with their regressions (commit `87b6f294e`), and the full suite, typecheck and lint green on
that commit. No model was involved in any of that. Every launch goes in
[launches.md](launches.md), entered before it starts, failed starts included. This file is not
edited after the first launch; a change of plan is an amendment appended below the line at the
end, dated, before the launch it affects.

## The question

Whether ordinary Swarm, with the continuation of an interrupted task loop and the lifecycle rule
of `87b6f294e`, produces a complete implementation and meaningful tests on
`sinon-bugfix-stub-accessor-calls-v2`, satisfies the independently audited API requirement, and
finishes with a product verdict and report consistent with the delivered tree. The task is
exposed development material: it was launched twice on 2026-10-21
([../delivery-trial/](../delivery-trial/)), its upstream change, both launches' patches, the
audit and the hidden check are in this repository, and the correction under trial was designed
from launch 2's trace. A success here is a development result about a delivery path, not a
comparison and not evidence of general superiority. Only after it succeeds is the product frozen
and run against OpenCode on tasks neither has seen ([fresh pairs](#after-a-success-the-fresh-pairs)).

## Task

`sinon-bugfix-stub-accessor-calls-v2`, in `scripts/comparison/tasks.mjs`, byte-identical to its
registration at `d2437c430` (checked with `git diff d2437c430 87b6f294e -- scripts/comparison/tasks.mjs`,
empty): sinonjs/sinon base `8c663edec`, upstream `002ee82bc`, the task text naming the spy
surface, the hidden material carrying the sealed upstream `test/src/stub-test.js` and the audit's
API check written into the scoring checkout under `acceptance/hidden/` and run there, never in
the worker's workspace. The worker is given the task text, the visible check, the test command,
the deliverables and the allowed-change policy, in the same words OpenCode would receive
(`taskPrompt`). It is given nothing of the upstream patch, the published patches, the audit, the
hidden test file, the API check, or this follow-up's reconstruction of the earlier launches.

## What is under trial, and what is not

Under trial: the product's own continuation of a task loop that stops at its step limit (one
attempt from the same cap, given once the gates are green, under the ratchet), and the lifecycle
and report that go with it. Not under trial: the step cap (40, the product default, not raised),
the attempt cap (3), the model, the prompt, the task text, the harness's scoring. Nothing is
tuned to this task: the continuation's brief names no project, file or kind of deliverable
(`src/task-continuation.ts`), and the product's test account counts from the files' text and
runs nothing it cannot attribute.

## Configuration

| what | value |
| --- | --- |
| model and server | Ollama at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192, as the runner configures it; one model resident, one request at a time, nothing heavy beside the launch. The server's version is recorded in [launches.md](launches.md) with the launch |
| Swarm | commit `87b6f294e`, cloned into `~/.cache/swarm-comparison/tools/swarm-87b6f294e`, built there with `npm ci` and `npm run build` on Node v24.15.0; `dist/cli.js` `sha256:3503870a31f1...`, pinned in [manifest.json](manifest.json). Ordinary configuration: no workflow flag, no planned checks, the experimental repair handoff off; its planning, repair, continuation and final verification inside its wall |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` at the registering commit, its harness digest in the manifest; the harness reads the product's own lifecycle before it counts a completion claim (`completionAccount`, `87b6f294e`) |
| checkouts | `~/swarm-comparison-work`, a fresh shallow clone of the base per launch with the visible check committed |

## Limits

| limit | value |
| --- | --- |
| launches | at most two development launches, of at most 10 minutes each (9 minutes and half a second of arm wall, the kill confirmed inside 59.5 s). A second launch requires a reproduced defect and a named correction, recorded as an amendment here before it; it is never a retry of the same configuration hoping for a better answer |
| readiness | the runner's own: at most 2 sequences of at most 90 s before dispatch, recorded apart |
| tokens | the common safety bound of 8,000,000 per launch |
| corrections | none; no person interacts with the tool, and nothing edits its candidate |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts (the continuation among them), 8192 output tokens per call. Nothing is raised to obtain a pass |
| this stage's whole allowance | at most six live launches and 60 agent-minutes of inference and failed starts: the development launches and the fresh pairs together, counted in [launches.md](launches.md) |
| spend | no paid API, no model download, no configuration tuning, no server restart unless approved |

## Evaluation, frozen, on the exact delivered tree

1. **Artifact correctness**: the runner's hidden verdict: the allowed-change policy by name, the
   sealed `test/src/stub-test.js` overlaid (a file the patch wrote there displaced and named), its
   argv, then the hidden API check (`node acceptance/hidden/api-check.mjs`), then the project's
   test command. Validated before the first trial ([../delivery-trial/validation.json](../delivery-trial/validation.json),
   [../accessor-audit/api-check-validation.json](../accessor-audit/api-check-validation.json)).
2. **The visible verdict**: the visible check and `npm run test-node` on the delivered tree, its
   own test files included.
3. **Test quality**: the policy's count of assertions added in test files (at least one), and,
   read from the delivered tree with no model by [check-trees.mjs](check-trees.mjs)'s method,
   whether the added cases fail on the base's source with the delivered tests overlaid and pass
   on the delivered source. A larger assertion count alone establishes nothing.
4. **Product verdict and report**: Swarm's own report, final verification, result line and exit
   code; correct where the product accepts a tree that passes 1 and 2 and refuses one that does
   not, and where its lifecycle, continuation line and regression-test line agree with the
   delivered tree (a loop that stopped at its limit reported as such; a test file the tree does
   not have never reported as added).
5. **Delivery**: all of 1 to 4, the arm exited 0 inside the deadline with its own verdict
   acceptable, its lifecycle `completed`, and its completion account reading `claimed`.
6. **Continuation and repair**: from the run's ledger, whether the first loop stopped at its step
   limit; whether a continuation was given, as which attempt, and what the ratchet made of it;
   the first candidate against the delivered tree, source edits and test edits counted apart;
   whether repair or continuation turned a failing or incomplete candidate into a complete one,
   preserved it, or damaged it.
7. **Time and tokens**: the arm's wall from spawn to exit or kill; readiness, scoring and cleanup
   apart; every token as the server counted them, any call without usage named.

**Decision rule, fixed now.** The delivery path "succeeded" only if item 5 holds. Anything less
is reported as not delivered, item by item, with the earliest actionable failure named from the
trace. Nothing in this trial is a comparison. A first loop that finishes on its own inside 40
steps, so that no continuation is owed, is a valid outcome of the trial and says nothing about
the continuation; the report says so.

## If it fails

The earliest actionable failure is read from the run's ledger and named. A second launch follows
only a defect reproduced with no model (a replay or a regression test) and corrected and
committed, with the build re-pinned, recorded as an amendment here before it. A second launch of
the same configuration is not made.

## After a success: the fresh pairs

Only if item 5 holds: the product is frozen at `87b6f294e` and two Swarm/OpenCode pairs run on
tasks neither arm nor this project has launched before, registered in a protocol of their own
before any inference, with every deliverable stated, checks, permissions, model, versions,
budgets and failure handling frozen, evaluator sensitivity and reference feasibility validated,
task-relevant behaviour preservation checks beyond the supplied examples, the launch order
counterbalanced, the same local model and equal wall allowances, planning, repair, continuation
and verification counted inside Swarm's wall. Candidates validated with no model
([../delivery-trial/candidates.json](../delivery-trial/candidates.json)): three mochajs/mocha
fixes. Exposure audited before registration: no mocha task has been registered in
`scripts/comparison/tasks.mjs`, launched, mirrored or prepared on this machine, and none of the
three commits is named anywhere in this repository but that candidates file.

---

## Amendments
