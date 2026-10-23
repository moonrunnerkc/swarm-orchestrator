# Development study, registered before its first launch

October 23, 2026. A bounded development study of the revised controller on two exposed tasks. The
tasks are held-out block 1 material released after that block was scored, so this is development
evidence only: a favorable result here is not a general advantage claim.

## Question

On the two task shapes the revision targets, does the revised implementation change the worker's
implementation decisions, and do the delivered artifacts improve, against the implementation it
replaces and against a simple same-model baseline?

## Tasks (both exposed; evaluators released and validated in block 1)

| Task | Shape | Evaluator |
| --- | --- | --- |
| `p-limit-bugfix-limit-function-clear-queue` | bounded API change that must keep behaviour an existing implementation provides | block 1's hidden check, reference and controls ([sealed](../2026-10-22-adaptive/heldout/sealed/)) |
| `fastify-refactor-kebab-case-file-names` | mechanical multi-file transformation (11 moves, about 20 files of references) | block 1's hidden check; the registered rule is primary, the absence-assertion amendment ([audit](../2026-10-22-adaptive/evaluator-audit.mjs)) is reported beside it |

Same task text, visible check, contract text, allowed-change policy, base and harness lockfile as
block 1.

## Arms

All on `qwen3.6:35b-a3b` through local Ollama, one endpoint, one execution profile.

1. `swarm-previous`: the implementation being replaced, `git archive` of `fa190998c` (draft PR 97),
   `--adaptive` (adaptive-decision-v1).
2. `swarm`: the revised implementation, `git archive` of the commit named in the launch log,
   `--adaptive` (adaptive-decision-v2, measured shell effects, batch edits, the rewrite reading, the
   requested-tests follow-up).
3. `swarm-direct`: the simple same-model baseline: the revised build with `--attempts 0`, so no
   repair, continuation, follow-up or decision point. Its tools are the revised tools.

`swarm` against `swarm-previous` measures the whole revision; `swarm` against `swarm-direct`
measures the controller on the same build.

## Samples, order, resources, stopping

- Two samples per cell: 2 tasks × 3 arms × 2 = 12 launches, matched by sample. Order: sample 1 of
  every task, then sample 2, tasks in the comparison's seeded order, arms rotated by position.
- Per launch: 720,500 ms launch wall, 60,000 ms of it Swarm's verification reserve, 8,000,000 Swarm
  tokens as a ceiling, 40 steps per loop. Every diagnosis, follow-up, reassessment, repair and
  verification cost is inside those allowances and is counted.
- Ceiling: 144 agent-minutes of launch wall plus preparation and scoring, local inference only,
  paid inference $0.
- Every registered launch runs, whatever the others deliver. A zero-inference setup failure is
  recorded apart and retried at most twice after a recorded correction; once inference begins the
  outcome stands. No launch is added after a result is read.

## Measures

Primary: complete delivery as block 1 registered it (hidden evaluator, visible check, project
tests, lint where the base passes, requested tests present). Also: the product's verdict and its
accuracy; per launch, whether each mechanism was exercised (decision records, follow-ups,
reassessments and actions carried out, rewrite holds and reasons, batch edits, measured shell
effects, the requested-tests follow-up) and whether the worker's next action changed (edited at a
named location, delegated after a hold, used a batch or a move); initial against delivered
candidate where the first checked candidate can be rebuilt; wall, tokens and unknown-usage calls.
Pairs per sample and per task as wins, losses and ties. Two samples support counts, not rates.

This study is for development: a defect it exposes may be corrected afterwards, and each such
correction is recorded with the evidence that prompted it. The fresh block then runs on one frozen
build, registered before its first launch, and its tasks are never used to tune that build.
