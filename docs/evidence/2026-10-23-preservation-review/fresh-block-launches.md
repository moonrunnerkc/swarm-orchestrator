# Fresh block launches

Frozen before the first launch, October 23, 2026, under the
[registered protocol](fresh-block-protocol.md).

- **Build.** Every Swarm arm runs a `git archive` of `2f16faa3e`, built with `npm ci` and
  `npm run build`. Build digest `sha256:2f46ba2c4c313d41b39e44929305ccd219229333a923c1743904210558a48710`,
  CLI sha256 `ad647178dd05cec669d9156900df99329843217878089f8666aac870fd928208` (the entry file
  alone, unchanged since the development study's build).
- **What changed since the development study's build (`ab8726127`).** The correctness fixes from
  the stage's independent code review (`dd146282a`), the sealed hidden-scorer log, and the five
  setup corrections below. No mechanism was added.
- **Gates on that source.** `npm run gates` passed: 493 test files passed, 5 skipped; 4,894 tests
  passed, 29 skipped.
- **Harness.** The runner is the same commit, run from its own worktree. Harness digest
  `sha256:4b98d2c36680028da445f7be5b431cdb97e4b5e9df8305a5d44fdfe12c37eee6`.
- **Manifest.** `~/.cache/swarm-study-2026-10-23c/fresh/manifest.json`, sha256
  `a9ed22295abd0cb432ac5824f710e0e1b7791b5716e96118170ebd5929b7470c`, written from the
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

## Setup corrections before the first scored launch

### First freeze: build `dc00353a9`

Manifest sha256 `93bfdd2c66bd520c9cc9ad302aa5f0bc4306f10c02b40f6d5c6b4a7002c01f28`, kept under
`fresh/superseded-dc00353a9/` with its preflight records. It failed its zero-inference preflight
for every Swarm configuration of two tasks. The aider and OpenCode configurations, and both Swarm
arms on the ufo bug fix, passed. No model was called. Both causes
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

### Second freeze: build `082429f65`

Manifest sha256 `14aab083262e47b55d90ddddf094e4e7a25ce8ddbf887dc9084abd07054cc36b`, kept under
`fresh/superseded-082429f65/` with its preflight and run records. Its preflight passed all 24
configurations. Launch 0 (ufo feature, `swarm`) then stopped before its first model call, after 8
seconds: `rm returned EISDIR … /src`. No inference began, so it is a setup failure. The runner
stopped there, as registered.

That preflight ran `swarm check`, which never reaches the goal check a run makes before its first
model call. Recorded in [amendment 8](intended-files.md). A model-free reproduction of that step (`ci` over an empty patch with the launch's
install and sealed contract, on a launch-shaped tree) found three defects, two of them on tasks
the first launch had not reached:

- **Both ufo tasks: a directory read as a changed instrument file.** ufo's lint names `src` to
  prettier. The base side of the instrument comparison read it with `git show`, which prints a
  directory's listing, while the checkout side read nothing. The unchanged tree's lint therefore
  read as run under a changed instrument, and putting `src` back failed. Corrected in `fe8a3c418`:
  both base readers read a blob only.
- **nanoid: npm rewrites the tracked `yarn.lock`.** npm updates a `yarn.lock` beside the
  `package-lock.json` it installs from, even with `--no-save`, and setup refused the checkout as an
  install that changed source. Corrected in `51befe92b`: the npm install writes that one file's
  bytes back and records it as `restored`. Any other change still fails setup.
- **The harness preflight did not reach the step.** Corrected in `2f16faa3e`: the gate plan now
  also runs that model-free goal check, with `swarm.toml` committed in its throwaway tree, because
  `ci` reads the base's configuration where a run reads the workspace's.

Before the corrections, the reproduction failed on all three tasks: EISDIR on both ufo tasks, and
the setup refusal on nanoid. After them, all three complete with no refusal, measured, and the
tests gate passing on the base.

## Preflight

`study.mjs --preflight` on the third freeze: all 24 configurations passed every check, with no
task inference. Every Swarm configuration's gate plan now also reports "the run's own preflight
over the base completed".
