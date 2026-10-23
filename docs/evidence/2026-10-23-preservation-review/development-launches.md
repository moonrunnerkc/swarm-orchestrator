# Development study launches

Frozen before the first launch, October 23, 2026, under the
[registered protocol](development-protocol.md).

- **Build.** All three arms run a `git archive` of `ab8726127`, built with `npm ci` and
  `npm run build`. CLI sha256 `ad647178dd05cec669d9156900df99329843217878089f8666aac870fd928208`.
- **Gates on that source.** `npm run gates` passed: 492 test files passed, 5 skipped; 4,884 tests
  passed, 29 skipped.
- **Harness.** The runner is the same commit, run from its own worktree. Harness digest
  `sha256:48c9e71f943759d5fb9fc07dc3b3cc939a5ecc17b8af4cb79346c47ffa334790`.
- **Manifest.** `~/.cache/swarm-study-2026-10-23c/dev/manifest.json`, sha256
  `3a8476a9aa6a4d4e1d2c71c6e18cc398b73bd5242f30b9f0604408732f74a887`, written from the
  configuration [`study-config.mjs dev`](study-config.mjs) produces.
- **Model.** `qwen3.6:35b-a3b` through local Ollama at `127.0.0.1:11434`, one sequence at a time.
  Node v24.15.0.
- **Order** (order, task, arm, sample):

| Order | Task | Arm | Sample |
| --- | --- | --- | --- |
| 0 | svgo | `swarm-control` | 1 |
| 1 | svgo | `swarm-prose` | 1 |
| 2 | svgo | `swarm` | 1 |
| 3 | markdown-it feature | `swarm-prose` | 1 |
| 4 | markdown-it feature | `swarm` | 1 |
| 5 | markdown-it feature | `swarm-control` | 1 |
| 6 | p-limit | `swarm` | 1 |
| 7 | p-limit | `swarm-control` | 1 |
| 8 | p-limit | `swarm-prose` | 1 |
| 9 | svgo | `swarm-prose` | 2 |
| 10 | svgo | `swarm` | 2 |
| 11 | svgo | `swarm-control` | 2 |
| 12 | markdown-it feature | `swarm` | 2 |
| 13 | markdown-it feature | `swarm-control` | 2 |
| 14 | markdown-it feature | `swarm-prose` | 2 |
| 15 | p-limit | `swarm-control` | 2 |
| 16 | p-limit | `swarm-prose` | 2 |
| 17 | p-limit | `swarm` | 2 |

## Development smokes before the freeze

Three unscored live development runs, on tasks the protocol uses (all exposed), found defects
that the build above corrects. None is a study launch, and their results are not counted.

- **p-limit, executable review.** The review examined, but all four probes were dropped: three
  had camelCase ids, and none was runnable, since each `program` was a file path with no cases.
  Corrected:
  - ids are normalized;
  - a path given as a program is refused with that reason;
  - the prompt shows one probe;
  - one bounded revision follows an answer with nothing runnable.
- **markdown-it feature, executable review, first run.** The review was never asked. The attempt
  cap of three was spent on a repair, the task's continuation and the requested-tests follow-up.
  Corrected: the review is asked after the continuation and before the outcomes follow-up, whose
  brief rides in the review's attempt.
- **markdown-it feature, executable review, second run.**
  - The review examined, two probes ran on both trees, and their findings got an attempt the
    ratchet kept.
  - Offline, the released hidden evaluator fails the delivered candidate.
  - The candidate before that attempt cannot be scored. The product's snapshot of it is scrubbed
    (`const tokens = …` redacted), and scoring it measured the redaction: the build failed on the
    redacted line. So whether that attempt helped or hurt is not known. Corrected:
    - the product's snapshot says when it was scrubbed and carries the unscrubbed patch's digest;
    - the runner now takes its own exact snapshot at each Swarm attempt.

## Preflight

`study.mjs --preflight`: all 18 configurations passed every check, with no task inference.

## Conditions

- The scored launches started while the fresh block's evaluator author was still preparing
  tasks on the same host: clones, installs and project test runs, one at a time and no model
  inference. Every arm shares that load, since the order interleaves them, but it is not a
  controlled resource, and a timing-sensitive failure in this study can be the host's.
