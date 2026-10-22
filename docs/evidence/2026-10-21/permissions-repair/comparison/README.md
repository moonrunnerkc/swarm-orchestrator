# Three fresh pairs under one policy: no Swarm win, no OpenCode win, 2026-10-21

Registered in [protocol.md](protocol.md) before any comparative inference; the tasks chosen by
the rule in [selection.md](selection.md); every launch in [../launches.md](../launches.md). Swarm
is build `96b20a89c` in its ordinary configuration; OpenCode is 1.14.48; both on
`qwen3.6:35b-a3b` through the local Ollama, the same task text, visible check, allowed-change
policy and limits, in the runner's counterbalanced order. The records are packed in
[packed-derived/records](packed-derived/records/); [results.md](results.md) is the runner's own
rendering of them; the streams, Swarm's three run ledgers, the traces and the after-the-fact
scoring are in [../packed-derived/comparison-streams](../packed-derived/comparison-streams/).

## Decision

**Under the frozen rule no task is a Swarm win and none is an OpenCode win.** A delivery needed a
tree that passes the hidden oracle, the visible check and the project's test command, at least
one assertion added, and an exit 0 with a completion claim. No launch met all of it.

| task | Swarm | OpenCode | reading |
| --- | --- | --- | --- |
| `sinon-bugfix-mock-oncall-expectations` | correct tree (hidden pass, visible pass, project tests pass), **no test**, exit 1 `not accepted` | correct tree, **no test**, exit 0, claimed | tie: both fixed the bug, neither wrote the regression test the task asked for; Swarm's exit 1 was its own defect over a green tree |
| `dotenv-bugfix-fast-parser-line-ends` | fail: visible check passes, 4 project assertions fail, hidden cases fail; no test | fail: killed at the wall, visible and hidden fail; no test | tie: neither delivered |
| `sinon-bugfix-stub-accessor-calls` | **correct source-and-test tree** (hidden pass, visible pass, project tests pass, 18 assertions added), scored after the fact; exit 4 "unavailable", no claim | nothing changed, exit 0, success claimed | tie under the rule: Swarm's tree is the only complete delivery of the stage, and the product reported it as not runnable |

What the stage shows about delivered code: Swarm produced two correct source trees and one
complete source-and-test change; OpenCode produced two correct source trees, no test, and one
empty tree claimed as done. What it shows about reporting: Swarm never claimed a tree the oracle
rejects; OpenCode claimed one. What it shows about the product: on both sinon tasks Swarm's own
verdict was wrong in the pessimistic direction, for one cause, found and fixed after the freeze
(commit `f6e13ca2f`, with a regression that replays sinon's shape): its instrument closure read
the project's own source as the test runner's configuration, so a passing lint was withheld (the
mock task, never green, "unknown" escalation, exit 1) and a passing test suite was withheld once
the agent's own new tests made the base's restored source fail (the accessor task, "unmeasured",
exit 4). The comparison ran under the defect; its numbers stand as recorded.

## Costs

| | Swarm | OpenCode |
| --- | --- | --- |
| arm wall, three launches | 22.2 min (8.2, 8.1, 5.9) | 16.0 min (2.6, 9.0 killed at the wall, 4.4) |
| tokens, as the server counted them | 6,937,087 minus the development launch: 4,944,908 (0 unknown calls) | 3,016,952 (0 unknown calls) |
| correct trees by the oracle / launches | 2 / 3 (the accessor tree scored after the fact) | 2 / 3 |
| complete source-and-test changes | 1 (accessor) | 0 |
| false completion claims (a claim over a tree the hidden oracle rejects) | 0 | 1 (accessor: nothing changed, success claimed; the dotenv launch was killed and claimed nothing) |

A cost difference is not an advantage in correctness.

## What this does not show

- Nothing about either product in general, nor about frontier coding products: one local model,
  one host, three tasks, one launch per arm.
- Whether Swarm would have won the accessor task with the instrument fix in the build: under the
  rule it needed exit 0 with a claim, and the fix is what would have let the product accept the
  tree it had. That is the next hypothesis, not a result, and it needs a fresh freeze and a fresh
  task.
- Why neither arm wrote a test on the mock task when the task text and the policy asked for one;
  the model is the same on both sides.

## Infrastructure

One halt, one recovery ([protocol.md](protocol.md), amendment 1): the runner read Swarm's exit 4
as "could not run the task" and stopped before the last OpenCode launch; the product had run the
task, so Swarm's attempt stands as its result and only the undispatched launch was continued.
Launch records: [packed-derived/records](packed-derived/records/) (`halt-1.json`,
`recovery-1.json` beside the cells).

## Corrections, 2026-10-21 (later the same day)

Appended; nothing above is edited and the records and frozen scores stand. The full list is in
[../README.md](../README.md), "Corrections", and the audit in
[../../accessor-audit/README.md](../../accessor-audit/README.md).

- "OpenCode produced two correct source trees": one. The mock task passed the hidden oracle;
  the dotenv task failed it; the accessor task changed nothing. The cost table's "correct trees
  by the oracle" reads 2 / 3 for Swarm (one of them scored after the fact) and 1 / 3 for OpenCode.
- "OpenCode claimed one" tree the oracle rejects, and the accessor row's "exit 0, success
  claimed": the stream shows no claim. Its two turns ended wanting tool results, the last after
  a refused read of a mistyped path outside the workspace; the runner's one-word reading took a
  progress message for a claim. False completion claims in this stage: 0 and 0.
- "Swarm's tree is the only complete delivery of the stage": complete against every check
  that existed, and not against the task's own sentence. Its exposed accessors are proxies
  without the spy surface the task named (`withArgs` throws). The oracle pass stands.
- The decision is unchanged: under the frozen rule no task is a Swarm win and none is an
  OpenCode win. The task text both arms received permitted a regression test and did not
  require one; the rule required one. The prompt now names every scored deliverable.
- [results-supplemented.md](results-supplemented.md) renders the same records with launch 6's
  after-the-fact score in its row, marked as supplemental scoring; [results.md](results.md) is
  the runner's original rendering and is unchanged.
