# Exposure audit for the fresh mocha tasks, 2026-10-21, with no model

Audited at 2026-10-21 about 21:00 UTC, on this repository at `173bce007` (branch
`fix/accessor-audit-and-checking-distinction`), before any harness command wrote to the comparison
cache for these tasks. The three candidates are the `validated` entries of
[../delivery-trial/candidates.json](../delivery-trial/candidates.json), all from `mochajs/mocha`:

| candidate | full sha | parent (base) | subject |
| --- | --- | --- | --- |
| `12279398f` | `12279398f98942f21eeca7c1df5967f5f3bbe83f` | `bb2e69a953645fa12b534d20182a5ca5fbbc995b` | fix: support `--X` one-char aliases (#6391) |
| `15aa7d155` | `15aa7d1554865fc7f37e166340903c1b752def7c` | `e5a779eb40bf2aa2659f41878fcb2f90f95fbcbf` | fix: keep unknown config values from becoming test specs (#6244) |
| `35413b661` | `35413b661023ff3e5e27b120843ee2ebf5902aa4` | `a3c3a1cb295cd177542846004eae735467b31122` | fix: support modern RegExp flags in Mocha#grep (#5825) |

## This repository, tracked files at the audited commit

`git grep -c -F -e 12279398f -e 15aa7d155 -e 35413b661 HEAD`: one file,
`docs/evidence/2026-10-21/delivery-trial/candidates.json` (3 matches).

`git grep -c -i -e "one-char alias" -e "unknown config values" -e "modern RegExp flags" -e "#6391" -e "#6244" -e "#5825" HEAD`:
one file, the same `candidates.json` (3 matches).

`git grep -c -E "mocha-(bugfix|feature|upgrade)" HEAD`: no match (exit 1). No mocha task id
exists anywhere in the tree.

`git grep -c -F -e mochajs HEAD`: four files.

- `docs/evidence/2026-10-21/delivery-trial/candidates.json` (4): the candidates themselves.
- `docs/evidence/2026-10-21/delivery-trial/protocol.md` (1) and
  `docs/evidence/2026-10-21/task-continuation/protocol.md` (1): sentences naming "three
  mochajs/mocha fixes" as the candidates.
- `campaign/selection/decisions.jsonl` line 126: the campaign's repository selection judged
  `mochajs/mocha` at commit `d84fdbf117397df12179f9de514b4495d684c555` and did not accept it
  ("needs a service: @playwright/test"). No mocha task was ever built from it.

`scripts/comparison/tasks.mjs` before this work names `mocha` only as the test runner of other
projects (yargs-parser, sinon) and as a devDependency of the yargs-parser upgrade task; no entry
has `repository: "mochajs/mocha"`.

### Packed (compressed) evidence

`git grep` does not read the 152 tracked compressed files (150 `.br`, 2 `.gz`), so each was
decompressed and searched (a Node script with `zlib.brotliDecompressSync` / `gunzipSync`, patterns
case-insensitive):

| pattern | files |
| --- | --- |
| `12279398f`, `15aa7d155`, `35413b661` | 0 |
| `mocha-bugfix` | 0 |
| `one-char alias`, `unknown config values`, `modern RegExp flags` | 0 |
| `parse-args`, `unparse-args` | 0 |
| `mochajs` | 4: `campaign/pr-tasks/packed-derived/repository-pools/archive.json.br` (1, the repository pool entry for `mochajs/mocha`, not accepted); `docs/evidence/2026-10-16/comparison/stage-a/blobs/packed-derived/blobs/archive.json.br` (2), `docs/evidence/2026-10-16/comparison/stage-a/patches/packed-derived/unlinked-patches/archive.json.br` (2) and `docs/evidence/2026-10-16/packed-derived/gzip/archive.json.br` (4), each the string `https://opencollective.com/mochajs` in the `funding` field of a `node_modules/mocha` lockfile entry inside a csstree upgrade patch |

One tracked `.gz`, `docs/evidence/2026-10-19/requested-example/launch-1 20261020T025016-924766/sessions/ledger.jsonl.gz`,
is 0 bytes in the checkout and could not be decompressed; it holds nothing to search.

### Every branch tip

`git grep -l -i -E "12279398f|15aa7d155|35413b661|mochajs|mocha-(bugfix|feature|upgrade)|one-char alias|unknown config values|modern RegExp flags" <ref>`
over all 51 local and `origin/*` branch tips (run per ref from a Node script). Seven distinct paths
matched:

- `campaign/selection/decisions.jsonl` (39 refs): the rejected repository judgement above.
- `eval/comparison-2026-10-16:campaign/pr-tasks/repository-pool-2.json` (31 refs, older
  branches, before the pools were packed): `mochajs/mocha` at
  `d59467a8a50c07628f5ccb11c683e8820dd4a291`, `accepted: false`, "needs a service:
  @playwright/test".
- `origin/main:campaign/selection/candidates.json` (that ref only): `mochajs/mocha` listed among
  the campaign's repository candidates (name, stars, clone URL).
- `eval/comparison-2026-10-16:docs/evidence/2026-10-16/comparison/stage-a/patches/csstree-upgrade-esbuild-0-24.opencode.patch`
  (12 refs, before it was packed): the opencollective funding URL above.
- `docs/evidence/2026-10-21/delivery-trial/candidates.json`, `.../delivery-trial/protocol.md` and
  `.../task-continuation/protocol.md` (3 refs each: this branch, its origin and this worktree).

No branch names a candidate sha outside `candidates.json`, and no branch holds a mocha task.

## This machine

- `~/.cache/swarm-comparison/runs` (45 run directories, 7.8 MB): no run file name contains
  `mocha`; `grep -rl mochajs` and `grep -rlE "mocha-bugfix|12279398f|15aa7d155|35413b661"` match no
  file. 47 files there contain the word `mocha` (case-insensitive), as other projects' test
  runner or devDependency; none names `mochajs`.
- `~/.cache/swarm-comparison/work` (2.3 GB, 46 entries) and `~/swarm-comparison-work` (33 GB, 146
  entries): no entry name contains `mocha`; `grep -rlE "mochajs|mocha-bugfix|12279398f|15aa7d155|35413b661"`
  matches nine files, none a mocha workspace: three are sinon documentation inside a sinon
  workspace (links to mochajs.org), six are older copies of this repository's own repository
  pool, `campaign/selection/decisions.jsonl` and the csstree patch above inside gate-run
  checkouts (`gates-a1e6c9608`, `gates-final`).
- `~/.cache/swarm-comparison/tools`: product builds (`swarm-<sha>`) and `npm-11.2.0` only; nothing
  task-specific.
- **The mirror exists.** `~/.cache/swarm-comparison/mirrors/mochajs__mocha.git` (54 MB, a
  `git clone --mirror` of `https://github.com/mochajs/mocha.git`: `remote.origin.mirror true`,
  fetch `+refs/*:refs/*`, so every branch of the upstream repository), last modified
  2026-10-21 10:39:21 -0600, made for the candidate validation of the delivery trial. Its `HEAD`
  is `refs/heads/main` at `cb21a4eba550da665fb2c3fa1ce021777a191e23` (2026-10-17). Both selected
  upstream commits are ancestors of that `main` (`git merge-base --is-ancestor` exit 0 for each),
  and all three candidates resolve in it. The task-continuation protocol's sentence that no mocha
  task was "mirrored ... on this machine" was true of the task set, not of this mirror: the
  mirror predates this audit.
- Before this audit the mirror had no `refs/tags/comparison/*` tag. The harness's validation
  (`cloneAtBase`) then added two:
  `comparison/mocha-bugfix-long-prefix-short-alias/base` at `bb2e69a95` and
  `comparison/mocha-bugfix-unparse-attached-values/base` at `e5a779eb4`.

### Whether an arm could read the upstream fix

A fact, not corrected here. The mirror is a plain directory under the same user's home,
readable by any process of that user: an arm whose shell can read `~/.cache/swarm-comparison/mirrors/mochajs__mocha.git`
by absolute path could read the upstream commits and their tests from it. The arm's own
workspace does not hold them: `scripts/comparison/workspace.mjs` (`cloneAtBase`) makes each
workspace a `git clone --depth 1 --branch comparison/<task>/base file://<mirror>` and removes the
`origin` remote. Reproduced by hand for the first task: the clone has one commit
(`git rev-list --all --count` is 1, `.git/shallow` is `bb2e69a9...`), and
`git cat-file -e` of either upstream commit exits 1 (absent). The base trees and their installed
`node_modules` contain no copy of the fixes (no `parse-args.js` under any `node_modules/**/mocha`,
no mention of `#6391`, `#6244` or the new test names outside `node_modules` and `.git`).

The mocha base trees carry the project's own `AGENTS.md` (158 lines) addressed to coding agents:
it tells them to prefer Node 22, to bootstrap with `npm install` (and `npm ci --ignore-scripts`
for clean reproduction) and that browser tests need Google Chrome. Both arms read the same file.
