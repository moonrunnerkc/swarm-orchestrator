# Fresh block 3, registered before its first launch

October 23, 2026. A small fresh comparison on three tasks that no earlier stage has used. A
separate evaluator author prepared them under the [registered selection rule](fresh-block-selection-rule.md)
and ran no model inference. That author was a separate model conversation, which keeps it apart
from the implementer's context; it does not make the author independent in reasoning. The
implementer has read no hidden check, reference or control, and will not before the block's last
launch is scored. The block supports counts only. No claim of general advantage will be made from
it.

## Tasks

| Task | Family | Repository | Base |
| --- | --- | --- | --- |
| `ufo-feature-filter-query` | bounded API change with preservation | unjs/ufo | `7959de5b4` |
| `ufo-bugfix-base-prefix-boundary` | bug fix with preservation | unjs/ufo | `5fb179d51` |
| `nanoid-refactor-module-subdirectories` | mechanical transformation reaching configuration (13 moves, `package.json` fields) | ai/nanoid | `a58703bd9` |

- **Public summary.** The task text, visible checks, install steps, frozen lockfile digests and
  validation counts are in `~/.cache/swarm-heldout-2026-10-23c/public-summary.json`, sha256
  `7a62745ebbd62f896b35a060457115130843a73307c463c0799b9b25823af4bb`. It is committed here after
  the block, with the selection record.
- **Validation.** Every evaluator was validated against:
  - the base, which fails;
  - the reference, which passes with the project tests and the policy;
  - one alternative correct implementation, which passes;
  - one absence-assertion control, which passes;
  - five or six faulty controls, which fail, including at least one that implements the new
    behaviour and breaks the kept behaviour.

  The refactor task was also validated against five configuration-hiding controls, all failing.
- **Deviations.** The author's recorded deviations stand as recorded, and every arm gets the same
  task text that states them:
  - ufo's required test command is its vitest step, because its lint already fails on the base;
  - nanoid's is `npx jest`, because its coverage threshold already fails on the base;
  - nanoid's install restores the tracked `yarn.lock`.

## Arms

All arms run `qwen3.6:35b-a3b` through local Ollama at `127.0.0.1:11434`, one sequence at a time,
with the same task text, deliverables, visible check, allowed-change policy and execution profile.

| Arm | What it is |
| --- | --- |
| `swarm` | **revised Swarm**: the build this stage ends with, `--adaptive --review executable` |
| `swarm-control` | **prior Swarm with the shared correctness fixes**: the same build, `--adaptive`, no review |
| `aider` | **a simple agent on the same model**: aider 0.82.3, pinned in its own virtual environment. It answers one message with its own edit format and repository map, runs the visible check and project tests as its test command after its edits, and gets the same wall. |
| `opencode` | OpenCode 1.19.4, pinned by absolute path, with edit and shell in the workspace and web fetch denied |

- **The build.** The revised arm's build is named by commit and digest in the launch log before the
  first launch. It is the development study's build, plus any defect fixes that study's records
  call for, each recorded with its evidence. The shared correctness fixes include:
  - `rename-transport-v1`;
  - the lifecycle-alias fix;
  - sealed verdicts;
  - candidate snapshots.

  `swarm-control` runs the same build, so the arms differ only in the review.
- **Not an arm here.** `swarm-direct` (`--attempts 0`) is an internal ablation, not a simple-agent
  baseline, and is not included.

## Samples, order, resources

- Two samples per cell: 3 tasks × 4 arms × 2 = 24 launches, matched by sample.
- Order: the comparison's seeded `studyOrder` for sample 1, then the arms rotated one place for
  sample 2.
- Per launch, every arm gets:
  - 720,500 ms of launch wall, of which Swarm arms hold 60,000 ms as their verification reserve;
  - an 8,000,000-token ceiling for Swarm;
  - 40 steps per Swarm loop.
- Resource ceiling: 288 agent-minutes of launch wall, plus preparation and scoring. Local inference
  only; paid inference is $0.

## Stopping and validity

- Every registered arm runs, whatever another arm's result.
- A zero-inference setup failure is recorded apart and retried at most twice, after a recorded
  correction. Once inference begins, the outcome stands.
- Hidden verdicts are sealed beside each record and released by `study.mjs --reveal` only after
  the twenty-fourth launch has an outcome. The progress line carries health only. An early reading
  of a hidden verdict would be recorded as a departure.
- Nothing in the product or the scoring changes between launches.
- The hardware and inference conditions are recorded: one Mac with 64 GB, Ollama serving one
  sequence, Node 24.15.0. No other heavy job runs during the block.

## Scoring and report

- **Primary.** Complete delivery: the hidden evaluator passes, the visible check and the project
  test command pass, lint passes where the base passes it, and at least one added test fails on
  base source and passes on the delivered source (the deliverables every arm is given).
- **Separately, per launch:**
  - hidden behaviour alone, with the kept-behaviour checks reported apart where the evaluator
    names them;
  - the product verdict against the hidden verdict, for Swarm;
  - completion claims, for OpenCode;
  - the review's examination, findings and attempt;
  - the candidate before the review's attempt and the delivered one, each scored offline from the
    runner's own snapshots;
  - wall, tokens and unknown-usage calls, every review, diagnosis, repair and verification
    included.
- Pairs per sample and task, as wins, losses and ties: revised Swarm against each of the other
  three.
- Finding validity, by the offline assessor against the reference.
- Uncertainty: with three tasks and two samples, a count difference of one or two is within what
  chance and infrastructure produce. Repeated samples of one task are not independent evidence
  across repositories.

## What would change the default

Nothing in this block alone makes the review default-on. It stays experimental unless the
development study and this block both show revised Swarm delivering more complete changes than
`swarm-control`, traced to valid findings, with no delivery lost to the review's attempt.
