# Three fresh tasks, Swarm against OpenCode under one policy: protocol, registered before any comparative inference

Registered after the development trial of [../protocol.md](../protocol.md) and before any launch
of this stage. The tasks were mined, written and validated with no model
([selection.md](selection.md), [validation.json](validation.json)); the arms, model, limits,
scoring, infrastructure rule and launch order are frozen here and in
[manifest.json](manifest.json). Every launch goes in [../launches.md](../launches.md), entered
before it starts, failed starts included. This file is not edited after the first launch of this
stage; a change of plan is an amendment appended below the line at the end, dated, before the
launch it affects.

## The question

Whether ordinary Swarm, under the same model, the same allowed-change policy, the same checks and
the same wall allowance as OpenCode, delivers a complete, correct source-and-test change where
OpenCode does not, on tasks neither this project's development nor its evaluation has used. The
first comparative milestone is one such task. One win is an initial observation that needs
replication, not a claim about either product in general; a same-model result measures these two
configured systems and says nothing about frontier coding products or other competitors.

## Tasks

Three bug fixes mined from two repositories that appear nowhere in this repository's campaign
corpus, pull-request pools, comparison mirrors or evidence: `motdotla/dotenv` and `sinonjs/sinon`.
Each is a historical upstream commit that changed source and tests; the base is its parent; the
hidden oracle is the commit's own test file, overlaid at scoring; the visible check is a weaker
assertion both arms see; the task text was written from the base's observed behaviour and the
upstream change without naming it ([selection.md](selection.md)). Validated with no model under
the allowed-change policy, the base's checks executed ([validation.json](validation.json)).

| task | repository | work | base | upstream |
| --- | --- | --- | --- | --- |
| `dotenv-bugfix-fast-parser-line-ends` | motdotla/dotenv | a character scanner: colon separators across a line break, `export` as a key, Unicode line separators | `e73dc1f51` | `048dd4863` |
| `sinon-bugfix-stub-accessor-calls` | sinonjs/sinon | wrap stubbed getters and setters in spies, expose them, clear them on reset | `8c663edec` | `002ee82bc` |
| `sinon-bugfix-mock-oncall-expectations` | sinonjs/sinon | per-call behaviours across a method's expectations, indexed by the call's position | `177e318c2` | `40de5a48c` |

Each requires a regression test: the policy counts assertions added in test files, and the
decision rule below requires at least one.

## Configuration, the same for both arms

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192, as the runner configures both arms; one model resident, one request at a time, nothing heavy beside a launch |
| Swarm | commit `96b20a89c`, the build of the development trial (`~/.cache/swarm-comparison/tools/swarm-96b20a89c`, `dist/` tree `sha256:d2c614e8495e...`), ordinary configuration: no workflow flag, legacy prompt, no planned checks, the experimental repair handoff off. Its planning, repair and final verification run inside its wall |
| OpenCode | 1.14.48, configured by the runner as in every earlier launch: edit and shell allowed in the workspace, no web fetch, HOME the launch's own directory |
| permissions | the allowed-change policy of `scripts/comparison/change-policy.mjs`, in the same words in both arms' task text; Swarm's contract makes the policy's protected paths immutable and nothing else |
| checks | the visible check, the project's test command named in the task text (`npm test` for dotenv; `npm run test-node` for sinon, whose `npm test` also drives two browser suites this harness does not provision), the hidden oracle and the policy at scoring |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` at the registering commit, its harness digest in the manifest |
| checkouts | `~/swarm-comparison-work`, a fresh shallow clone of the base per launch |

## Limits, the same for both arms

