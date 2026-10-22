# Two fresh mocha tasks, Swarm against OpenCode: protocol, registered before any task inference

Registered after the correction of the task-continuation trial
([../task-continuation/README.md](../task-continuation/README.md), section 6) was committed and
its gates and release checks were run, and after the two tasks were selected, written, audited
for exposure and validated with no model ([selection.md](selection.md),
[exposure-audit.md](exposure-audit.md), [validation.json](validation.json),
[reference-feasibility.json](reference-feasibility.json), [sensitivity.md](sensitivity.md)).
Every launch goes in [launches.md](launches.md), entered before it starts, failed starts
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launch it affects.

## The question

On two small bug fixes neither product has seen, under the same model, the same task words, the
same starting tree, the same writable scope, the same visible checks and the same wall, which
product delivers the better artifact, what each reports about it, and at what cost. Two pairs
cannot establish general superiority; they can show a narrow, checkable difference or where
Swarm still falls short. A same-model result measures these two configured systems on one host
and says nothing about other models or products.

## Tasks, selected by a rule fixed before they were read

The `validated` entries of [../delivery-trial/candidates.json](../delivery-trial/candidates.json)
in their listed order, each used only if it still met that file's own rule on this host and passed
the exposure audit; the first two that did are the tasks ([selection.md](selection.md)). Both did,
so the third (`35413b661`) is unused.

| task | repository | base | upstream | the work |
| --- | --- | --- | --- | --- |
| `mocha-bugfix-long-prefix-short-alias` | mochajs/mocha | `bb2e69a95` | `12279398f` | a one-character option alias written with two dashes reads as that option, with its value next or after `=` |
| `mocha-bugfix-unparse-attached-values` | mochajs/mocha | `e5a779eb4` | `15aa7d155` | options unparsed for a child process are emitted as one `--name=value` argument, so an unknown option's value is never read as a spec |

The task text, visible check and hidden material are those of `scripts/comparison/tasks.mjs` at
the registering commit. Each text states the required behaviour with examples, what must not
change, where the source is, the project's test command, and one explicit deliverable beyond the
fix: "Add regression tests for this behaviour to the project's existing test suite."

## Exposure, as audited ([exposure-audit.md](exposure-audit.md))

No mocha task was registered, launched or prepared before this stage; the candidate commits are
named in this repository only in `candidates.json`. Three facts are not exclusions and are
registered as they are: the full mirror `~/.cache/swarm-comparison/mirrors/mochajs__mocha.git`
(created for the candidate validation) holds both upstream commits and is readable by any process
of this user, as this repository's hidden checks are; each arm works in a depth-1 clone of the
base with no remote, which holds neither upstream object; and the upstream fixes are public, so
the model may have seen them in training. After each launch the arm's whole output stream is
searched for the mirror's path, this repository's path and the upstream commit ids; a hit is
reported with the launch, and the launch's artifact score is then reported as exposed.

