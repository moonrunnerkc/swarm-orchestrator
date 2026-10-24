# Fresh block launches

Frozen before the first launch, October 23, 2026, under the
[registered protocol](fresh-block-protocol.md).

- **Build.** Every Swarm arm runs a `git archive` of `082429f65`, built with `npm ci` and
  `npm run build`. Build digest `sha256:a00f1f26ccbd03d88c0e3e89f521375e2623faf49cbf4f707f0521dd4c32f718`,
  CLI sha256 `ad647178dd05cec669d9156900df99329843217878089f8666aac870fd928208`.
- **What changed since the development study's build (`ab8726127`).** The correctness fixes from
  the stage's independent code review (`dd146282a`), the sealed hidden-scorer log, and the two
  setup corrections below. No mechanism was added.
- **Gates on that source.** `npm run gates` passed: 492 test files passed, 5 skipped; 4,890 tests
  passed, 29 skipped.
- **Harness.** The runner is the same commit, run from its own worktree. Harness digest
  `sha256:661043ea00a93516fcccfd5a3a610f05aff7a2169fa951aa408605a6e1a9ba3c`.
- **Manifest.** `~/.cache/swarm-study-2026-10-23c/fresh/manifest.json`, sha256
  `14aab083262e47b55d90ddddf094e4e7a25ce8ddbf887dc9084abd07054cc36b`, written from the
  configuration [`study-config.mjs fresh`](study-config.mjs) produces.
- **Other arms.** aider 0.82.3 in its own virtual environment; OpenCode 1.19.4, by absolute path.
- **Model.** `qwen3.6:35b-a3b` through local Ollama at `127.0.0.1:11434`, one sequence at a time.
  Node v24.15.0.
- **Order** (order, task, arm, sample):

| Order | Task | Arm | Sample |
| --- | --- | --- | --- |
| 0 | ufo feature | `swarm` | 1 |
| 1 | ufo feature | `swarm-control` | 1 |
| 2 | ufo feature | `aider` | 1 |
| 3 | ufo feature | `opencode` | 1 |
| 4 | nanoid refactor | `swarm-control` | 1 |
| 5 | nanoid refactor | `aider` | 1 |
| 6 | nanoid refactor | `opencode` | 1 |
| 7 | nanoid refactor | `swarm` | 1 |
| 8 | ufo bug fix | `aider` | 1 |
| 9 | ufo bug fix | `opencode` | 1 |
| 10 | ufo bug fix | `swarm` | 1 |
| 11 | ufo bug fix | `swarm-control` | 1 |
| 12 | ufo feature | `swarm-control` | 2 |
| 13 | ufo feature | `aider` | 2 |
| 14 | ufo feature | `opencode` | 2 |
| 15 | ufo feature | `swarm` | 2 |
| 16 | nanoid refactor | `aider` | 2 |
| 17 | nanoid refactor | `opencode` | 2 |
| 18 | nanoid refactor | `swarm` | 2 |
| 19 | nanoid refactor | `swarm-control` | 2 |
| 20 | ufo bug fix | `opencode` | 2 |
| 21 | ufo bug fix | `swarm` | 2 |
| 22 | ufo bug fix | `swarm-control` | 2 |
| 23 | ufo bug fix | `aider` | 2 |

## Setup corrections before the first launch

The first freeze, of build `dc00353a9` (manifest sha256
`93bfdd2c66bd520c9cc9ad302aa5f0bc4306f10c02b40f6d5c6b4a7002c01f28`, kept under `fresh/superseded-dc00353a9/` with its preflight records), failed its
zero-inference preflight for every Swarm configuration of two tasks. The aider and OpenCode
configurations, and both Swarm arms on the ufo bug fix, passed. No model was called. Both causes
were corrected and recorded in [amendment 7](intended-files.md):

- **ufo feature.** The product's tests gate read as not applicable on the base, because the
  lockfile's three npm aliases (`string-width-cjs`, `strip-ansi-cjs`, `wrap-ansi-cjs`) looked like
  dependencies the change had introduced. The gate plan's tree did not commit the frozen harness
  lockfile, which the launch's workspace commits before preparing, so the whole lockfile read as
  new. This was a harness defect (`082429f65`). The installed lockfile on a launch-shaped tree is
  byte-identical to the frozen one, so no launch would have seen the difference.
- **nanoid refactor.** `swarm check` refused the project because it holds a `yarn.lock`, even
  though the harness's `package-lock.json` sits beside it and npm drives it. This was a product
  over-refusal, corrected in `b034c9a84`. Installing with several lockfiles still needs a named
  choice.

## Preflight

`study.mjs --preflight` on the refrozen manifest: all 24 configurations passed every check, with no
task inference.