| limit | value |
| --- | --- |
| task launch | the deadline is set after preparation at 9 minutes and half a second of arm wall; the arm's process group is killed at it, with 59.5 s to confirm the kill, so a launch ends inside 10 minutes. Swarm is handed `--max-wall-minutes 9` and holds its planning, repair and final verification inside it; OpenCode is handed the same deadline |
| aggregate | six launches, at most 54 minutes and 3 seconds of arm wall in all; together with the development trial's launches, at most 90 agent-minutes of inference and failed starts for the whole of this work |
| readiness, bounded apart | the runner's own: before each dispatch at most 2 sequences of at most 90 s, recorded apart |
| tokens | one common safety bound of 8,000,000 per launch, all internal work charged; Swarm enforces it natively, OpenCode's total is recorded; calls that report no usage are named and a total with them is a lower bound |
| corrections | none; no person interacts with either tool |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call. Nothing is raised to obtain a pass |
| spend | no paid API, no model download, no configuration tuning, no server restart unless approved |

## Order, registered now

The runner's frozen order (`scripts/comparison/order.mjs`): tasks by the seeded hash of their
ids, both arms of a task back to back, the first arm alternating with the task's position. With
three tasks one arm goes first twice; the manifest records which. Sequential, nothing else
running.

## Infrastructure rule, registered now

A launch that ends for an infrastructure reason, as the runner classifies it (the endpoint died
or restarted, a model request stalled past the declared deadline, a workspace could not be
prepared, the scorer could not judge, a record could not be written), is recorded as such with
its halt record and may be launched once more after an explicit recovery, if the allowance above
still holds it. An arm's own failure, a wrong patch, a false claim, a timeout at the wall, is
never relaunched. No failure is rerun until a win appears.

## Evaluation, frozen, on each exact delivered tree independently

1. **The hidden oracle** (the runner's `hiddenVerdict`): the allowed-change policy by name, then
   the sealed test file overlaid on a fresh checkout with the exact patch, its argv, and the
   project's test command; a file the patch wrote at the hidden path is displaced and named.
2. **The visible verdict**: the visible check and the project's test command on the exact tree.
3. **The regression test**: the policy's count of assertions added in test files.
4. **Product status**: Swarm's own report, final verification and exit code; OpenCode's exit
   code and whether it claimed success.
5. **Time and tokens**, as the runner records them, readiness apart.

**Decision rule, fixed now.** An arm "delivered a correct change" on a task only if its exact tree
passes 1 and 2, adds at least one assertion under 3, and the arm exited 0 inside the deadline
claiming completion (for Swarm, with its own verdict acceptable). Swarm "won" a task only if it
delivered a correct change and OpenCode did not; OpenCode "won" the converse; both delivering or
neither is a tie. Every task is reported, wins, losses and ties alike, with cost beside, and a
cost difference is not an advantage in correctness. If no task is a Swarm win, that is reported
as no advantage, with a diagnosis and the next capability hypothesis.

## Reported

Per task and arm: the frozen results, the product's status, time and live tokens; then the
decision above per task, the totals, the limits of three pairs on one model and one host, and
the exact commits.

---

## Amendments

### 1. 2026-10-21 04:02 UTC, after launch 5 (order 4): recovery for the one remaining launch

The runner halted after the Swarm launch on `sinon-bugfix-stub-accessor-calls` (order 4): the
product exited 4, which the runner classifies as "the product could not run the task"
(`configuration`), so launch order 5 (OpenCode on the same task) was not dispatched. The product
did run the task: its own output shows a completed run of 57 steps with a changed tree
(`src/sinon/default-behaviors.js`, `src/sinon/stub.js`, `test/src/stub-test.js`), and its exit 4
came from its final verification reading "unmeasured" because its instrument closure treated
the project's own source as the test runner's configuration (the same defect as launch 2's
"unknown" escalation, recorded in the branch's commit `f6e13ca2f`, made after this stage was
frozen and not in the pinned build). That is the arm's own result, not the experiment's
failure: Swarm's attempt stands as recorded in
`sinon-bugfix-stub-accessor-calls.swarm.halted-1.json` and is **not relaunched**. Its kept
workspace is scored with the runner's own verdicts after the fact
(`comparison/scored/sinon-bugfix-stub-accessor-calls.swarm.json`, packed in [../packed-derived/comparison-streams](../packed-derived/comparison-streams/))
and reported beside the others with that provenance named. The campaign is recovered with the
justification above and continued for order 5 only (`--arm opencode`), inside the allowance:
41.9 of the 90 agent-minutes used before it.