## Configuration, the same for both arms

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192, as the runner configures both arms; one model resident, one request at a time, nothing heavy beside a launch |
| Swarm | commit `736251101` (its product code is that of `099558499`, the corrected product, and the commit adds only this stage's task registration), cloned into `~/.cache/swarm-comparison/tools/swarm-736251101` and built there with `npm ci` and `npm run build` on Node v24.15.0: `dist/cli.js` `sha256:3503870a31f1...`, `dist/evidence/run-assessment.js` `sha256:a81ceb3e740c...`, 864 files under `dist/`, pinned in [manifest.json](manifest.json): the product with `run-acceptance-v5` and the unknown-usage count, frozen. Ordinary configuration: no workflow flag, legacy prompt, no planned checks, the experimental repair handoff off. Its planning, repair, continuation and final verification run inside its wall |
| OpenCode | 1.14.48, configured by the runner as in every earlier launch: edit and shell allowed in the workspace, no web fetch, HOME the launch's own directory |
| task words | the runner's `taskPrompt`, identical for both arms: the task text, the visible check and its command, the project's test command, and the allowed-change policy of `scripts/comparison/change-policy.mjs` |
| starting tree and scope | a fresh depth-1 clone of the base with the visible check committed; the policy's protected paths (the visible check's directory and the runner's configuration files) are immutable for both; Swarm's contract makes them immutable and nothing else |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` at the registering commit, its harness digest in the manifest; the endpoint-readiness check before every dispatch and the stall watch during it, as built |

## Limits, the same for both arms

| limit | value |
| --- | --- |
| launches | at most four task launches in this stage: the two pairs, nothing else |
| wall | each launch's deadline is set after preparation at 9 minutes and half a second of arm wall; the arm's process group is killed at it with 59.5 s to confirm the kill. Swarm is handed `--max-wall-minutes 9` and holds its planning, repair, continuation and final verification inside it (the harness adds no verification time: `swarmVerificationReserveMs` 0); OpenCode is handed the same deadline |
| agent-minutes | at most 60 of inference and failed starts in all, counted in [launches.md](launches.md) |
| readiness | the runner's own, at most 2 sequences of at most 90 s before each dispatch, recorded apart |
| tokens | one common safety bound of 8,000,000 per launch; Swarm enforces it, OpenCode's total is recorded; a call with no reported usage is named and a total with one is a lower bound |
| corrections | none; no person interacts with either tool, and no evaluator result reaches a worker |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts with the continuation among them, 8192 output tokens per call. Nothing is raised |
| spend | no paid API, no model download, no configuration tuning, no server restart unless approved |

## Order, registered now

The runner's frozen order (`scripts/comparison/order.mjs`): tasks by the seeded hash of their
ids, both arms of a task back to back, the first arm alternating with the task's position, so one
pair starts with Swarm and the other with OpenCode. The manifest records which. Sequential,
nothing else running.

## Failure handling, registered now

A launch that ends for an infrastructure reason, as the runner classifies it (the endpoint died
or restarted, a request stalled past the declared deadline, a workspace could not be prepared, the
scorer could not judge, a record could not be written), is recorded with its halt record and
counts against the four launches. It is not relaunched: the stage has no launch to spare, and the
pair is then reported as incomplete with the reason. After a halt the runner is recovered with a
recorded justification only to continue to the next registered launch. An arm's own failure (a
wrong or empty patch, a false claim, a stop at the wall, an exit the product chose) is a result
and is never relaunched. Nothing is rerun for a more favourable result.

## Scoring, frozen now, on each exact delivered tree

Every arm is scored on the patch the runner extracted from its workspace at exit or kill,
whatever the arm reported. A completion statement is not required for scoring and is not proof
of anything.

**A. Artifact quality.**

1. The hidden oracle (the runner's `hiddenVerdict`): the allowed-change policy by name; the
   upstream test file overlaid on a fresh checkout with the exact patch and run by its argv; the
   hidden behaviour check (every example the task text states, required and unchanged:
   [hidden/](hidden/)); the project's test command. A file the patch wrote at the hidden path is
   displaced and named.
2. The delivered tree's own reading (the runner's visible verdict): the visible check and
   `npm run test-node:unit` on the exact tree, its own tests included.
3. Regression tests ([score-tests.mjs](score-tests.mjs)): every test the patch adds to a test
   file it writes (by full title, against the base's version of the file), run on the delivered
   tree and over the base's source with the delivered file overlaid. A meaningful regression test
   passes on the delivered tree and fails over the base's source. The policy's assertion count is
   reported beside it.

An artifact is **correct** where 1 and 2 pass, and **complete** where it is also correct and adds
at least one meaningful regression test under 3. One artifact is **better** than the other on a
task where it is complete and the other is not, or correct and the other is not; otherwise the
two are equivalent on that task, and the numbers under 3 are reported, not ranked.

**B. Product delivery behaviour.** Exit code; lifecycle; whether the product claimed completion
(the runner's `completionAccount`, which for Swarm reads its own lifecycle); Swarm's verdict and
outcome status; whether the report is accurate against A (a success claim over an incorrect
artifact is a wrong success claim; a refusal of a complete artifact is a conservative refusal;
both are findings) and what it said about the regression tests and any continuation.

**C. Cost.** Arm wall from spawn to exit or kill; input and output tokens as each product
reported them, with calls of unknown usage named and the total marked as a lower bound where any
exist; human interventions (none are allowed; any needed is reported). Readiness and the
external scoring above are recorded apart and not charged to either arm.

**Swarm's repair.** From Swarm's ledger: whether a repair or continuation ran, and its first
candidate rebuilt with [reconstruct-first.mjs](reconstruct-first.mjs) (validated on the
task-continuation launch 2, whose first-candidate digest it reproduces:
[tool-validation/](tool-validation/)) and scored by 1 to 3 like a delivered tree. Repair
**improved** the artifact where the first candidate is not correct or not complete and the
delivered tree is; **preserved** it where both read the same; **damaged** it where the first was
and the delivered is not. A first candidate the replay does not reproduce to its recorded digest
is reported as not reconstructed, never scored.

**Decision rule.** Per task: the better artifact under A, or equivalent. Swarm's additional
machinery is credited with an improvement only where its delivered tree is better than its own
first candidate (repair improved it) or better than OpenCode's tree, and the report names which.
If both products deliver equivalent artifacts and Swarm costs more, that is reported as the
result. Both pairs are run before anything is concluded.

## Reported

Per task and arm: A, B and C, the repair reading, the exposure search; then per task the better
artifact or equivalence, the cost of any improvement, and what two pairs cannot show.

---

## Amendments

### 1. 2026-10-21 21:40 UTC, after launch 0: the Swarm attempt stands; the remaining three launches run as registered

Launch 0 (Swarm, `mocha-bugfix-unparse-attached-values`) exited 4 after 324.5 s and 148,823
tokens, and the runner halted the campaign, classifying the exit as "the product could not run
the task" (`configuration`). The product did run the task: 14 steps, a changed tree
(`lib/cli/unparse-args.js` and four regression cases added to
`test/node-unit/cli/unparse-args.spec.js`). Its exit came from its own reading: mocha runs its own
tests, so the product marked its build and tests gates as measured by an instrument the change
altered (`n/a`), its final verification as unmeasured, its sealed acceptance gate as failed
("the inspection exited 1"), and escalated after 0 of 3 repair attempts. Under the failure
handling registered above, an exit the product chose is the arm's result: the attempt stands as
recorded in `mocha-bugfix-unparse-attached-values.swarm.halted-1.json` and is **not relaunched**.
Its kept workspace's patch is scored after the fact with the runner's own verdicts and this
stage's scorers, with that provenance named. No product code changes before the remaining
launches. The campaign is recovered (`recovery-1.json`) and continued with
`--only mocha-bugfix-unparse-attached-values --arm opencode` (launch 1), then
`--only mocha-bugfix-long-prefix-short-alias` (launches 2 and 3, in the frozen order), so that
launch 0 is not dispatched again. 5.4 of the 60 agent-minutes and 1 of the 4 launches are used.
