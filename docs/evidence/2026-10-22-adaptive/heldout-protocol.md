# Held-out block 1, registered before its first launch

An initial transfer test of four fresh tasks. It is not the broad portfolio and supports no broad
superiority claim. Task selection followed [the registered rule](heldout-selection-rule.md); the
selection record and the public summary of each task are in [heldout/](heldout/).

## Tasks

| Task | Family / workType | Repository | Base | Authored files in the reference |
| --- | --- | --- | --- | --- |
| `p-limit-bugfix-limit-function-clear-queue` | bug fix / bugfix | sindresorhus/p-limit | `df476048d` | 4 |
| `p-limit-feature-reject-on-clear` | feature / feature | sindresorhus/p-limit | `ce9d71cf1` | 4 |
| `fastify-refactor-kebab-case-file-names` | behavior-preserving refactor / refactor | fastify/fastify | `91414feca` | 27 (11 renames) |
| `p-queue-compat-remove-throw-on-timeout` | API compatibility / feature | sindresorhus/p-queue | `62efb742e` | 5 |

Selection: the registered rule's inventory order over the three JavaScript repositories, with
the evaluator author's span guard (a candidate is skipped when taking it would leave three
repositories unreachable) and the amended history rule for the refactor and compatibility
families; [heldout/selection-record.md](heldout/selection-record.md) lists every rejection. The
two p-limit tasks are distinct changes of one repository. The block spans three repositories.
None of these repositories commits a lockfile (`package-lock=false`): every arm's workspace is
installed by the runner with `npm install --ignore-scripts --before=2026-10-22T00:00:00.000Z`,
and Swarm arms run without `--install`. None declares a lint script; their `npm test` runs xo or
eslint, so the project tests carry the static check. The p-queue hidden behavior check was
corrected by the evaluator author before registration (a concurrency expectation that counted
timed-out bodies p-timeout leaves running; it now reads the queue's own running count) and the
task was revalidated against every control.

Hidden evaluators, reference patches and faulty controls were prepared by a separate evaluator
author (a delegated agent working only in a sealed directory, reporting outcomes without sources) with no model inference, and stay under a root every arm's execution profile denies until
the block's last launch is scored. Their SHA-256 digests are registered in `heldout/public-summary.json`.
Each evaluator fails the base, passes the reference and fails at least two deliberately faulty
controls, and checks preserved behavior beyond the task text's examples.

## Arms

All on `qwen3.6:35b-a3b` through the local Ollama endpoint; Swarm arms from one pinned build
(`git archive` of `299dac547`, whose source equals `ef3972acb`; the build-tree digest is in the manifest):

1. `swarm`: revised Swarm, `--adaptive`, the product's default repair attempts.
2. `swarm-control`: the same build without `--adaptive`, so the block also measures the decision
   point on fresh tasks (an addition to the assignment's three arms, registered here).
3. `swarm-direct`: internal ablation, `--attempts 0`: Swarm's worker loop, tools, contract and
   execution profile with repair, continuation and the decision point removed. It is an internal
   ablation, not an independent competitor.
4. `opencode`: OpenCode 1.19.4 run by absolute path with edit and shell permitted in the workspace
   and web fetch denied, the same model and endpoint.

Same task text, visible check, contract text and allowed-change policy for every arm. Effective
file permissions are equal: every arm runs under the same Seatbelt profile, which denies the
hidden material, the mirrors with reference commits, other launches, the project's checkouts,
agent transcripts and earlier study caches; the product's own policies sit inside it. Network is
not restricted for any arm, so public upstream history is reachable by every arm alike; every
arm's output is scanned for the upstream commit and sealed paths.

## Resources and order

720,500 ms of launch wall per launch for every arm; Swarm arms are given 60,000 ms of it as their verification reserve, so their own wall ends before the deadline and their verdict is recorded (development runs lost two Swarm verdicts to deadline kills); 8,000,000 Swarm tokens as a safety
ceiling; 40 steps per Swarm loop; no external corrections. Sixteen launches, one at a time, tasks
in the seeded order and arms rotated by task position so each arm goes first on one task. Ceiling:
192 agent-minutes (16 launches) of launch wall plus preparation and scoring, local only, paid
inference $0. Every launch runs whatever the others delivered.

Before the first launch: the neutral smoke passes on the frozen build for all four arms. A launch
stopped before its arm's first model request is a zero-inference setup failure, recorded apart and
retried with the same arm and task after a recorded correction, at most twice. Once the arm has
made a model request its outcome stands; no retry because an artifact failed.

## Scoring and report

Primary: complete delivery, meaning the hidden evaluator passes (upstream tests, behavior and
preservation cases, allowed-change policy), the visible check and project tests pass, the project
lint passes where it passes on the base, and the change includes the tests the task asks for.
Also reported: product verdict accuracy, initial versus delivered candidate, repair gain and
damage, preservation failures, wall, inference usage including unknown calls, verification
overhead, and human intervention. Pairs (each Swarm arm against each other arm) are reported as
wins, losses, ties, incomplete pairs and infrastructure failures, per task. Four tasks and single
samples support counts only, no significance claim. Hidden evaluation results are not read
until the block is complete; any product change made after reading them makes these tasks
development material.
